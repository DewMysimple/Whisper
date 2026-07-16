"""Headless persistent Worker runtime for Desktop IPC v1."""

from __future__ import annotations

import gc
import logging
import os
import platform
import threading
import time
import uuid
from collections import deque
from collections.abc import Callable, Mapping, Sequence
from contextlib import contextmanager
from dataclasses import dataclass, field
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
    OutputConflictError,
    OutputPlan,
    build_configurable_output_plans,
)
from ..infrastructure.performance import collect_performance_sample
from ..infrastructure.whisper_engine import (
    DEFAULT_MODEL_NAME,
    FasterWhisperEngine,
    ModelLocation,
)
from ..protocol import (
    CommandMessage,
    CommandMethod,
    ErrorCode,
    ErrorMessage,
    EventCode,
    EventMessage,
    TaskStage,
)


DEFAULT_MODEL_IDLE_TIMEOUT_SECONDS = 15 * 60.0

MessageEmitter = Callable[[EventMessage | ErrorMessage], None]
EnvironmentChecker = Callable[[], list[str]]
RuntimeConfigurer = Callable[[], ModelLocation]
HardwareProbe = Callable[[], HardwareInfo]
EngineLoader = Callable[[HardwareInfo, ModelLocation, str], Any]
TaskIdFactory = Callable[[], str]
PerformanceSampler = Callable[[], Mapping[str, Any]]


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


class ModelCache:
    """Own one reusable model and release it after a configurable idle period."""

    def __init__(
        self,
        emit: MessageEmitter,
        *,
        runtime_configurer: RuntimeConfigurer = configure_runtime,
        hardware_detector: HardwareProbe | None = None,
        engine_loader: EngineLoader = _default_engine_loader,
        idle_timeout_seconds: float = DEFAULT_MODEL_IDLE_TIMEOUT_SECONDS,
        logger: logging.Logger | None = None,
    ) -> None:
        if idle_timeout_seconds < 0:
            raise ValueError("idle_timeout_seconds must be non-negative")
        self._emit = emit
        self._configure_runtime = runtime_configurer
        self._detect_hardware = hardware_detector or HardwareDetector().detect
        self._load_engine = engine_loader
        self._idle_timeout = float(idle_timeout_seconds)
        self._logger = logger or logging.getLogger(__name__)
        self._lock = threading.RLock()
        self._timer: threading.Timer | None = None
        self._engine: Any | None = None
        self._hardware: HardwareInfo | None = None
        self._model_id: str | None = None
        self._active_users = 0

    @property
    def model_id(self) -> str | None:
        with self._lock:
            return self._model_id

    @property
    def loaded(self) -> bool:
        with self._lock:
            return self._engine is not None

    @property
    def active_users(self) -> int:
        with self._lock:
            return self._active_users

    def _cancel_timer_locked(self) -> None:
        if self._timer is not None:
            self._timer.cancel()
            self._timer = None

    def _schedule_idle_release_locked(self) -> None:
        self._cancel_timer_locked()
        if self._engine is None or self._active_users or self._idle_timeout == 0:
            if self._engine is not None and not self._active_users and self._idle_timeout == 0:
                self._release_locked("zero idle timeout")
            return
        timer = threading.Timer(self._idle_timeout, self._release_if_idle)
        timer.daemon = True
        self._timer = timer
        timer.start()

    def _release_if_idle(self) -> None:
        with self._lock:
            self._timer = None
            if self._active_users == 0:
                self._release_locked("idle timeout")

    def _release_locked(self, reason: str) -> bool:
        if self._engine is None:
            return False
        model_id = self._model_id
        self._engine = None
        self._hardware = None
        self._model_id = None
        gc.collect()
        self._logger.info("released model %s (%s)", model_id, reason)
        return True

    def _ensure_loaded_locked(
        self,
        model_id: str,
        *,
        request_id: str | None = None,
    ) -> tuple[Any, HardwareInfo, bool]:
        if self._engine is not None and self._model_id == model_id:
            return self._engine, self._hardware, False
        if self._active_users:
            raise WorkerCommandError(
                ErrorCode.WORKER_BUSY,
                "cannot replace the model while a task is using it",
            )
        self._cancel_timer_locked()
        self._release_locked("model replacement")
        self._emit(
            EventMessage(
                EventCode.MODEL_LOADING,
                {"model_id": model_id},
                request_id=request_id,
                message="正在加载模型",
            )
        )
        try:
            location = self._configure_runtime()
            hardware = self._detect_hardware()
            engine = self._load_engine(hardware, location, model_id)
        except Exception as exc:
            raise WorkerCommandError(
                ErrorCode.MODEL_LOAD_FAILED,
                str(exc) or type(exc).__name__,
                data={"model_id": model_id, "exception": type(exc).__name__},
            ) from exc
        self._engine = engine
        self._hardware = hardware
        self._model_id = model_id
        self._emit(
            EventMessage(
                EventCode.MODEL_READY,
                {
                    "model_id": model_id,
                    "device": hardware.device,
                    "compute_type": hardware.compute_type,
                },
                request_id=request_id,
                message="模型已就绪",
            )
        )
        return engine, hardware, True

    def load(self, model_id: str, *, request_id: str | None = None) -> bool:
        with self._lock:
            _engine, _hardware, loaded_new = self._ensure_loaded_locked(
                model_id, request_id=request_id
            )
            self._schedule_idle_release_locked()
            return loaded_new

    @contextmanager
    def acquire(self, model_id: str, *, request_id: str | None = None):
        with self._lock:
            engine, hardware, _loaded_new = self._ensure_loaded_locked(
                model_id, request_id=request_id
            )
            self._cancel_timer_locked()
            self._active_users += 1
        try:
            yield engine, hardware
        finally:
            with self._lock:
                self._active_users -= 1
                self._schedule_idle_release_locked()

    def unload(self, *, reason: str = "explicit request") -> bool:
        with self._lock:
            if self._active_users:
                raise WorkerCommandError(
                    ErrorCode.WORKER_BUSY,
                    "cannot unload the model while a task is running",
                )
            self._cancel_timer_locked()
            return self._release_locked(reason)

    def close(self) -> None:
        with self._lock:
            self._cancel_timer_locked()
            self._release_locked("worker shutdown")


@dataclass(slots=True)
class WorkerTask:
    task_id: str
    request_id: str
    inputs: tuple[Mapping[str, Any], ...]
    preset: Preset
    media_paths: tuple[Path, ...]
    output_plans: tuple[OutputPlan, ...]
    cancel: threading.Event = field(default_factory=threading.Event)
    state: str = "queued"


_PROGRESS_STAGE_MAP = {
    "file_started": TaskStage.TRANSCRIPTION_RUNNING,
    "language_detected": TaskStage.TRANSCRIPTION_RUNNING,
    "segments_collected": TaskStage.TRANSCRIPTION_RUNNING,
    "sentences_merged": TaskStage.POSTPROCESS_RUNNING,
    "repetitions_removed": TaskStage.POSTPROCESS_RUNNING,
    "output_written": TaskStage.OUTPUT_WRITING,
    "desktop_output_written": TaskStage.OUTPUT_WRITING,
}


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
        engine_loader: EngineLoader = _default_engine_loader,
        performance_sampler: PerformanceSampler = collect_performance_sample,
    ) -> None:
        self._emit = emit
        self._check_environment = environment_checker
        self._logger = logger or logging.getLogger(__name__)
        self._task_id_factory = task_id_factory or (
            lambda: f"task-{uuid.uuid4().hex}"
        )
        self._performance_sampler = performance_sampler
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
        return {
            "status": "ok",
            "worker_state": state,
            "active_task_id": active_task_id,
            "queued_count": queued_count,
            "model_loaded": self._model_cache.loaded,
            "model_id": self._model_cache.model_id,
        }

    def handle_command(self, command: CommandMessage) -> bool:
        """Handle one validated command; return True when the loop should stop."""
        if command.method is CommandMethod.SYSTEM_HEALTH:
            self._complete_command(command, self._health_result())
            return False
        if command.method is CommandMethod.SYSTEM_ENVIRONMENT:
            errors = self._check_environment()
            self._complete_command(
                command,
                {
                    "available": not errors,
                    "errors": errors,
                    "python": platform.python_version(),
                    "platform": platform.platform(),
                },
            )
            return False
        if command.method is CommandMethod.SYSTEM_METRICS:
            self._complete_command(command, self._performance_sampler())
            return False

        with self._condition:
            if self._stopping:
                raise WorkerCommandError(
                    ErrorCode.WORKER_BUSY,
                    "worker is shutting down",
                )

        if command.method is CommandMethod.MODEL_LOAD:
            model_id = str(command.params.get("model_id") or DEFAULT_MODEL_NAME)
            loaded_new = self._model_cache.load(
                model_id, request_id=command.request_id
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

    def _start_task(self, command: CommandMessage) -> None:
        profile = command.params["profile"]
        try:
            preset = derive_preset(
                str(profile["base_preset_id"]),
                profile["overrides"],
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
            output_plans = build_configurable_output_plans(
                media_paths,
                command.params["output"],
                reserved_paths=reserved_paths,
            )
        except OutputConflictError as exc:
            raise WorkerCommandError(
                ErrorCode.OUTPUT_FAILED,
                str(exc),
                data={"exception": type(exc).__name__},
            ) from exc
        except (OSError, TypeError, ValueError) as exc:
            raise WorkerCommandError(
                ErrorCode.REQUEST_INVALID,
                str(exc),
                data={"exception": type(exc).__name__},
            ) from exc

        # The Windows process must perform the first faster-whisper/CTranslate2
        # lazy import and model initialization on the stdin command thread.
        # Loading a model for the first time from the dispatcher while this
        # thread blocks on the next stdin line can deadlock some runtimes.
        self._model_cache.load(DEFAULT_MODEL_NAME, request_id=command.request_id)
        task = WorkerTask(
            task_id=self._task_id_factory(),
            request_id=command.request_id,
            inputs=tuple(command.params["inputs"]),
            preset=preset,
            media_paths=media_paths,
            output_plans=output_plans,
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
                    "input_count": len(task.media_paths),
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
    ) -> None:
        data: dict[str, Any] = {
            "stage": stage.value,
            "current": current,
            "total": total,
        }
        if input_path is not None:
            data["input_path"] = str(input_path)
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
        task.state = "running"
        try:
            self._emit_progress(
                task,
                TaskStage.INPUT_VALIDATING,
                0,
                len(task.inputs),
                message="正在校验输入",
            )
            if task.cancel.is_set():
                raise TranscriptionCancelled()
            media_paths = task.media_paths
            self._emit_progress(
                task,
                TaskStage.INPUT_DISCOVERING,
                0,
                len(media_paths),
                message="输入展开完成",
            )
            plans = task.output_plans
            if task.cancel.is_set():
                raise TranscriptionCancelled()
            self._emit_progress(
                task,
                TaskStage.MODEL_LOADING,
                0,
                len(media_paths),
                message="正在准备模型",
            )
            with self._model_cache.acquire(
                DEFAULT_MODEL_NAME,
                request_id=task.request_id,
            ) as (engine, _hardware):
                service = TranscriptionService(
                    progress=self._progress_adapter(task),
                    cancelled=task.cancel.is_set,
                )
                success_count = 0
                failure_count = 0
                outputs: list[str] = []
                for current, (media_path, plan) in enumerate(
                    zip(media_paths, plans), start=1
                ):
                    if task.cancel.is_set():
                        raise TranscriptionCancelled()
                    request = TranscriptionRequest(media_path, task.preset.id)
                    try:
                        result = service.transcribe_file(
                            request,
                            engine,
                            current=current,
                            total=len(media_paths),
                            preset=task.preset,
                            output_plan=plan,
                        )
                    except TranscriptionCancelled:
                        raise
                    except Exception:
                        failure_count += 1
                        self._logger.exception("task %s failed for %s", task.task_id, media_path)
                        continue
                    success_count += 1
                    outputs.extend(str(path) for path in plan.content_paths)
                    if not result.success:
                        failure_count += 1
                        success_count -= 1
            if task.cancel.is_set():
                raise TranscriptionCancelled()
            self._emit_progress(
                task,
                TaskStage.TASK_FINALIZING,
                len(media_paths),
                len(media_paths),
                message="正在汇总任务结果",
            )
            task.state = "completed"
            self._emit(
                EventMessage(
                    EventCode.TASK_COMPLETED,
                    {
                        "success_count": success_count,
                        "failure_count": failure_count,
                        "outputs": list(dict.fromkeys(outputs)),
                    },
                    task_id=task.task_id,
                    message="任务完成",
                )
            )
        except TranscriptionCancelled:
            self._emit_cancelled(task, "shutdown" if self._stopping else "user")
        except WorkerCommandError as exc:
            self._emit_failed(task, exc.code, exc, details=exc.data)
        except OutputConflictError as exc:
            self._emit_failed(task, ErrorCode.OUTPUT_FAILED, exc)
        except (OSError, ValueError, TypeError) as exc:
            self._emit_failed(task, ErrorCode.OUTPUT_FAILED, exc)
        except Exception as exc:
            self._logger.exception("unhandled task failure for %s", task.task_id)
            self._emit_failed(task, ErrorCode.TRANSCRIPTION_FAILED, exc)

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
