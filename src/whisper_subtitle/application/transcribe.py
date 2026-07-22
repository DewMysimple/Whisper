"""The single application use case for every transcription preset."""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path

from ..bootstrap import configure_runtime
from ..domain.contracts import (
    BatchResult,
    Preset,
    ProgressEvent,
    TranscriptionRequest,
    TranscriptionResult,
)
from ..domain.postprocess import (
    apply_strategy,
    merge_chinese_segments_to_sentences,
    merge_english_segments_to_sentences,
)
from ..domain.presets import resolve_preset
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
    ) -> None:
        self._progress(
            ProgressEvent(
                stage=stage,
                message=message,
                current=current,
                total=total,
                preset_id=preset_id,
                input_path=input_path,
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
        )

        output_plan = output_plan or build_output_plan(
            media_path, request.output_dir, desktop=request.desktop
        )
        prepare_output_plan(output_plan)
        self._check_cancelled()
        params = preset.transcription_options()
        if output_plan.primary_srt is not None:
            # SRT timing needs the model's real word boundaries. Canonical
            # TXT/Markdown presets keep their established parameter values.
            params["word_timestamps"] = True
        segments, info = engine.transcribe(str(media_path), **params)
        self._emit(
            "language_detected",
            f"🌐 检测到语言: {info.language} (概率: {info.language_probability:.2f})",
            current=current,
            total=total,
            preset_id=preset.id,
            input_path=media_path,
        )

        segment_list = []
        for segment in segments:
            self._check_cancelled()
            segment_list.append(segment)
        self._emit(
            "segments_collected",
            f"🧩 原始片段数: {len(segment_list)}",
            current=current,
            total=total,
            preset_id=preset.id,
            input_path=media_path,
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
                str(preset.params["language"]),
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

    @staticmethod
    def _merge_segments(preset: Preset, segments):
        if preset.params["language"] == "zh":
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
