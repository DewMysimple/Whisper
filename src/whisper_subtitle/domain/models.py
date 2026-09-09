"""Canonical local Whisper model catalog and capability groups."""

from __future__ import annotations

from dataclasses import dataclass
from types import MappingProxyType


@dataclass(frozen=True, slots=True)
class ModelDefinition:
    """Stable model identity shared by Python and generated desktop catalogs."""

    id: str
    label: str
    repositories: tuple[str, ...]
    calibrated_parameters: bool = False
    secondary_recognition: bool = False
    translation: bool = True
    visible: bool = False


MODEL_DEFINITIONS = (
    ModelDefinition("tiny", "Tiny", ("Systran/faster-whisper-tiny",)),
    ModelDefinition("base", "Base", ("Systran/faster-whisper-base",)),
    ModelDefinition("small", "Small", ("Systran/faster-whisper-small",)),
    ModelDefinition("medium", "Medium", ("Systran/faster-whisper-medium",)),
    ModelDefinition(
        "large-v3",
        "Large V3",
        ("Systran/faster-whisper-large-v3",),
        calibrated_parameters=True,
        secondary_recognition=True,
        visible=True,
    ),
    ModelDefinition(
        "large-v3-turbo",
        "Large V3 Turbo",
        (
            "mobiuslabsgmbh/faster-whisper-large-v3-turbo",
            "Systran/faster-whisper-large-v3-turbo",
        ),
        calibrated_parameters=True,
        secondary_recognition=True,
        translation=False,
        visible=True,
    ),
)

DEFAULT_MODEL_ID = "large-v3-turbo"
SUPPORTED_MODEL_IDS = tuple(model.id for model in MODEL_DEFINITIONS)
MODEL_REPOSITORIES = MappingProxyType(
    {model.id: model.repositories for model in MODEL_DEFINITIONS}
)
CALIBRATED_MODEL_IDS = frozenset(
    model.id for model in MODEL_DEFINITIONS if model.calibrated_parameters
)
SECONDARY_RECOGNITION_MODEL_IDS = frozenset(
    model.id for model in MODEL_DEFINITIONS if model.secondary_recognition
)
TRANSLATION_MODEL_IDS = frozenset(
    model.id for model in MODEL_DEFINITIONS if model.translation
)
VISIBLE_MODEL_IDS = tuple(model.id for model in MODEL_DEFINITIONS if model.visible)
