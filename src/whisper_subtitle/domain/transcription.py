"""Inference-library-neutral transcription boundary."""

from __future__ import annotations

from collections.abc import Iterable
from typing import Any, Protocol, runtime_checkable


@runtime_checkable
class TranscriptionEngine(Protocol):
    """Port implemented by concrete speech-to-text inference adapters."""

    def transcribe(
        self,
        media_path: str,
        **options: Any,
    ) -> tuple[Iterable[Any], Any]:
        """Transcribe one media path with preset-specific options."""
