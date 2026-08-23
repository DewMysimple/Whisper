"""The single application use case for every transcription preset."""

from __future__ import annotations

from collections.abc import Callable, Mapping
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
from .recognition_passes import (
    run_chinese_detail_second_pass,
    run_mixed_second_pass,
)

from ..domain.mixed_language import hotword_audit
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
        return run_mixed_second_pass(
            self,
            media_path,
            engine,
            primary_segments,
            params,
            model_id=model_id,
            current=current,
            total=total,
            preset_id=preset_id,
            media_started_at=media_started_at,
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
        return run_chinese_detail_second_pass(
            self,
            media_path,
            engine,
            primary_segments,
            params,
            current=current,
            total=total,
            preset_id=preset_id,
            media_started_at=media_started_at,
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
