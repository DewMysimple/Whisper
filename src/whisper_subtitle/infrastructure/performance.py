"""Read-only system performance sampling for the desktop Worker."""

from __future__ import annotations

import importlib
import time
from collections.abc import Callable
from typing import Any


ModuleLoader = Callable[[], Any]


def _load_psutil() -> Any:
    return importlib.import_module("psutil")


def _load_nvml() -> Any:
    return importlib.import_module("pynvml")


def collect_performance_sample(
    *,
    psutil_loader: ModuleLoader = _load_psutil,
    nvml_loader: ModuleLoader = _load_nvml,
) -> dict[str, int | float | str | None]:
    """Return one bounded metrics snapshot without changing runtime state."""
    psutil = psutil_loader()
    memory = psutil.virtual_memory()
    sample: dict[str, int | float | str | None] = {
        "timestamp_ms": int(time.time() * 1000),
        "cpu_percent": round(float(psutil.cpu_percent(interval=None)), 1),
        "memory_percent": round(float(memory.percent), 1),
        "memory_used_gib": round(float(memory.used) / 1024**3, 3),
        "memory_total_gib": round(float(memory.total) / 1024**3, 3),
        "gpu_percent": None,
        "vram_used_gib": None,
        "vram_total_gib": None,
        "gpu_name": None,
    }
    try:
        nvml = nvml_loader()
        nvml.nvmlInit()
        try:
            handle = nvml.nvmlDeviceGetHandleByIndex(0)
            utilization = nvml.nvmlDeviceGetUtilizationRates(handle)
            gpu_memory = nvml.nvmlDeviceGetMemoryInfo(handle)
            name = nvml.nvmlDeviceGetName(handle)
            if isinstance(name, bytes):
                name = name.decode("utf-8", errors="replace")
            sample.update(
                {
                    "gpu_percent": round(float(utilization.gpu), 1),
                    "vram_used_gib": round(float(gpu_memory.used) / 1024**3, 3),
                    "vram_total_gib": round(float(gpu_memory.total) / 1024**3, 3),
                    "gpu_name": str(name),
                }
            )
        finally:
            nvml.nvmlShutdown()
    except Exception:
        # GPU metadata is diagnostic only; a transient NVML failure must not
        # affect transcription or turn the Worker into an error state.
        pass
    return sample
