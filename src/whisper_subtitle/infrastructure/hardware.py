"""Hardware detection aligned with the CTranslate2 inference runtime."""

from __future__ import annotations

import importlib
from dataclasses import dataclass
from typing import Any, Callable

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


@dataclass(frozen=True, slots=True)
class HardwareInfo:
    """Structured inference settings selected from the current hardware."""

    device: str
    compute_type: str
    cuda_available: bool
    gpu_name: str | None
    cuda_version: str | None
    cpu_threads: int

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


class HardwareDetector:
    """Use CTranslate2 for CUDA capability and NVML only for metadata."""

    def __init__(
        self,
        ctranslate2_loader: ModuleLoader | None = None,
        nvml_loader: ModuleLoader | None = None,
    ) -> None:
        self._ctranslate2_loader = ctranslate2_loader or _load_ctranslate2
        self._nvml_loader = nvml_loader or _load_nvml

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
            )

        compute_types = set(ctranslate2.get_supported_compute_types("cuda"))
        compute_type = "float16" if "float16" in compute_types else "float32"
        gpu_name, cuda_version = self._nvml_metadata()
        return HardwareInfo(
            device="cuda",
            compute_type=compute_type,
            cuda_available=True,
            gpu_name=gpu_name or "CUDA device 0",
            cuda_version=cuda_version,
            cpu_threads=0,
        )

    def _nvml_metadata(self) -> tuple[str | None, str | None]:
        try:
            nvml = self._nvml_loader()
            nvml.nvmlInit()
            try:
                handle = nvml.nvmlDeviceGetHandleByIndex(0)
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
