"""Read-only system performance sampling for the desktop Worker."""

from __future__ import annotations

import importlib
import os
import platform
import time
from collections.abc import Callable
from functools import lru_cache
from typing import Any


ModuleLoader = Callable[[], Any]
CpuNameLoader = Callable[[], str | None]


def _load_psutil() -> Any:
    return importlib.import_module("psutil")


def _load_nvml() -> Any:
    return importlib.import_module("pynvml")


@lru_cache(maxsize=1)
def _read_cpu_name() -> str | None:
    if os.name == "nt":
        try:
            import winreg

            with winreg.OpenKey(
                winreg.HKEY_LOCAL_MACHINE,
                r"HARDWARE\DESCRIPTION\System\CentralProcessor\0",
            ) as key:
                value, _ = winreg.QueryValueEx(key, "ProcessorNameString")
                if str(value).strip():
                    return str(value).strip()
        except OSError:
            pass
    value = platform.processor().strip()
    return value or None


def _optional(call: Callable[[], Any]) -> Any:
    try:
        return call()
    except Exception:
        return None


def _gib(value: Any) -> float | None:
    if value is None:
        return None
    return round(float(value) / 1024**3, 3)


def _decode_text(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, bytes):
        value = value.decode("utf-8", errors="replace")
    text = str(value).strip()
    return text or None


def collect_performance_sample(
    *,
    psutil_loader: ModuleLoader = _load_psutil,
    nvml_loader: ModuleLoader = _load_nvml,
    cpu_name_loader: CpuNameLoader = _read_cpu_name,
    clock: Callable[[], float] = time.time,
) -> dict[str, int | float | str | None]:
    """Return one bounded metrics snapshot without changing runtime state."""
    psutil = psutil_loader()
    memory = psutil.virtual_memory()
    cpu_frequency = _optional(psutil.cpu_freq)
    swap = _optional(psutil.swap_memory)
    worker = _optional(psutil.Process)
    worker_memory = _optional(worker.memory_info) if worker is not None else None
    boot_time = _optional(psutil.boot_time)
    now = clock()
    sample: dict[str, int | float | str | None] = {
        "timestamp_ms": int(now * 1000),
        "cpu_percent": round(float(psutil.cpu_percent(interval=None)), 1),
        "cpu_name": _optional(cpu_name_loader),
        "cpu_frequency_mhz": (
            round(float(cpu_frequency.current), 1)
            if cpu_frequency is not None and cpu_frequency.current is not None
            else None
        ),
        "cpu_physical_cores": _optional(lambda: psutil.cpu_count(logical=False)),
        "cpu_logical_cores": _optional(lambda: psutil.cpu_count(logical=True)),
        "system_process_count": _optional(lambda: len(psutil.pids())),
        "system_uptime_seconds": (
            max(0, int(now - float(boot_time))) if boot_time is not None else None
        ),
        "memory_percent": round(float(memory.percent), 1),
        "memory_used_gib": _gib(memory.used),
        "memory_total_gib": _gib(memory.total),
        "memory_available_gib": _gib(
            getattr(memory, "available", memory.total - memory.used)
        ),
        "swap_used_gib": _gib(getattr(swap, "used", None)),
        "swap_total_gib": _gib(getattr(swap, "total", None)),
        "worker_rss_gib": _gib(getattr(worker_memory, "rss", None)),
        "worker_thread_count": (
            _optional(worker.num_threads) if worker is not None else None
        ),
        "worker_handle_count": (
            _optional(worker.num_handles)
            if worker is not None and hasattr(worker, "num_handles")
            else None
        ),
        "gpu_percent": None,
        "gpu_memory_controller_percent": None,
        "vram_used_gib": None,
        "vram_total_gib": None,
        "gpu_name": None,
        "gpu_temperature_c": None,
        "gpu_clock_mhz": None,
        "gpu_memory_clock_mhz": None,
        "gpu_power_watts": None,
        "gpu_power_limit_watts": None,
        "gpu_fan_percent": None,
        "gpu_driver_version": None,
        "gpu_performance_state": None,
    }
    try:
        nvml = nvml_loader()
        nvml.nvmlInit()
        try:
            handle = nvml.nvmlDeviceGetHandleByIndex(0)
            utilization = nvml.nvmlDeviceGetUtilizationRates(handle)
            gpu_memory = nvml.nvmlDeviceGetMemoryInfo(handle)
            name = _decode_text(nvml.nvmlDeviceGetName(handle))
            temperature = _optional(
                lambda: nvml.nvmlDeviceGetTemperature(
                    handle, nvml.NVML_TEMPERATURE_GPU
                )
            )
            graphics_clock = _optional(
                lambda: nvml.nvmlDeviceGetClockInfo(handle, nvml.NVML_CLOCK_GRAPHICS)
            )
            memory_clock = _optional(
                lambda: nvml.nvmlDeviceGetClockInfo(handle, nvml.NVML_CLOCK_MEM)
            )
            power_usage = _optional(lambda: nvml.nvmlDeviceGetPowerUsage(handle))
            power_limit = _optional(
                lambda: nvml.nvmlDeviceGetEnforcedPowerLimit(handle)
            )
            fan_speed = _optional(lambda: nvml.nvmlDeviceGetFanSpeed(handle))
            driver = _decode_text(_optional(nvml.nvmlSystemGetDriverVersion))
            performance_state = _optional(
                lambda: nvml.nvmlDeviceGetPerformanceState(handle)
            )
            sample.update(
                {
                    "gpu_percent": round(float(utilization.gpu), 1),
                    "gpu_memory_controller_percent": round(
                        float(utilization.memory), 1
                    ),
                    "vram_used_gib": _gib(gpu_memory.used),
                    "vram_total_gib": _gib(gpu_memory.total),
                    "gpu_name": name,
                    "gpu_temperature_c": (
                        round(float(temperature), 1) if temperature is not None else None
                    ),
                    "gpu_clock_mhz": (
                        round(float(graphics_clock), 1)
                        if graphics_clock is not None
                        else None
                    ),
                    "gpu_memory_clock_mhz": (
                        round(float(memory_clock), 1)
                        if memory_clock is not None
                        else None
                    ),
                    "gpu_power_watts": (
                        round(float(power_usage) / 1000, 1)
                        if power_usage is not None
                        else None
                    ),
                    "gpu_power_limit_watts": (
                        round(float(power_limit) / 1000, 1)
                        if power_limit is not None
                        else None
                    ),
                    "gpu_fan_percent": (
                        round(float(fan_speed), 1) if fan_speed is not None else None
                    ),
                    "gpu_driver_version": driver,
                    "gpu_performance_state": (
                        f"P{int(performance_state)}"
                        if performance_state is not None
                        else None
                    ),
                }
            )
        finally:
            nvml.nvmlShutdown()
    except Exception:
        # GPU metadata is diagnostic only; a transient NVML failure must not
        # affect transcription or turn the Worker into an error state.
        pass
    return sample
