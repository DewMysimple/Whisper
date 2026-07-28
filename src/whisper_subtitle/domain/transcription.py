"""Inference-library-neutral transcription boundary."""

from __future__ import annotations

from collections.abc import Iterable
from collections.abc import Callable
from typing import Any, Protocol, runtime_checkable

from .mixed_language import LanguageDetectionRegion


@runtime_checkable
class TranscriptionEngine(Protocol):
    """Port implemented by concrete speech-to-text inference adapters."""

    def transcribe(
        self,
        media_path: str,
        **options: Any,
    ) -> tuple[Iterable[Any], Any]:
        """Transcribe one media path with preset-specific options."""

    def detect_language_regions(
        self,
        media_path: str,
        *,
        max_speech_duration_s: float,
        min_silence_duration_ms: int,
        speech_pad_ms: int = 200,
        cancelled: Callable[[], bool] | None = None,
    ) -> list[LanguageDetectionRegion]:
        """Detect real per-speech-region language probabilities."""
