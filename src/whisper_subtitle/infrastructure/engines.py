"""Composition boundary for inference backends; no eager ML imports."""

from __future__ import annotations

from ..domain.models import DEFAULT_MODEL_ID, MODELS_BY_ID
from ..domain.transcription import TranscriptionEngine
from ..paths import ModelLocation
from .hardware import HardwareDetector, HardwareInfo


def hardware_detector(model_id: str = DEFAULT_MODEL_ID):
    if MODELS_BY_ID[model_id].backend == "qwen3-asr":
        from .torch_hardware import TorchHardwareDetector
        return TorchHardwareDetector()
    return HardwareDetector()


def load_engine(hardware: HardwareInfo, location: ModelLocation,
                model_id: str = DEFAULT_MODEL_ID) -> TranscriptionEngine:
    backend = MODELS_BY_ID[model_id].backend
    if backend == "qwen3-asr":
        from .qwen_engine import QwenASREngine
        return QwenASREngine.load(hardware, location, model_name=model_id)
    from .whisper_engine import FasterWhisperEngine
    return FasterWhisperEngine.load(hardware, location, model_name=model_id)
