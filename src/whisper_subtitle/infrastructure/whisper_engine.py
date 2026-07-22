"""Concrete faster-whisper adapter with lazy dependency loading."""

from __future__ import annotations

import importlib
from collections.abc import Iterable
from pathlib import Path
from typing import Any, Callable

from .hardware import HardwareInfo
from ..paths import AppPaths, ModelLocation


DEFAULT_MODEL_NAME = "large-v3-turbo"
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
