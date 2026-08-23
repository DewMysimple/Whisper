"""Reusable model lifecycle and idle-release policy for the Worker."""

from __future__ import annotations

import gc
import logging
import threading
from collections.abc import Mapping
from contextlib import contextmanager
from typing import Any

from ..bootstrap import configure_runtime
from ..infrastructure.hardware import HardwareDetector, HardwareInfo
from ..protocol import ErrorCode, EventCode, EventMessage
from .runtime_types import (
    DEFAULT_MODEL_IDLE_TIMEOUT_SECONDS,
    EngineLoader,
    HardwareCapabilityLoader,
    HardwareProbe,
    MessageEmitter,
    RuntimeConfigurer,
    WorkerCommandError,
    _default_engine_loader,
)


class ModelCache:
    """Own one reusable model and release it after a configurable idle period."""

    def __init__(
        self,
        emit: MessageEmitter,
        *,
        runtime_configurer: RuntimeConfigurer = configure_runtime,
        hardware_detector: HardwareProbe | None = None,
        hardware_capability_loader: HardwareCapabilityLoader | None = None,
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

    @property
    def hardware(self) -> HardwareInfo | None:
        with self._lock:
            return self._hardware

    def _resolve_hardware(
        self, preference: Mapping[str, object] | None
    ) -> HardwareInfo:
        try:
            return self._detect_hardware(preference)
        except TypeError:
            # Keep injected version-one probes used by older hosts/tests compatible.
            return self._detect_hardware()  # type: ignore[call-arg]

    def _ensure_loaded_locked(
        self,
        model_id: str,
        *,
        hardware_preference: Mapping[str, object] | None = None,
        request_id: str | None = None,
    ) -> tuple[Any, HardwareInfo, bool]:
        try:
            resolved_hardware = self._resolve_hardware(hardware_preference)
        except Exception as exc:
            raise WorkerCommandError(
                ErrorCode.MODEL_LOAD_FAILED,
                str(exc) or type(exc).__name__,
                data={"model_id": model_id, "exception": type(exc).__name__},
            ) from exc
        if (
            self._engine is not None
            and self._model_id == model_id
            and self._hardware == resolved_hardware
        ):
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
            hardware = resolved_hardware
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
                    "device_index": hardware.device_index,
                    "cpu_threads": hardware.cpu_threads,
                },
                request_id=request_id,
                message="模型已就绪",
            )
        )
        return engine, hardware, True

    def load(
        self,
        model_id: str,
        *,
        hardware_preference: Mapping[str, object] | None = None,
        request_id: str | None = None,
    ) -> bool:
        with self._lock:
            _engine, _hardware, loaded_new = self._ensure_loaded_locked(
                model_id,
                hardware_preference=hardware_preference,
                request_id=request_id,
            )
            self._schedule_idle_release_locked()
            return loaded_new

    def validate(
        self,
        model_id: str,
        hardware_preference: Mapping[str, object] | None = None,
    ) -> HardwareInfo:
        """Verify a local model exists without importing CTranslate2."""
        try:
            resolved_hardware = self._resolve_hardware(hardware_preference)
            if self.loaded and self.model_id == model_id and self.hardware == resolved_hardware:
                return resolved_hardware
            location = self._configure_runtime()
            require_model = getattr(location, "require_model", None)
            if require_model is not None:
                require_model(model_id)
        except Exception as exc:
            raise WorkerCommandError(
                ErrorCode.MODEL_LOAD_FAILED,
                str(exc) or type(exc).__name__,
                data={"model_id": model_id, "exception": type(exc).__name__},
            ) from exc
        return resolved_hardware

    @contextmanager
    def acquire(
        self,
        model_id: str,
        *,
        hardware_preference: Mapping[str, object] | None = None,
        request_id: str | None = None,
    ):
        with self._lock:
            engine, hardware, _loaded_new = self._ensure_loaded_locked(
                model_id,
                hardware_preference=hardware_preference,
                request_id=request_id,
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
