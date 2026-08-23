"""Task snapshot types owned by the Worker scheduler."""

from __future__ import annotations

import threading
from dataclasses import dataclass, field
from collections.abc import Mapping
from pathlib import Path
from typing import Any

from ..domain.contracts import Preset
from ..infrastructure.hardware import HardwareInfo
from ..infrastructure.output_store import OutputConflict, OutputPlan


@dataclass(slots=True)
class WorkerTask:
    task_id: str
    request_id: str
    inputs: tuple[Mapping[str, Any], ...]
    model_id: str
    hardware_preference: Mapping[str, object]
    hardware: HardwareInfo
    preset: Preset
    media_paths: tuple[Path, ...]
    media_durations_seconds: tuple[float | None, ...]
    output_plans: tuple[OutputPlan, ...]
    subtitle_options: Mapping[str, Any] | None = None
    skipped_media: tuple[OutputConflict, ...] = ()
    recognition_strategy: str = "stable_primary"
    cancel: threading.Event = field(default_factory=threading.Event)
    state: str = "queued"
    started_at_monotonic: float | None = None
