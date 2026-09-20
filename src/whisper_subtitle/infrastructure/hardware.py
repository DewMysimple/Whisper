"""Hardware detection aligned with the CTranslate2 inference runtime."""

from __future__ import annotations

import importlib
import os
import platform
from collections.abc import Mapping
from dataclasses import dataclass, replace
from typing import Any, Callable

from ..domain.execution import EXECUTION_COMPUTE_TYPES, normalize_execution_settings
from .cuda_runtime import configure_cuda_runtime


ModuleLoader = Callable[[], Any]


def _load_ctranslate2() -> Any:
    return importlib.import_module("ctranslate2")


def _load_nvml() -> Any:
    return importlib.import_module("pynvml")


def _format_cuda_driver_version(value: int | None) -> str | None:
    if not value:
        return None
    major = int(value) // 1000
    minor = (int(value) % 1000) // 10
    return f"driver {major}.{minor}"


def _supported_compute_types(runtime: Any, device: str, index: int = 0) -> set[str]:
    try:
        return set(runtime.get_supported_compute_types(device, index))
    except TypeError:
        return set(runtime.get_supported_compute_types(device))


@dataclass(frozen=True, slots=True)
class HardwareInfo:
    """Structured inference settings selected from the current hardware."""

    device: str
    compute_type: str
    cuda_available: bool
    gpu_name: str | None
    cuda_version: str | None
    cpu_threads: int
    device_index: int = 0

    def __post_init__(self) -> None:
        if self.device not in {"cpu", "cuda"}:
            raise ValueError("device must be 'cpu' or 'cuda'")
        if not self.compute_type:
            raise ValueError("compute_type must be non-empty")
        if type(self.cuda_available) is not bool:
            raise TypeError("cuda_available must be bool")
        if self.device == "cuda" and not self.cuda_available:
            raise ValueError("cuda device requires cuda_available=True")
        if self.device == "cpu" and self.cuda_available:
            raise ValueError("cpu device requires cuda_available=False")
        if self.gpu_name is not None and not self.gpu_name:
            raise ValueError("gpu_name must be non-empty when provided")
        if type(self.cpu_threads) is not int or self.cpu_threads < 0:
            raise ValueError("cpu_threads must be a non-negative integer")
        if type(self.device_index) is not int or self.device_index < 0:
            raise ValueError("device_index must be a non-negative integer")


class HardwareDetector:
    """Use CTranslate2 for CUDA capability and NVML only for metadata."""

    def __init__(
        self,
        ctranslate2_loader: ModuleLoader | None = None,
        nvml_loader: ModuleLoader | None = None,
    ) -> None:
        self._ctranslate2_loader = ctranslate2_loader or _load_ctranslate2
        self._nvml_loader = nvml_loader or _load_nvml

    def capabilities(self) -> dict[str, Any]:
        """Report actual supported precisions without loading a Whisper model."""
        configure_cuda_runtime()
        runtime = self._ctranslate2_loader()
        devices: list[dict[str, Any]] = []
        for device, index in [("cpu", 0), *(
            ("cuda", index) for index in range(int(runtime.get_cuda_device_count()))
        )]:
            supported = _supported_compute_types(runtime, device, index)
            name = (
                (self._nvml_metadata(index)[0] or f"CUDA device {index}")
                if device == "cuda" else (platform.processor() or "CPU")
            )
            devices.append({
                "device": device,
                "device_index": index,
                "name": name,
                "compute_types": [
                    value for value in EXECUTION_COMPUTE_TYPES
                    if value != "auto" and value in supported
                ],
            })
        return {"cpu_threads": os.cpu_count() or 1, "devices": devices}

    def resolve(self, execution: Mapping[str, Any]) -> HardwareInfo:
        """Resolve explicit settings once; unsupported selections never fall back."""
        options = normalize_execution_settings(execution)
        device = options.get("device", "auto")
        compute_type = options.get("compute_type", "auto")
        index = options.get("device_index", 0)
        if device == "auto" and compute_type == "auto" and index == 0:
            # Keep the existing automatic path, including historical CPU=4 and
            # CUDA=0 thread settings. Explicit zero is an independent override.
            detected = self.detect()
            return replace(detected, cpu_threads=options.get("cpu_threads", detected.cpu_threads))

        configure_cuda_runtime()
        runtime = self._ctranslate2_loader()
        count = int(runtime.get_cuda_device_count()) if device != "cpu" else 0
        if device == "auto":
            device = "cuda" if count > 0 else "cpu"
        if device == "cuda" and index >= count:
            raise ValueError(f"CUDA device {index} is unavailable; detected {count} CUDA device(s)")
        if device == "cpu" and index != 0:
            raise ValueError("CPU execution requires device_index 0")
        supported = _supported_compute_types(runtime, device, index)
        if compute_type == "auto":
            candidates = ("float16", "float32") if device == "cuda" else ("int8",)
            compute_type = next((value for value in candidates if value in supported), "")
            if not compute_type:
                raise ValueError(f"{device.upper()} device {index} has no supported automatic precision")
        elif compute_type not in supported:
            available = ", ".join(sorted(supported)) or "none"
            raise ValueError(
                f"{device.upper()} device {index} does not support compute_type {compute_type}; "
                f"supported: {available}"
            )
        gpu_name, cuda_version = self._nvml_metadata(index) if device == "cuda" else (None, None)
        return HardwareInfo(
            device=device,
            compute_type=compute_type,
            cuda_available=device == "cuda",
            gpu_name=(gpu_name or f"CUDA device {index}") if device == "cuda" else None,
            cuda_version=cuda_version,
            cpu_threads=options.get("cpu_threads", 0 if device == "cuda" else 4),
            device_index=index,
        )

    def detect(self) -> HardwareInfo:
        configure_cuda_runtime()
        ctranslate2 = self._ctranslate2_loader()
        device_count = int(ctranslate2.get_cuda_device_count())
        if device_count <= 0:
            return HardwareInfo(
                device="cpu",
                compute_type="int8",
                cuda_available=False,
                gpu_name=None,
                cuda_version=None,
                cpu_threads=4,
                device_index=0,
            )

        compute_types = _supported_compute_types(ctranslate2, "cuda", 0)
        if "float16" in compute_types:
            compute_type = "float16"
        elif "float32" in compute_types:
            compute_type = "float32"
        else:
            raise RuntimeError(
                "CUDA device 0 supports neither float16 nor float32 inference"
            )
        gpu_name, cuda_version = self._nvml_metadata(0)
        return HardwareInfo(
            device="cuda",
            compute_type=compute_type,
            cuda_available=True,
            gpu_name=gpu_name or "CUDA device 0",
            cuda_version=cuda_version,
            cpu_threads=0,
            device_index=0,
        )

    def _nvml_metadata(self, device_index: int = 0) -> tuple[str | None, str | None]:
        try:
            nvml = self._nvml_loader()
            nvml.nvmlInit()
            try:
                handle = nvml.nvmlDeviceGetHandleByIndex(device_index)
                name = nvml.nvmlDeviceGetName(handle)
                if isinstance(name, bytes):
                    name = name.decode("utf-8", errors="replace")
                driver_version = _format_cuda_driver_version(
                    nvml.nvmlSystemGetCudaDriverVersion_v2()
                )
                return str(name), driver_version
            finally:
                nvml.nvmlShutdown()
        except Exception:
            # CTranslate2 is the capability authority. Metadata must never turn
            # a working CUDA runtime into a false CPU fallback.
            return None, None
