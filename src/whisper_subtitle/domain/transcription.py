"""Inference-library-neutral transcription boundary."""

from __future__ import annotations

from collections.abc import Callable, Iterable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field
from time import monotonic
from typing import Any, Protocol, runtime_checkable

from .mixed_language import LanguageDetectionRegion


class TranscriptionCancelled(RuntimeError):
    """Internal cooperative cancellation, never a successful partial result."""


@dataclass(frozen=True, slots=True)
class TranscribedWord:
    start: float
    end: float
    word: str


@dataclass(frozen=True, slots=True)
class TranscribedSegment:
    start: float
    end: float
    text: str
    words: tuple[TranscribedWord, ...] | None = None


@dataclass(slots=True)
class InferenceTimings:
    """Per-file engine diagnostics, including work on unsuccessful attempts."""

    stage_seconds: dict[str, float] = field(default_factory=dict)
    generation_calls: int = 0
    window_count: int = 0
    selected_window_seconds: float = 0.0
    token_retry_count: int = 0
    alignment_retry_count: int = 0

    @contextmanager
    def measure(self, stage: str) -> Iterator[None]:
        started = monotonic()
        try:
            yield
        finally:
            self.stage_seconds[stage] = self.stage_seconds.get(stage, 0) + (monotonic() - started)

    def report(self) -> dict[str, object]:
        return {
            "stage_seconds": self.stage_seconds,
            "generation_calls": self.generation_calls,
            "window_count": self.window_count,
            "selected_window_seconds": self.selected_window_seconds,
            "token_retry_count": self.token_retry_count,
            "alignment_retry_count": self.alignment_retry_count,
        }


@dataclass(slots=True)
class TranscriptionInfo:
    duration: float
    language: str | None = None
    language_probability: float | None = None
    inference_timings: InferenceTimings | None = None


@runtime_checkable
class TranscriptionEngine(Protocol):
    """Port implemented by concrete speech-to-text inference adapters."""

    def transcribe(
        self,
        media_path: str,
        **options: Any,
    ) -> tuple[Iterable[Any], Any]:
        """Transcribe one media path with preset-specific options."""


@runtime_checkable
class CancellableTranscriptionEngine(TranscriptionEngine, Protocol):
    def transcribe_cancellable(self, media_path: str, *, cancelled: Callable[[], bool], **options: Any) -> tuple[Iterable[Any], Any]:
        """Optional internal capability; cancellation is not a preset option."""

@runtime_checkable
class LanguageRegionDetector(TranscriptionEngine, Protocol):
    """Optional secondary-recognition capability provided by Whisper."""

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
