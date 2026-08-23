"""Shared Worker runtime types and dependency-light defaults."""

from __future__ import annotations

from collections.abc import Callable, Mapping
from pathlib import Path
from typing import Any

from ..infrastructure.hardware import HardwareInfo
from ..infrastructure.whisper_engine import FasterWhisperEngine
from ..paths import ModelLocation
from ..protocol import ErrorCode, ErrorMessage, EventMessage


DEFAULT_MODEL_IDLE_TIMEOUT_SECONDS = 15 * 60.0

MessageEmitter = Callable[[EventMessage | ErrorMessage], None]
EnvironmentChecker = Callable[[], list[str]]
RuntimeConfigurer = Callable[[], ModelLocation]
HardwareProbe = Callable[[Mapping[str, object] | None], HardwareInfo]
HardwareCapabilityLoader = Callable[[], Mapping[str, object]]
EngineLoader = Callable[[HardwareInfo, ModelLocation, str], Any]
TaskIdFactory = Callable[[], str]
PerformanceSampler = Callable[[], Mapping[str, Any]]
MediaDurationProbe = Callable[[Path], tuple[bool, float | None, str | None]]


class WorkerCommandError(RuntimeError):
    """A command failure that maps directly to a stable protocol error."""

    def __init__(
        self,
        code: ErrorCode,
        message: str,
        *,
        data: Mapping[str, Any] | None = None,
        task_id: str | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.data = dict(data or {})
        self.task_id = task_id


def _default_engine_loader(
    hardware: HardwareInfo,
    location: ModelLocation,
    model_id: str,
) -> FasterWhisperEngine:
    return FasterWhisperEngine.load(
        hardware,
        location,
        model_name=model_id,
    )
