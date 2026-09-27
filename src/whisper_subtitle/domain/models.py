"""Canonical model identities, local artifacts and backend capabilities."""

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
    backend: str = "faster-whisper"
    required_files: tuple[str, ...] = ("config.json", "model.bin")
    config_model_type: str | None = None
    config_architecture: str | None = None
    companion_id: str | None = None


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
    ),
    ModelDefinition(
        "qwen3-asr-1.7b", "Qwen3-ASR 1.7B", ("Qwen/Qwen3-ASR-1.7B-hf",),
        translation=False, backend="qwen3-asr",
        required_files=("config.json", "processor_config.json", "tokenizer_config.json", "tokenizer.json", "chat_template.jinja"),
        config_model_type="qwen3_asr", config_architecture="Qwen3ASRForConditionalGeneration", companion_id="qwen3-forced-aligner-0.6b",
    ),
    ModelDefinition(
        "qwen3-asr-0.6b", "Qwen3-ASR 0.6B", ("Qwen/Qwen3-ASR-0.6B-hf",),
        translation=False, backend="qwen3-asr",
        required_files=("config.json", "processor_config.json", "tokenizer_config.json", "tokenizer.json", "chat_template.jinja"),
        config_model_type="qwen3_asr", config_architecture="Qwen3ASRForConditionalGeneration", companion_id="qwen3-forced-aligner-0.6b",
    ),
)

# Companions share discovery/packaging rules but cannot be selected as ASR models.
COMPANION_DEFINITIONS = (
    ModelDefinition(
        "qwen3-forced-aligner-0.6b", "Qwen3 ForcedAligner 0.6B",
        ("Qwen/Qwen3-ForcedAligner-0.6B-hf",),
        translation=False, backend="qwen3-asr",
        required_files=("config.json", "processor_config.json", "tokenizer_config.json", "tokenizer.json", "chat_template.jinja"),
        config_model_type="qwen3_asr", config_architecture="Qwen3ASRForTokenClassification",
    ),
)
MODEL_ASSETS = MODEL_DEFINITIONS + COMPANION_DEFINITIONS
MODELS_BY_ID = MappingProxyType({model.id: model for model in MODEL_DEFINITIONS})
ASSETS_BY_ID = MappingProxyType({model.id: model for model in MODEL_ASSETS})

DEFAULT_MODEL_ID = "large-v3-turbo"
SUPPORTED_MODEL_IDS = tuple(model.id for model in MODEL_DEFINITIONS)
MODEL_REPOSITORIES = MappingProxyType(
    {model.id: model.repositories for model in MODEL_ASSETS}
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
