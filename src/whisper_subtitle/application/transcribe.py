"""The single application use case for every transcription preset."""

from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import replace
from pathlib import Path
import time
from typing import Any

from ..bootstrap import configure_runtime
from ..domain.contracts import (
    BatchResult,
    Preset,
    ProgressEvent,
    TranscriptionRequest,
    TranscriptionResult,
)
from ..domain.detail_review import (
    DETAIL_CLIP_PADDING_SECONDS,
    DetailCandidateRegion,
    candidate_prompt,
    evaluate_detail_candidate,
    prior_context,
    replacement_preserves_protected_content,
    select_chinese_detail_regions,
    splice_detail_candidates,
    stable_splice_boundary_is_safe,
)
from ..domain.mixed_language import (
    EnglishCandidateRegion,
    candidate_rejection_reason,
    hotword_audit,
    latin_hotwords,
    select_english_candidate_regions,
    splice_candidate_segments,
)
from ..domain.postprocess import (
    apply_strategy,
    merge_chinese_segments_to_sentences,
    merge_english_segments_to_sentences,
)
from ..domain.presets import resolve_preset
from ..domain.quality import build_recognition_quality_diagnostics
from ..domain.transcription import TranscriptionEngine
from ..domain.subtitles import build_srt_document
from ..domain.transcript_layout import build_transcript_document
from ..infrastructure.hardware import HardwareDetector, HardwareInfo
from ..infrastructure.media_files import MediaDiscoveryError, discover_media_files
from ..infrastructure.output_store import (
    OutputPlan,
    build_output_plan,
    prepare_forced_output_directory,
    prepare_output_plan,
    write_desktop_outputs,
    write_primary_outputs,
)
from ..infrastructure.whisper_engine import (
    FasterWhisperEngine,
    ModelLocation,
)


ProgressReporter = Callable[[ProgressEvent], None]
RuntimeConfigurer = Callable[[], ModelLocation]
HardwareProbe = Callable[[], HardwareInfo]
EngineLoader = Callable[[HardwareInfo, ModelLocation], TranscriptionEngine]
CancellationProbe = Callable[[], bool]


def _ignore_progress(_event: ProgressEvent) -> None:
    pass


def _not_cancelled() -> bool:
    return False


class TranscriptionCancelled(RuntimeError):
    """Raised at safe application checkpoints when a Worker task is cancelled."""


class TranscriptionService:
    """Coordinate one complete batch without depending on a user interface."""

    def __init__(
        self,
        *,
        progress: ProgressReporter | None = None,
        runtime_configurer: RuntimeConfigurer | None = None,
        hardware_detector: HardwareProbe | None = None,
        engine_loader: EngineLoader | None = None,
        cancelled: CancellationProbe | None = None,
    ) -> None:
        self._progress = progress or _ignore_progress
        self._configure_runtime = runtime_configurer or configure_runtime
        self._detect_hardware = hardware_detector or HardwareDetector().detect
        self._load_engine = engine_loader or FasterWhisperEngine.load
        self._cancelled = cancelled or _not_cancelled

    def _check_cancelled(self) -> None:
        if self._cancelled():
            raise TranscriptionCancelled("transcription task was cancelled")

    def _emit(
        self,
        stage: str,
        message: str,
        *,
        current: int | None = None,
        total: int | None = None,
        preset_id: str | None = None,
        input_path: Path | None = None,
        media_progress_percent: float | None = None,
        media_elapsed_seconds: float | None = None,
        media_status: str | None = None,
        output_paths: tuple[Path, ...] = (),
        quality_diagnostics: Mapping[str, Any] | None = None,
    ) -> None:
        self._progress(
            ProgressEvent(
                stage=stage,
                message=message,
                current=current,
                total=total,
                preset_id=preset_id,
                input_path=input_path,
                media_progress_percent=media_progress_percent,
                media_elapsed_seconds=media_elapsed_seconds,
                media_status=media_status,
                output_paths=output_paths,
                quality_diagnostics=quality_diagnostics,
            )
        )

    def _create_default_engine(self, preset_id: str) -> TranscriptionEngine:
        location = self._configure_runtime()
        hardware = self._detect_hardware()
        if hardware.cuda_available:
            hardware_message = "\n".join(
                (
                    f"🖥️  检测到 GPU: {hardware.gpu_name}",
                    f"🔧 CUDA 版本: {hardware.cuda_version}",
                    "⚡ 使用 float16 半精度加速",
                )
            )
        else:
            hardware_message = "⚠️ 警告: CUDA 不可用，将回退到 CPU 运行 (速度极慢)"
        self._emit(
            "hardware_detected",
            hardware_message,
            preset_id=preset_id,
        )
        self._emit(
            "model_loading",
            "\n".join(
                (
                    "\n📦 正在加载 Whisper Large-V3-Turbo 模型...",
                    f"   模型路径: {location.hub}",
                    "   模型已内置在工程目录中，无需联网下载\n",
                )
            ),
            preset_id=preset_id,
        )
        engine = self._load_engine(hardware, location)
        self._emit("model_loaded", "✅ 模型加载完成\n", preset_id=preset_id)
        return engine

    def transcribe_file(
        self,
        request: TranscriptionRequest,
        engine: TranscriptionEngine,
        *,
        current: int = 1,
        total: int = 1,
        preset: Preset | None = None,
        output_plan: OutputPlan | None = None,
        subtitle_options: dict[str, object] | None = None,
        model_id: str = "large-v3-turbo",
    ) -> TranscriptionResult:
        """Transcribe one discovered file, propagating operational failures."""
        preset = preset or resolve_preset(request.preset_id)
        media_path = request.input_path
        self._check_cancelled()
        self._emit(
            "file_started",
            "\n".join(("\n" + "=" * 60, f"🎬 正在处理: {media_path.name}", "=" * 60)),
            current=current,
            total=total,
            preset_id=preset.id,
            input_path=media_path,
            media_progress_percent=0,
            media_elapsed_seconds=0,
            media_status="running",
        )

        output_plan = output_plan or build_output_plan(
            media_path, request.output_dir, desktop=request.desktop
        )
        prepare_output_plan(output_plan)
        self._check_cancelled()
        params = preset.transcription_options()
        mixed_recognition = request.recognition_strategy == "mixed_zh_en"
        detail_recognition = request.recognition_strategy == "zh_detail_review"
        if output_plan.primary_srt is not None:
            # SRT timing needs the model's real word boundaries. Canonical
            # TXT/Markdown presets keep their established parameter values.
            params["word_timestamps"] = True
        if mixed_recognition:
            # Trusted word boundaries allow the local English result to replace
            # only the overlapping words instead of dropping an entire mixed
            # Whisper segment. Stable-primary tasks keep their existing cost.
            params["word_timestamps"] = True
        media_started_at = time.monotonic()
        if mixed_recognition and model_id not in {"large-v3", "large-v3-turbo"}:
            raise ValueError("mixed_zh_en requires a Large V3 or Large V3 Turbo model")
        segments, info = engine.transcribe(str(media_path), **params)
        if params.get("language") is None:
            language_message = (
                f"🌐 检测到主要语言: {info.language} "
                f"(概率: {info.language_probability:.2f})；原声转录已开启"
            )
        else:
            language_message = (
                f"🌐 检测到语言: {info.language} "
                f"(概率: {info.language_probability:.2f})"
            )
        self._emit(
            "language_detected",
            language_message,
            current=current,
            total=total,
            preset_id=preset.id,
            input_path=media_path,
        )

        segment_list = []
        media_duration = getattr(info, "duration", None)
        last_progress_emit = 0.0
        last_progress_percent = -1.0
        for segment in segments:
            self._check_cancelled()
            segment_list.append(segment)
            segment_end = getattr(segment, "end", None)
            if (
                isinstance(media_duration, (int, float))
                and media_duration > 0
                and isinstance(segment_end, (int, float))
            ):
                percent = max(0.0, min(100.0, segment_end / media_duration * 100))
                if mixed_recognition:
                    visible_percent = percent * 0.75
                elif detail_recognition:
                    visible_percent = percent * 0.65
                else:
                    visible_percent = percent
                now = time.monotonic()
                if (
                    percent >= 100
                    or (
                        percent > last_progress_percent
                        and now - last_progress_emit >= 0.5
                    )
                ):
                    self._emit(
                        "segment_progress",
                        f"🎧 当前媒体转录 {percent:.1f}%",
                        current=current,
                        total=total,
                        preset_id=preset.id,
                        input_path=media_path,
                        media_progress_percent=visible_percent,
                        media_elapsed_seconds=now - media_started_at,
                        media_status="running",
                    )
                    last_progress_emit = now
                    last_progress_percent = percent
        quality_source_segments = list(segment_list)
        language_regions: list[dict[str, Any]] = []
        detail_candidates: list[dict[str, Any]] = []
        if mixed_recognition:
            segment_list, language_regions, secondary_pass_count = self._run_mixed_second_pass(
                media_path,
                engine,
                segment_list,
                params,
                model_id=model_id,
                current=current,
                total=total,
                preset_id=preset.id,
                media_started_at=media_started_at,
            )
        elif detail_recognition:
            segment_list, detail_candidates, secondary_pass_count = (
                self._run_chinese_detail_second_pass(
                    media_path,
                    engine,
                    segment_list,
                    params,
                    current=current,
                    total=total,
                    preset_id=preset.id,
                    media_started_at=media_started_at,
                )
            )
        quality_diagnostics = dict(
            build_recognition_quality_diagnostics(quality_source_segments, info, params)
        )
        if mixed_recognition:
            quality_diagnostics["recognition_strategy"] = "mixed_zh_en"
            quality_diagnostics["language_regions"] = language_regions
            quality_diagnostics["secondary_pass_count"] = secondary_pass_count
            quality_diagnostics["replaced_region_count"] = sum(
                region["decision"] == "replaced" for region in language_regions
            )
            quality_diagnostics["review_region_count"] = sum(
                region["decision"] in {"review", "rejected"}
                for region in language_regions
            )
        elif detail_recognition:
            quality_diagnostics["recognition_strategy"] = "zh_detail_review"
            quality_diagnostics["detail_candidates"] = detail_candidates
            quality_diagnostics["secondary_pass_count"] = secondary_pass_count
            quality_diagnostics["replaced_region_count"] = sum(
                item["decision"] == "replaced" for item in detail_candidates
            )
            quality_diagnostics["review_region_count"] = sum(
                item["decision"] == "review" for item in detail_candidates
            )
            quality_diagnostics["rejected_region_count"] = sum(
                item["decision"] == "rejected" for item in detail_candidates
            )
        term_audit = hotword_audit(
            params.get("hotwords"),
            " ".join(str(getattr(segment, "text", "")) for segment in segment_list),
        )
        if term_audit is not None:
            quality_diagnostics["hotword_audit"] = term_audit
        self._emit(
            "segments_collected",
            (
                f"🧩 原始片段数: {len(segment_list)}；"
                f"需复核 {quality_diagnostics['low_confidence_count']} 段；"
                f"温度回退 {quality_diagnostics['fallback_segment_count']} 段"
            ),
            current=current,
            total=total,
            preset_id=preset.id,
            input_path=media_path,
            quality_diagnostics=quality_diagnostics,
        )
        sentences = self._merge_segments(preset, segment_list)
        has_text_output = any(
            path is not None
            for path in (
                output_plan.primary_txt,
                output_plan.backup_txt,
                output_plan.primary_md,
                output_plan.backup_md,
                output_plan.desktop_txt,
                output_plan.desktop_md,
            )
        )
        if has_text_output:
            transcript = build_transcript_document(
                segment_list,
                preset.format_language,
                preset.postprocess_strategy,
            )
            lines = [unit.text for unit in transcript.units]
            source_line_count = transcript.source_unit_count
            txt_content = transcript.txt_content
            markdown_content = transcript.markdown_content
            merge_message = f"📝 智能分句数: {len(lines)}"
        else:
            lines = apply_strategy(
                preset.postprocess_strategy,
                (str(sentence["text"]) for sentence in sentences),
            )
            source_line_count = len(sentences)
            txt_content = ""
            markdown_content = ""
            merge_message = f"📝 合并后句子数: {len(sentences)}"
        self._emit(
            "sentences_merged",
            merge_message,
            current=current,
            total=total,
            preset_id=preset.id,
            input_path=media_path,
        )
        show_line_count = preset.postprocess_strategy.endswith("anti_hallucination")
        removed_count = source_line_count - len(lines)
        if show_line_count and removed_count > 0:
            self._emit(
                "repetitions_removed",
                f"🧹 清理重复句: 删除 {removed_count} 句幻觉重复",
                current=current,
                total=total,
                preset_id=preset.id,
                input_path=media_path,
            )

        self._check_cancelled()
        srt_content = None
        if output_plan.primary_srt is not None:
            srt_content = build_srt_document(
                sentences,
                preset.postprocess_strategy,
                subtitle_options,
                word_segments=segment_list,
            )
        write_primary_outputs(
            output_plan,
            txt_content,
            markdown_content=markdown_content,
            srt_content=srt_content,
        )
        suffix = f" ({len(lines)} 句)" if show_line_count else ""
        output_message = "✅ 完成输出: " + " + ".join(
            str(path) for path in output_plan.content_paths
        ) + suffix
        self._emit(
            "output_written",
            output_message,
            current=current,
            total=total,
            preset_id=preset.id,
            input_path=media_path,
            media_progress_percent=100,
            media_elapsed_seconds=time.monotonic() - media_started_at,
            media_status="completed",
            output_paths=output_plan.content_paths,
        )

        if request.desktop:
            write_desktop_outputs(
                output_plan,
                txt_content,
                markdown_content=markdown_content,
            )
            self._emit(
                "desktop_output_written",
                f"📁 桌面保存: {output_plan.desktop_txt} + {output_plan.desktop_md}",
                current=current,
                total=total,
                preset_id=preset.id,
                input_path=media_path,
            )
        return TranscriptionResult(request, True, output_plan.result_path)

    def _run_mixed_second_pass(
        self,
        media_path: Path,
        engine: TranscriptionEngine,
        primary_segments: list[object],
        params: Mapping[str, Any],
        *,
        model_id: str,
        current: int,
        total: int,
        preset_id: str,
        media_started_at: float,
    ) -> tuple[list[object], list[dict[str, Any]], int]:
        """Detect and conservatively replace trustworthy English speech regions."""
        self._check_cancelled()
        self._emit(
            "language_scan_started",
            "🌐 正在扫描短语音块的中英文概率",
            current=current,
            total=total,
            preset_id=preset_id,
            input_path=media_path,
            media_progress_percent=75,
            media_elapsed_seconds=time.monotonic() - media_started_at,
            media_status="running",
        )
        detections = engine.detect_language_regions(
            str(media_path),
            max_speech_duration_s=8,
            min_silence_duration_ms=300,
            cancelled=self._cancelled,
        )
        self._check_cancelled()
        candidates = select_english_candidate_regions(detections, model_id=model_id)
        diagnostics: list[dict[str, Any]] = [
            {
                "start": detection.start,
                "end": detection.end,
                "top_language": detection.top_language,
                "top_probability": detection.top_probability,
                "english_probability": detection.english_probability,
                "chinese_probability": detection.chinese_probability,
                "primary_text": _segment_excerpt(
                    primary_segments, detection.start, detection.end
                ),
                "candidate_text": "",
                "decision": "primary",
                "reason": None,
            }
            for detection in detections
        ]
        self._emit(
            "language_scan_completed",
            f"🌐 语言扫描完成：{len(detections)} 个语音块，{len(candidates)} 个英文候选区间",
            current=current,
            total=total,
            preset_id=preset_id,
            input_path=media_path,
            media_progress_percent=85,
            media_elapsed_seconds=time.monotonic() - media_started_at,
            media_status="running",
        )
        replacements: list[tuple[EnglishCandidateRegion, list[object]]] = []
        for index, region in enumerate(candidates, start=1):
            self._check_cancelled()
            candidate_options = dict(params)
            candidate_options.update(
                {
                    "language": "en",
                    "task": "transcribe",
                    "multilingual": False,
                    "condition_on_previous_text": False,
                    "initial_prompt": None,
                    "hotwords": latin_hotwords(params.get("hotwords")),
                    "clip_timestamps": [region.start, region.end],
                }
            )
            generated, candidate_info = engine.transcribe(
                str(media_path), **candidate_options
            )
            candidate_segments: list[object] = []
            for segment in generated:
                self._check_cancelled()
                candidate_segments.append(segment)
            candidate_quality = build_recognition_quality_diagnostics(
                candidate_segments,
                candidate_info,
                candidate_options,
            )
            rejection = candidate_rejection_reason(
                primary_segments,
                candidate_segments,
                region,
                candidate_quality,
            )
            if rejection is None:
                decision = "replaced"
            elif rejection in {"unsafe_boundary", "no_aligned_primary_segment"}:
                decision = "review"
            else:
                decision = "rejected"
            if rejection is None:
                replacements.append((region, candidate_segments))
            _mark_region_diagnostics(
                diagnostics,
                region,
                candidate_segments,
                decision=decision,
                reason=rejection,
            )
            percent = 85 + index / max(1, len(candidates)) * 13
            self._emit(
                "secondary_pass_progress",
                (
                    f"🔎 英文候选复识别 {index}/{len(candidates)} · "
                    f"{'已采用' if decision == 'replaced' else '建议复核' if decision == 'review' else '已拒绝'}"
                ),
                current=current,
                total=total,
                preset_id=preset_id,
                input_path=media_path,
                media_progress_percent=percent,
                media_elapsed_seconds=time.monotonic() - media_started_at,
                media_status="running",
            )
        return (
            splice_candidate_segments(primary_segments, replacements),
            diagnostics,
            len(candidates),
        )

    def _run_chinese_detail_second_pass(
        self,
        media_path: Path,
        engine: TranscriptionEngine,
        primary_segments: list[object],
        params: Mapping[str, Any],
        *,
        current: int,
        total: int,
        preset_id: str,
        media_started_at: float,
    ) -> tuple[list[object], list[dict[str, Any]], int]:
        """Re-recognize Chinese VAD blocks and adopt only proven improvements."""
        self._check_cancelled()
        self._emit(
            "detail_scan_started",
            "🔬 正在划分中文细节复识别区间",
            current=current,
            total=total,
            preset_id=preset_id,
            input_path=media_path,
            media_progress_percent=65,
            media_elapsed_seconds=time.monotonic() - media_started_at,
            media_status="running",
        )
        detections = engine.detect_language_regions(
            str(media_path),
            max_speech_duration_s=8,
            min_silence_duration_ms=300,
            speech_pad_ms=400,
            cancelled=self._cancelled,
        )
        self._check_cancelled()
        candidates = select_chinese_detail_regions(detections)
        self._emit(
            "detail_scan_completed",
            f"🔬 中文细节扫描完成：{len(candidates)} 个真实语音块",
            current=current,
            total=total,
            preset_id=preset_id,
            input_path=media_path,
            media_progress_percent=70,
            media_elapsed_seconds=time.monotonic() - media_started_at,
            media_status="running",
        )
        self._emit(
            "detail_primary_scoring_started",
            "📐 正在建立不改写正文的词级概率基线",
            current=current,
            total=total,
            preset_id=preset_id,
            input_path=media_path,
            media_progress_percent=70,
            media_elapsed_seconds=time.monotonic() - media_started_at,
            media_status="running",
        )
        scoring_options = dict(params)
        scoring_options["word_timestamps"] = True
        generated_scoring, _scoring_info = engine.transcribe(
            str(media_path),
            **scoring_options,
        )
        scoring_segments: list[object] = []
        for segment in generated_scoring:
            self._check_cancelled()
            scoring_segments.append(segment)
        self._emit(
            "detail_primary_scoring_completed",
            "📐 词级概率基线已建立；稳定第一遍正文保持不变",
            current=current,
            total=total,
            preset_id=preset_id,
            input_path=media_path,
            media_progress_percent=75,
            media_elapsed_seconds=time.monotonic() - media_started_at,
            media_status="running",
        )
        diagnostics: list[dict[str, Any]] = []
        replacements: list[tuple[DetailCandidateRegion, list[object]]] = []
        for index, region in enumerate(candidates, start=1):
            self._check_cancelled()
            context = prior_context(primary_segments, region.start)
            candidate_options = dict(params)
            candidate_options.update(
                {
                    "language": "zh",
                    "task": "transcribe",
                    "multilingual": False,
                    "condition_on_previous_text": True,
                    "initial_prompt": candidate_prompt(
                        params.get("initial_prompt"), context
                    ),
                    "word_timestamps": True,
                    "clip_timestamps": [
                        max(0.0, region.start - DETAIL_CLIP_PADDING_SECONDS),
                        region.end + DETAIL_CLIP_PADDING_SECONDS,
                    ],
                }
            )
            generated, candidate_info = engine.transcribe(
                str(media_path), **candidate_options
            )
            raw_candidate_segments: list[object] = []
            for segment in generated:
                self._check_cancelled()
                raw_candidate_segments.append(segment)
            candidate_quality = build_recognition_quality_diagnostics(
                raw_candidate_segments,
                candidate_info,
                candidate_options,
            )
            decision, candidate_segments = evaluate_detail_candidate(
                scoring_segments,
                raw_candidate_segments,
                region,
                candidate_quality,
                params.get("hotwords"),
            )
            decision = replace(
                decision,
                primary_text=_segment_excerpt(
                    primary_segments,
                    region.start,
                    region.end,
                ),
            )
            if decision.decision == "replaced":
                if not stable_splice_boundary_is_safe(primary_segments, region):
                    decision = replace(
                        decision,
                        decision="review",
                        reason="unsafe_boundary",
                    )
                else:
                    tentative_replacements = [
                        *replacements,
                        (region, candidate_segments),
                    ]
                    tentative_segments = splice_detail_candidates(
                        primary_segments,
                        tentative_replacements,
                    )
                    if replacement_preserves_protected_content(
                        primary_segments,
                        tentative_segments,
                        params.get("hotwords"),
                    ):
                        replacements = tentative_replacements
                    else:
                        decision = replace(
                            decision,
                            decision="review",
                            reason="protected_content_changed",
                        )
            if decision.decision != "unchanged":
                diagnostics.append(
                    {
                        "start": region.start,
                        "end": region.end,
                        "chinese_probability": region.chinese_probability,
                        "primary_text": decision.primary_text[:160],
                        "candidate_text": decision.candidate_text[:160],
                        "decision": decision.decision,
                        "reason": decision.reason,
                        "primary_word_probability": decision.primary_word_probability,
                        "candidate_word_probability": decision.candidate_word_probability,
                        "primary_log_probability": decision.primary_log_probability,
                        "candidate_log_probability": decision.candidate_log_probability,
                        "recovered_hotwords": list(decision.recovered_hotwords[:20]),
                    }
                )
            percent = 75 + index / max(1, len(candidates)) * 23
            label = {
                "replaced": "已采用",
                "review": "建议复核",
                "rejected": "已拒绝",
                "unchanged": "结果一致",
            }[decision.decision]
            self._emit(
                "detail_second_pass_progress",
                f"🔎 中文细节复识别 {index}/{len(candidates)} · {label}",
                current=current,
                total=total,
                preset_id=preset_id,
                input_path=media_path,
                media_progress_percent=percent,
                media_elapsed_seconds=time.monotonic() - media_started_at,
                media_status="running",
            )
        return (
            splice_detail_candidates(primary_segments, replacements),
            diagnostics,
            len(candidates),
        )

    @staticmethod
    def _merge_segments(preset: Preset, segments):
        if preset.format_language == "zh":
            return merge_chinese_segments_to_sentences(segments)
        return merge_english_segments_to_sentences(segments)

    def run(
        self,
        request: TranscriptionRequest,
        *,
        engine: TranscriptionEngine | None = None,
    ) -> BatchResult:
        """Run discovery, model setup and every file in a resilient batch."""
        preset = resolve_preset(request.preset_id)
        try:
            media_files = discover_media_files(request.input_path)
        except MediaDiscoveryError as exc:
            message = str(exc)
            self._emit(
                "input_invalid",
                message,
                preset_id=preset.id,
                input_path=request.input_path,
            )
            return BatchResult.from_results(
                [TranscriptionResult(request, False, error=message)]
            )

        forced_output_dir = None
        if request.output_dir is not None:
            forced_output_dir = prepare_forced_output_directory(request.output_dir)
        normalized_request = TranscriptionRequest(
            request.input_path,
            preset.id,
            forced_output_dir,
            request.desktop,
            request.recognition_strategy,
        )
        active_engine = (
            engine if engine is not None else self._create_default_engine(preset.id)
        )
        listing = "\n".join(f"   • {path}" for path in media_files)
        self._emit(
            "media_discovered",
            f"📁 找到 {len(media_files)} 个媒体文件:\n{listing}\n",
            current=0,
            total=len(media_files),
            preset_id=preset.id,
            input_path=request.input_path,
        )

        results = []
        total = len(media_files)
        for current, media_path in enumerate(media_files, start=1):
            file_request = TranscriptionRequest(
                media_path,
                preset.id,
                normalized_request.output_dir,
                normalized_request.desktop,
                normalized_request.recognition_strategy,
            )
            try:
                result = self.transcribe_file(
                    file_request,
                    active_engine,
                    current=current,
                    total=total,
                )
            except TranscriptionCancelled:
                raise
            except Exception as exc:
                error = str(exc) or type(exc).__name__
                result = TranscriptionResult(file_request, False, error=error)
                self._emit(
                    "file_failed",
                    f"\n❌ 处理 {media_path.name} 时出错: {error}",
                    current=current,
                    total=total,
                    preset_id=preset.id,
                    input_path=media_path,
                    media_status="failed",
                )
            results.append(result)

        batch = BatchResult.from_results(results)
        output_message = (
            f"📂 强制输出目录: {normalized_request.output_dir.absolute()}"
            if normalized_request.output_dir is not None
            else "📂 输出位置: 各媒体文件所在目录的 Text 子文件夹中"
        )
        self._emit(
            "batch_completed",
            "\n".join(
                (
                    "\n" + "=" * 60,
                    f"🎉 全部处理完成! 成功: {batch.success_count} / {total}",
                    output_message,
                    "=" * 60,
                )
            ),
            current=total,
            total=total,
            preset_id=preset.id,
            input_path=request.input_path,
        )
        return batch


def transcribe(
    request: TranscriptionRequest,
    *,
    engine: TranscriptionEngine | None = None,
    progress: ProgressReporter | None = None,
) -> BatchResult:
    """Convenience function for callers that do not need a service instance."""
    return TranscriptionService(progress=progress).run(request, engine=engine)


def _segment_excerpt(segments: list[object], start: float, end: float) -> str:
    pieces = [
        str(getattr(segment, "text", "")).strip()
        for segment in segments
        if (midpoint := _segment_midpoint(segment)) is not None
        and start <= midpoint <= end
    ]
    if not any(pieces):
        pieces = [
            str(getattr(segment, "text", "")).strip()
            for segment in segments
            if (
                isinstance(getattr(segment, "start", None), (int, float))
                and isinstance(getattr(segment, "end", None), (int, float))
                and float(getattr(segment, "end")) >= start
                and float(getattr(segment, "start")) <= end
            )
        ]
    return " ".join(" ".join(pieces).split())[:160]


def _segment_midpoint(segment: object) -> float | None:
    start = getattr(segment, "start", None)
    end = getattr(segment, "end", None)
    if not isinstance(start, (int, float)) or not isinstance(end, (int, float)):
        return None
    return float(start) + (float(end) - float(start)) / 2


def _mark_region_diagnostics(
    diagnostics: list[dict[str, Any]],
    region: EnglishCandidateRegion,
    candidate_segments: list[object],
    *,
    decision: str,
    reason: str | None,
) -> None:
    candidate_text = " ".join(
        str(getattr(segment, "text", "")).strip() for segment in candidate_segments
    )
    candidate_text = " ".join(candidate_text.split())[:160]
    for item in diagnostics:
        if item["start"] < region.end and item["end"] > region.start:
            item["candidate_text"] = candidate_text
            item["decision"] = decision
            item["reason"] = reason
