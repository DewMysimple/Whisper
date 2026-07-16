"""Stable domain contracts and configuration registries."""

from .contracts import (
    BatchResult,
    Preset,
    ProgressEvent,
    TranscriptionRequest,
    TranscriptionResult,
)
from .transcription import TranscriptionEngine

__all__ = [
    "BatchResult",
    "Preset",
    "ProgressEvent",
    "TranscriptionRequest",
    "TranscriptionResult",
    "TranscriptionEngine",
]
from .presets import EDITABLE_PARAMETER_RULES, derive_preset

__all__ = ["EDITABLE_PARAMETER_RULES", "derive_preset"]
