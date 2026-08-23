"""Headless persistent Worker runtime for Desktop IPC v1."""

from __future__ import annotations

import logging
import os
import platform
import threading
import time
import uuid
from collections import deque
from collections.abc import Callable, Mapping, Sequence
from pathlib import Path
from typing import Any

from ..application.transcribe import TranscriptionCancelled, TranscriptionService
from ..bootstrap import configure_runtime
from ..domain.contracts import Preset, ProgressEvent, TranscriptionRequest
from ..domain.presets import derive_preset
from ..infrastructure.environment_check import check_worker_environment
from ..infrastructure.hardware import HardwareDetector, HardwareInfo
from ..infrastructure.media_files import MediaDiscoveryError, discover_media_files
from ..infrastructure.output_store import (
    OutputConflict,
    OutputConflictError,
    OutputPlan,
    select_configurable_outputs,
)
from ..infrastructure.performance import collect_performance_sample
from ..infrastructure.whisper_engine import DEFAULT_MODEL_NAME
from ..protocol import (
    CommandMessage,
    CommandMethod,
    ErrorCode,
    ErrorMessage,
    EventCode,
    EventMessage,
    TaskStage,
)
from .runtime_types import (
    DEFAULT_MODEL_IDLE_TIMEOUT_SECONDS,
    EngineLoader,
    EnvironmentChecker,
    HardwareCapabilityLoader,
    HardwareProbe,
    MediaDurationProbe,
    MessageEmitter,
    PerformanceSampler,
    RuntimeConfigurer,
    TaskIdFactory,
    WorkerCommandError,
    _default_engine_loader,
)


def _default_media_duration_probe(
    path: Path,
) -> tuple[bool, float | None, str | None]:
    """Read container metadata through the PyAV runtime bundled with the Worker."""
    try:
        import av

        with av.open(str(path), mode="r") as container:
            duration: float | None = None
            if container.duration is not None and container.duration > 0:
                duration = float(container.duration) / float(av.time_base)
            if duration is None:
                stream_durations = [
                    float(stream.duration * stream.time_base)
                    for stream in container.streams
                    if stream.duration is not None
                    and stream.time_base is not None
                    and stream.duration > 0
                ]
                if stream_durations:
                    duration = max(stream_durations)
        return True, duration, None
    except Exception as exc:
        return False, None, str(exc) or type(exc).__name__


def normalize_input_path(value: str) -> Path:
    """Normalize one structured path without shell parsing or tokenization."""
    normalized = value.strip()
    if len(normalized) >= 2 and normalized.startswith('"') and normalized.endswith('"'):
        normalized = normalized[1:-1]
    if not normalized:
        raise ValueError("input path is empty")
    return Path(normalized).resolve(strict=False)


def _path_key(path: Path) -> str:
    return str(path.resolve(strict=False)).casefold()


def expand_input_sources(inputs: Sequence[Mapping[str, Any]]) -> tuple[Path, ...]:
    """Expand files/directories in source order and deduplicate Windows-style."""
    media_paths: list[Path] = []
    seen: set[str] = set()
    issues: list[dict[str, str]] = []

    for index, source in enumerate(inputs):
        raw_path = source.get("path")
        kind = source.get("kind")
        try:
            if not isinstance(raw_path, str):
                raise ValueError("path must be a string")
            path = normalize_input_path(raw_path)
            if kind == "file" and not path.is_file():
                raise ValueError("declared file does not exist or is not a file")
            if kind == "directory" and not path.is_dir():
                raise ValueError("declared directory does not exist or is not a directory")
            if kind not in {"file", "directory"}:
                raise ValueError("unsupported input kind")
            discovered = discover_media_files(path)
        except (MediaDiscoveryError, OSError, ValueError) as exc:
            issues.append(
                {
                    "index": str(index),
                    "path": str(raw_path),
                    "reason": str(exc),
                }
            )
            continue

        for media_path in discovered:
            key = _path_key(media_path)
            if key not in seen:
                seen.add(key)
                media_paths.append(media_path)

    if issues:
        raise WorkerCommandError(
            ErrorCode.REQUEST_INVALID,
            "one or more input sources are invalid",
            data={"inputs": issues},
        )
    if not media_paths:
        raise WorkerCommandError(
            ErrorCode.REQUEST_INVALID,
            "input sources did not produce supported media",
        )
    return tuple(media_paths)


_PROGRESS_STAGE_MAP = {
    "file_started": TaskStage.TRANSCRIPTION_RUNNING,
    "segment_progress": TaskStage.TRANSCRIPTION_RUNNING,
    "language_detected": TaskStage.TRANSCRIPTION_RUNNING,
    "segments_collected": TaskStage.TRANSCRIPTION_RUNNING,
    "language_scan_started": TaskStage.TRANSCRIPTION_RUNNING,
    "language_scan_completed": TaskStage.TRANSCRIPTION_RUNNING,
    "secondary_pass_progress": TaskStage.TRANSCRIPTION_RUNNING,
    "detail_scan_started": TaskStage.TRANSCRIPTION_RUNNING,
    "detail_scan_completed": TaskStage.TRANSCRIPTION_RUNNING,
    "detail_primary_scoring_started": TaskStage.TRANSCRIPTION_RUNNING,
    "detail_primary_scoring_completed": TaskStage.TRANSCRIPTION_RUNNING,
    "detail_second_pass_progress": TaskStage.TRANSCRIPTION_RUNNING,
    "file_failed": TaskStage.TRANSCRIPTION_RUNNING,
    "sentences_merged": TaskStage.POSTPROCESS_RUNNING,
    "repetitions_removed": TaskStage.POSTPROCESS_RUNNING,
    "output_written": TaskStage.OUTPUT_WRITING,
    "desktop_output_written": TaskStage.OUTPUT_WRITING,
}


from .model_cache import ModelCache
from .task import WorkerTask
from .task_execution import execute_task


class WorkerRuntime:
    """Queue and execute Worker commands while keeping one model resident."""

    def __init__(
        self,
        emit: MessageEmitter,
        *,
        environment_checker: EnvironmentChecker = check_worker_environment,
        model_cache: ModelCache | None = None,
        idle_timeout_seconds: float = DEFAULT_MODEL_IDLE_TIMEOUT_SECONDS,
        task_id_factory: TaskIdFactory | None = None,
        logger: logging.Logger | None = None,
        runtime_configurer: RuntimeConfigurer = configure_runtime,
        hardware_detector: HardwareProbe | None = None,
        hardware_capability_loader: HardwareCapabilityLoader | None = None,
        engine_loader: EngineLoader = _default_engine_loader,
        performance_sampler: PerformanceSampler = collect_performance_sample,
        media_duration_probe: MediaDurationProbe = _default_media_duration_probe,
    ) -> None:
        self._emit = emit
        self._check_environment = environment_checker
        self._logger = logger or logging.getLogger(__name__)
        self._task_id_factory = task_id_factory or (
            lambda: f"task-{uuid.uuid4().hex}"
        )
        self._performance_sampler = performance_sampler
        self._media_duration_probe = media_duration_probe
        self._media_duration_cache: dict[
            str, tuple[int, int, tuple[bool, float | None, str | None]]
        ] = {}
        if hardware_detector is None:
            detector = HardwareDetector()
            hardware_detector = detector.detect
            hardware_capability_loader = hardware_capability_loader or detector.capabilities
        self._hardware_capability_loader = hardware_capability_loader
        self._condition = threading.Condition()
        self._queue: deque[WorkerTask] = deque()
        self._tasks: dict[str, WorkerTask] = {}
        self._request_ids: set[str] = set()
        self._reserved_output_paths: dict[str, int] = {}
        self._active_task: WorkerTask | None = None
        self._stopping = False
        self._model_cache = model_cache or ModelCache(
            emit,
            runtime_configurer=runtime_configurer,
            hardware_detector=hardware_detector,
            engine_loader=engine_loader,
            idle_timeout_seconds=idle_timeout_seconds,
            logger=self._logger,
        )
        self._dispatcher = threading.Thread(
            target=self._dispatch_loop,
            name="whisper-worker-dispatcher",
            daemon=True,
        )
        self._dispatcher.start()

    @property
    def model_cache(self) -> ModelCache:
        return self._model_cache

    @property
    def active_task_id(self) -> str | None:
        with self._condition:
            return self._active_task.task_id if self._active_task else None

    def _complete_command(
        self,
        command: CommandMessage,
        result: Mapping[str, Any],
    ) -> None:
        self._emit(
            EventMessage(
                EventCode.COMMAND_COMPLETED,
                {"method": command.method.value, "result": dict(result)},
                request_id=command.request_id,
            )
        )

    def _health_result(self) -> dict[str, Any]:
        with self._condition:
            if self._stopping:
                state = "stopping"
            elif self._active_task is not None:
                state = "running"
            else:
                state = "idle"
            active_task_id = (
                self._active_task.task_id if self._active_task is not None else None
            )
            queued_count = len(self._queue)
        hardware = self._model_cache.hardware
        return {
            "status": "ok",
            "worker_state": state,
            "active_task_id": active_task_id,
            "queued_count": queued_count,
            "model_loaded": self._model_cache.loaded,
            "model_id": self._model_cache.model_id,
            "hardware": (
                {
                    "device": hardware.device,
                    "device_index": hardware.device_index,
                    "compute_type": hardware.compute_type,
                    "cpu_threads": hardware.cpu_threads,
                }
                if hardware is not None
                else None
            ),
        }

    def handle_command(self, command: CommandMessage) -> bool:
        """Handle one validated command; return True when the loop should stop."""
        if command.method is CommandMethod.SYSTEM_HEALTH:
            self._complete_command(command, self._health_result())
            return False
        if command.method is CommandMethod.SYSTEM_ENVIRONMENT:
            errors = self._check_environment()
            hardware = None
            if self._hardware_capability_loader is not None:
                try:
                    hardware = dict(self._hardware_capability_loader())
                except Exception as exc:
                    self._logger.warning("hardware capability detection failed: %s", exc)
            self._complete_command(
                command,
                {
                    "available": not errors,
                    "errors": errors,
                    "python": platform.python_version(),
                    "platform": platform.platform(),
                    "hardware": hardware,
                },
            )
            return False
        if command.method is CommandMethod.SYSTEM_METRICS:
            self._complete_command(command, self._performance_sampler())
            return False
        if command.method is CommandMethod.MEDIA_INSPECT:
            paths = tuple(Path(str(value)) for value in command.params["paths"])
            inspections = self._inspect_media_paths(paths)
            self._complete_command(
                command,
                {
                    "items": [
                        {
                            "path": str(path),
                            "readable": readable,
                            "duration_seconds": duration,
                            "error": error,
                        }
                        for path, (readable, duration, error) in zip(
                            paths, inspections, strict=True
                        )
                    ]
                },
            )
            return False

        with self._condition:
            if self._stopping:
                raise WorkerCommandError(
                    ErrorCode.WORKER_BUSY,
                    "worker is shutting down",
                )

        if command.method is CommandMethod.MODEL_LOAD:
            model_id = str(command.params.get("model_id") or DEFAULT_MODEL_NAME)
            hardware_preference = command.params.get("hardware")
            loaded_new = self._model_cache.load(
                model_id,
                hardware_preference=hardware_preference,
                request_id=command.request_id,
            )
            self._complete_command(
                command,
                {"model_id": model_id, "reused": not loaded_new},
            )
            return False
        if command.method is CommandMethod.MODEL_UNLOAD:
            unloaded = self._model_cache.unload()
            self._complete_command(command, {"unloaded": unloaded})
            return False
        if command.method is CommandMethod.TRANSCRIPTION_START:
            self._start_task(command)
            return False
        if command.method is CommandMethod.TRANSCRIPTION_CANCEL:
            self._cancel_task(command)
            return False
        if command.method is CommandMethod.WORKER_SHUTDOWN:
            self._complete_command(command, {"accepted": True})
            self.request_shutdown(reason="shutdown")
            return True
        raise WorkerCommandError(
            ErrorCode.PROTOCOL_UNKNOWN_METHOD,
            f"unsupported worker command: {command.method.value}",
        )

    def _inspect_media_paths(
        self, paths: Sequence[Path]
    ) -> tuple[tuple[bool, float | None, str | None], ...]:
        inspections: list[tuple[bool, float | None, str | None]] = []
        for path in paths:
            try:
                resolved = path.resolve(strict=True)
                stat = resolved.stat()
            except OSError as exc:
                inspections.append((False, None, str(exc)))
                continue
            key = str(resolved).casefold()
            cached = self._media_duration_cache.get(key)
            if cached is not None and cached[0] == stat.st_size and cached[1] == stat.st_mtime_ns:
                inspections.append(cached[2])
                continue
            result = self._media_duration_probe(resolved)
            readable, duration, error = result
            if duration is not None:
                duration = max(0.0, float(duration))
            normalized = (bool(readable), duration, error)
            self._media_duration_cache[key] = (stat.st_size, stat.st_mtime_ns, normalized)
            inspections.append(normalized)
        return tuple(inspections)

    def _start_task(self, command: CommandMessage) -> None:
        model_id = str(command.params.get("model_id") or DEFAULT_MODEL_NAME)
        hardware_preference = dict(command.params.get("hardware") or {})
        profile = command.params["profile"]
        try:
            preset = derive_preset(
                str(profile["base_preset_id"]),
                profile["overrides"],
                model_id=model_id,
            )
        except (KeyError, TypeError, ValueError) as exc:
            raise WorkerCommandError(
                ErrorCode.REQUEST_INVALID,
                str(exc),
            ) from exc
        media_paths = expand_input_sources(command.params["inputs"])
        with self._condition:
            reserved_paths = tuple(self._reserved_output_paths)
        try:
            output_selection = select_configurable_outputs(
                media_paths,
                command.params["output"],
                reserved_paths=reserved_paths,
            )
            media_paths = output_selection.media_paths
            output_plans = output_selection.plans
            skipped_media = output_selection.skipped
            if not media_paths:
                raise WorkerCommandError(
                    ErrorCode.OUTPUT_FAILED,
                    "all media inputs were skipped because outputs already exist",
                    data={
                        "exception": "AllOutputsSkipped",
                        "skipped_media": [
                            {
                                "input_path": str(conflict.media_path),
                                "paths": [str(path) for path in conflict.paths],
                            }
                            for conflict in skipped_media
                        ],
                    },
                )
        except OutputConflictError as exc:
            raise WorkerCommandError(
                ErrorCode.OUTPUT_FAILED,
                str(exc),
                data={
                    "exception": type(exc).__name__,
                    "paths": [str(path) for path in exc.paths],
                    "media_paths": [str(path) for path in exc.media_paths],
                    "conflicts": [
                        {
                            "input_path": str(conflict.media_path),
                            "paths": [str(path) for path in conflict.paths],
                        }
                        for conflict in exc.conflicts
                    ],
                },
            ) from exc
        except (OSError, TypeError, ValueError) as exc:
            raise WorkerCommandError(
                ErrorCode.REQUEST_INVALID,
                str(exc),
                data={"exception": type(exc).__name__},
            ) from exc

        media_inspections = self._inspect_media_paths(media_paths)
        unreadable = [
            (path, error)
            for path, (readable, _duration, error) in zip(
                media_paths, media_inspections, strict=True
            )
            if not readable
        ]
        if unreadable:
            path, error = unreadable[0]
            raise WorkerCommandError(
                ErrorCode.REQUEST_INVALID,
                f"media container cannot be read: {path}",
                data={
                    "exception": "MediaInspectionError",
                    "path": str(path),
                    "reason": error or "unknown media inspection failure",
                },
            )
        media_durations_seconds = tuple(
            duration for _readable, duration, _error in media_inspections
        )

        # The Windows process must perform the first faster-whisper/CTranslate2
        # lazy import and model initialization on the stdin command thread.
        # Loading a model for the first time from the dispatcher while this
        # thread blocks on the next stdin line can deadlock some runtimes.
        with self._condition:
            can_preload = self._active_task is None and not self._queue
        if can_preload:
            self._model_cache.load(
                model_id,
                hardware_preference=hardware_preference,
                request_id=command.request_id,
            )
            hardware = self._model_cache.hardware
            if hardware is None:
                raise WorkerCommandError(
                    ErrorCode.MODEL_LOAD_FAILED,
                    "model loaded without a resolved hardware configuration",
                )
        else:
            hardware = self._model_cache.validate(model_id, hardware_preference)
        task = WorkerTask(
            task_id=self._task_id_factory(),
            request_id=command.request_id,
            inputs=tuple(command.params["inputs"]),
            model_id=model_id,
            hardware_preference=hardware_preference,
            hardware=hardware,
            preset=preset,
            recognition_strategy=str(
                command.params.get("recognition_strategy") or "stable_primary"
            ),
            media_paths=media_paths,
            media_durations_seconds=media_durations_seconds,
            output_plans=output_plans,
            subtitle_options=command.params["output"].get("subtitle"),
            skipped_media=skipped_media,
        )
        with self._condition:
            if command.request_id in self._request_ids:
                raise WorkerCommandError(
                    ErrorCode.TASK_CONFLICT,
                    "request_id already created a task",
                )
            if task.task_id in self._tasks:
                raise WorkerCommandError(
                    ErrorCode.TASK_CONFLICT,
                    "task_id factory produced a duplicate identifier",
                )
            position = len(self._queue) + (1 if self._active_task else 0)
            self._request_ids.add(command.request_id)
            self._tasks[task.task_id] = task
            self._queue.append(task)
            for plan in task.output_plans:
                for path in plan.content_paths:
                    key = _path_key(path)
                    self._reserved_output_paths[key] = (
                        self._reserved_output_paths.get(key, 0) + 1
                    )
            self._emit(
                EventMessage(
                    EventCode.TASK_QUEUED,
                    {
                        "position": position,
                        "input_count": len(task.media_paths) + len(task.skipped_media),
                        "media_paths": [str(path) for path in task.media_paths],
                        "media_durations_seconds": list(task.media_durations_seconds),
                        "skipped_media": [
                            {
                                "input_path": str(conflict.media_path),
                                "paths": [str(path) for path in conflict.paths],
                            }
                            for conflict in task.skipped_media
                        ],
                        "model_id": task.model_id,
                        "recognition_strategy": task.recognition_strategy,
                        "hardware": {
                            "device": task.hardware.device,
                            "device_index": task.hardware.device_index,
                            "compute_type": task.hardware.compute_type,
                            "cpu_threads": task.hardware.cpu_threads,
                        },
                        "effective_parameters": task.preset.transcription_options(),
                    },
                    request_id=task.request_id,
                    task_id=task.task_id,
                    message="任务已加入队列",
                )
            )
            self._condition.notify_all()

    def _cancel_task(self, command: CommandMessage) -> None:
        task_id = str(command.params["task_id"])
        queued_task: WorkerTask | None = None
        with self._condition:
            task = self._tasks.get(task_id)
            if task is None or task.state in {"completed", "failed", "cancelled"}:
                raise WorkerCommandError(
                    ErrorCode.TASK_NOT_FOUND,
                    "task is not active or queued",
                    task_id=task_id,
                )
            if task is self._active_task:
                task.cancel.set()
                state = "running"
            else:
                self._queue.remove(task)
                task.state = "cancelled"
                task.cancel.set()
                self._release_task_reservations_locked(task)
                queued_task = task
                state = "queued"
            self._condition.notify_all()
        self._complete_command(
            command,
            {"accepted": True, "task_id": task_id, "previous_state": state},
        )
        if queued_task is not None:
            self._emit_cancelled(queued_task, "user")

    def _emit_progress(
        self,
        task: WorkerTask,
        stage: TaskStage,
        current: int,
        total: int,
        *,
        input_path: Path | None = None,
        message: str | None = None,
        media_progress_percent: float | None = None,
        media_elapsed_seconds: float | None = None,
        media_status: str | None = None,
        output_paths: Sequence[Path] = (),
        quality_diagnostics: Mapping[str, Any] | None = None,
    ) -> None:
        data: dict[str, Any] = {
            "stage": stage.value,
            "current": current,
            "total": total,
        }
        if input_path is not None:
            data["input_path"] = str(input_path)
        if current > 0:
            data["media_index"] = current
        if media_progress_percent is not None:
            # faster-whisper can surface NumPy scalar timing values. Normalize
            # them at the IPC boundary so the strict JSON envelope never sees
            # a third-party numeric scalar.
            data["media_progress_percent"] = round(float(media_progress_percent), 2)
        if media_elapsed_seconds is not None:
            data["media_elapsed_seconds"] = round(float(media_elapsed_seconds), 3)
        if task.started_at_monotonic is not None:
            data["task_elapsed_seconds"] = round(
                max(0.0, time.monotonic() - task.started_at_monotonic),
                3,
            )
        if media_status is not None:
            data["media_status"] = media_status
        if output_paths:
            data["output_paths"] = [str(path) for path in output_paths]
        if quality_diagnostics is not None:
            data["quality_diagnostics"] = quality_diagnostics
        self._emit(
            EventMessage(
                EventCode.TASK_PROGRESS,
                data,
                task_id=task.task_id,
                message=message,
            )
        )

    def _progress_adapter(self, task: WorkerTask) -> Callable[[ProgressEvent], None]:
        def report(event: ProgressEvent) -> None:
            stage = _PROGRESS_STAGE_MAP.get(event.stage)
            if stage is None:
                return
            self._emit_progress(
                task,
                stage,
                event.current or 0,
                event.total or 0,
                input_path=event.input_path,
                message=event.message,
                media_progress_percent=event.media_progress_percent,
                media_elapsed_seconds=event.media_elapsed_seconds,
                media_status=event.media_status,
                output_paths=event.output_paths,
                quality_diagnostics=event.quality_diagnostics,
            )

        return report

    def _emit_cancelled(self, task: WorkerTask, reason: str) -> None:
        task.state = "cancelled"
        self._emit(
            EventMessage(
                EventCode.TASK_CANCELLED,
                {"reason": reason},
                task_id=task.task_id,
                message="任务已取消",
            )
        )

    def _emit_failed(
        self,
        task: WorkerTask,
        code: ErrorCode,
        error: Exception,
        *,
        details: Mapping[str, Any] | None = None,
    ) -> None:
        task.state = "failed"
        machine_details = dict(details or {})
        machine_details.setdefault("exception", type(error).__name__)
        machine_details.setdefault("reason", str(error) or type(error).__name__)
        self._emit(
            EventMessage(
                EventCode.TASK_FAILED,
                {"error_code": code.value, "details": machine_details},
                task_id=task.task_id,
                message=str(error) or type(error).__name__,
            )
        )


    def _execute_task(self, task: WorkerTask) -> None:
        execute_task(self, task)

    def _dispatch_loop(self) -> None:
        while True:
            with self._condition:
                while not self._queue and not self._stopping:
                    self._condition.wait()
                if not self._queue and self._stopping:
                    return
                task = self._queue.popleft()
                self._active_task = task
            try:
                self._execute_task(task)
            finally:
                with self._condition:
                    self._active_task = None
                    self._release_task_reservations_locked(task)
                    self._condition.notify_all()

    def _release_task_reservations_locked(self, task: WorkerTask) -> None:
        for plan in task.output_plans:
            for path in plan.content_paths:
                key = _path_key(path)
                remaining = self._reserved_output_paths.get(key, 0) - 1
                if remaining > 0:
                    self._reserved_output_paths[key] = remaining
                else:
                    self._reserved_output_paths.pop(key, None)

    def request_shutdown(self, *, reason: str = "shutdown") -> None:
        queued: list[WorkerTask] = []
        with self._condition:
            if self._stopping:
                return
            self._stopping = True
            if self._active_task is not None:
                self._active_task.cancel.set()
            while self._queue:
                task = self._queue.popleft()
                task.cancel.set()
                task.state = "cancelled"
                self._release_task_reservations_locked(task)
                queued.append(task)
            self._condition.notify_all()
        for task in queued:
            self._emit_cancelled(task, reason)

    def wait_until_idle(self, timeout: float = 5.0) -> bool:
        deadline = time.monotonic() + timeout
        with self._condition:
            while self._active_task is not None or self._queue:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    return False
                self._condition.wait(remaining)
            return True

    def close(self, timeout: float | None = None) -> bool:
        self.request_shutdown(reason="shutdown")
        self._dispatcher.join(timeout)
        stopped = not self._dispatcher.is_alive()
        if stopped:
            self._model_cache.close()
        return stopped

    def command_error(
        self,
        command: CommandMessage,
        error: WorkerCommandError,
    ) -> ErrorMessage:
        return ErrorMessage(
            error.code,
            error.data,
            request_id=command.request_id,
            task_id=error.task_id,
            message=str(error),
        )


def worker_ready_event() -> EventMessage:
    return EventMessage(
        EventCode.WORKER_READY,
        {
            "pid": os.getpid(),
            "capabilities": {
                "methods": [method.value for method in CommandMethod],
                "events": [event.value for event in EventCode],
            },
        },
        message="Worker ready",
    )
