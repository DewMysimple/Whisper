"""Concrete faster-whisper adapter with lazy dependency loading."""

from __future__ import annotations

import importlib
from collections.abc import Iterable
from pathlib import Path
from typing import Any, Callable

from ..domain.mixed_language import LanguageDetectionRegion
from ..domain.models import DEFAULT_MODEL_ID
from .hardware import HardwareInfo
from ..paths import AppPaths, ModelLocation


DEFAULT_MODEL_NAME = DEFAULT_MODEL_ID
ModelFactory = Callable[..., Any]


def _load_model_factory() -> ModelFactory:
    module = importlib.import_module("faster_whisper")
    return module.WhisperModel


def resolve_model_location(project_root: Path) -> ModelLocation:
    """Compatibility wrapper for callers that still pass a portable root."""
    return AppPaths.discover(
        explicit_model_dir=Path(project_root) / "models" / "huggingface",
        portable_root=project_root,
        environ={},
    ).model_location


class FasterWhisperEngine:
    """Load and delegate to a faster-whisper model behind the domain port."""

    def __init__(
        self,
        model: Any,
        *,
        model_name: str,
        location: ModelLocation,
    ) -> None:
        self._model = model
        self.model_name = model_name
        self.location = location

    @classmethod
    def load(
        cls,
        hardware: HardwareInfo,
        location: ModelLocation,
        *,
        model_name: str = DEFAULT_MODEL_NAME,
        model_factory: ModelFactory | None = None,
    ) -> "FasterWhisperEngine":
        factory = model_factory or _load_model_factory()
        model_reference = (
            model_name
            if model_factory is not None
            else str(location.require_model(model_name))
        )
        model = factory(
            model_reference,
            device=hardware.device,
            device_index=hardware.device_index,
            compute_type=hardware.compute_type,
            cpu_threads=hardware.cpu_threads,
            num_workers=1,
        )
        return cls(model, model_name=model_name, location=location)

    def transcribe(
        self,
        media_path: str,
        **options: Any,
    ) -> tuple[Iterable[Any], Any]:
        return self._model.transcribe(media_path, **options)

    def detect_language_regions(
        self,
        media_path: str,
        *,
        max_speech_duration_s: float,
        min_silence_duration_ms: int,
        speech_pad_ms: int = 200,
        cancelled: Callable[[], bool] | None = None,
    ) -> list[LanguageDetectionRegion]:
        """Detect language probabilities on real VAD speech regions."""
        audio_module = importlib.import_module("faster_whisper.audio")
        vad_module = importlib.import_module("faster_whisper.vad")
        sampling_rate = self._model.feature_extractor.sampling_rate
        audio = audio_module.decode_audio(media_path, sampling_rate=sampling_rate)
        chunks = vad_module.get_speech_timestamps(
            audio,
            vad_module.VadOptions(
                min_speech_duration_ms=250,
                max_speech_duration_s=max_speech_duration_s,
                min_silence_duration_ms=min_silence_duration_ms,
                speech_pad_ms=speech_pad_ms,
            ),
            sampling_rate=sampling_rate,
        )
        regions: list[LanguageDetectionRegion] = []
        for chunk in chunks:
            if cancelled is not None and cancelled():
                break
            start_sample = int(chunk["start"])
            end_sample = int(chunk["end"])
            if end_sample <= start_sample:
                continue
            language, probability, all_probabilities = self._model.detect_language(
                audio=audio[start_sample:end_sample],
                vad_filter=False,
                language_detection_segments=1,
                language_detection_threshold=1.0,
            )
            probability_map = dict(all_probabilities)
            regions.append(
                LanguageDetectionRegion(
                    start=start_sample / sampling_rate,
                    end=end_sample / sampling_rate,
                    top_language=language,
                    top_probability=float(probability),
                    english_probability=float(probability_map.get("en", 0.0)),
                    chinese_probability=float(probability_map.get("zh", 0.0)),
                )
            )
        return regions
