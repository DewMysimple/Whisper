"""Stable domain contracts and configuration registries."""

from .contracts import (
    BatchResult,
    Preset,
    ProgressEvent,
    TranscriptionRequest,
    TranscriptionResult,
)
from .models import DEFAULT_MODEL_ID, MODEL_DEFINITIONS, SUPPORTED_MODEL_IDS
from .presets import EDITABLE_PARAMETER_RULES, derive_preset
from .transcription import TranscriptionEngine

__all__ = [
    "BatchResult",
    "DEFAULT_MODEL_ID",
    "EDITABLE_PARAMETER_RULES",
    "MODEL_DEFINITIONS",
    "Preset",
    "ProgressEvent",
    "SUPPORTED_MODEL_IDS",
    "TranscriptionRequest",
    "TranscriptionResult",
    "TranscriptionEngine",
    "derive_preset",
]
