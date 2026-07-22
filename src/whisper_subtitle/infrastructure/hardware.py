"""Hardware detection aligned with the CTranslate2 inference runtime."""

from __future__ import annotations

import importlib
import os
from dataclasses import dataclass
from typing import Any, Callable, Mapping

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

    def capabilities(self) -> dict[str, object]:
        """Report only runtime capabilities verified by CTranslate2 and NVML."""
        configure_cuda_runtime()
        ctranslate2 = self._ctranslate2_loader()
        device_count = int(ctranslate2.get_cuda_device_count())
        cpu_types = sorted(_supported_compute_types(ctranslate2, "cpu"))
        gpu_names = self._nvml_device_names(device_count)
        gpus = [
            {
                "index": index,
                "name": gpu_names.get(index, f"CUDA device {index}"),
                "compute_types": sorted(
                    _supported_compute_types(ctranslate2, "cuda", index)
                ),
            }
            for index in range(device_count)
        ]
        logical = max(1, os.cpu_count() or 1)
        try:
            psutil = importlib.import_module("psutil")
            physical = int(psutil.cpu_count(logical=False) or logical)
            cpu_name = self._cpu_name(psutil)
        except Exception:
            physical = logical
            cpu_name = None
        return {
            "cpu_name": cpu_name,
            "cpu_physical_cores": max(1, physical),
            "cpu_logical_cores": logical,
            "cpu_compute_types": cpu_types,
            "gpus": gpus,
        }

    def detect(self, preference: Mapping[str, object] | None = None) -> HardwareInfo:
        configure_cuda_runtime()
        ctranslate2 = self._ctranslate2_loader()
        device_count = int(ctranslate2.get_cuda_device_count())
        selected = dict(preference or {})
        mode = str(selected.get("mode") or "auto")
        use_cuda = mode != "cpu" and device_count > 0
        if mode == "cuda" and device_count <= 0:
            raise RuntimeError("CUDA was selected but no CUDA device is available")
        if not use_cuda:
            compute_type = str(selected.get("cpu_compute_type") or "int8")
            supported = _supported_compute_types(ctranslate2, "cpu")
            if preference is not None and compute_type not in supported:
                if mode == "auto" and "float32" in supported:
                    compute_type = "float32"
                else:
                    raise RuntimeError(
                        f"CPU compute type is not supported: {compute_type}"
                    )
            cpu_threads = int(selected.get("cpu_threads") or 4)
            physical_cores = self._physical_core_count()
            if cpu_threads < 1 or cpu_threads > physical_cores:
                raise RuntimeError(
                    f"CPU thread count must be between 1 and {physical_cores}"
                )
            return HardwareInfo(
                device="cpu",
                compute_type=compute_type,
                cuda_available=False,
                gpu_name=None,
                cuda_version=None,
                cpu_threads=cpu_threads,
                device_index=0,
            )

        device_index = int(selected.get("gpu_device_index") or 0)
        if device_index < 0 or device_index >= device_count:
            raise RuntimeError(f"CUDA device index is unavailable: {device_index}")
        compute_types = _supported_compute_types(ctranslate2, "cuda", device_index)
        requested_type = str(selected.get("cuda_compute_type") or "float16")
        compute_type = requested_type
        if compute_type not in compute_types:
            if mode == "auto" and "float32" in compute_types:
                compute_type = "float32"
            else:
                raise RuntimeError(
                    f"CUDA compute type is not supported on device {device_index}: {compute_type}"
                )
        gpu_name, cuda_version = self._nvml_metadata(device_index)
        return HardwareInfo(
            device="cuda",
            compute_type=compute_type,
            cuda_available=True,
            gpu_name=gpu_name or f"CUDA device {device_index}",
            cuda_version=cuda_version,
            cpu_threads=0,
            device_index=device_index,
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

    def _nvml_device_names(self, device_count: int) -> dict[int, str]:
        if device_count <= 0:
            return {}
        names: dict[int, str] = {}
        try:
            nvml = self._nvml_loader()
            nvml.nvmlInit()
            try:
                for index in range(device_count):
                    handle = nvml.nvmlDeviceGetHandleByIndex(index)
                    name = nvml.nvmlDeviceGetName(handle)
                    if isinstance(name, bytes):
                        name = name.decode("utf-8", errors="replace")
                    names[index] = str(name)
            finally:
                nvml.nvmlShutdown()
        except Exception:
            return names
        return names

    @staticmethod
    def _cpu_name(psutil: Any) -> str | None:
        try:
            if os.name == "nt":
                import winreg

                with winreg.OpenKey(
                    winreg.HKEY_LOCAL_MACHINE,
                    r"HARDWARE\DESCRIPTION\System\CentralProcessor\0",
                ) as key:
                    return str(winreg.QueryValueEx(key, "ProcessorNameString")[0]).strip()
        except Exception:
            pass
        return None

    @staticmethod
    def _physical_core_count() -> int:
        logical = max(1, os.cpu_count() or 1)
        try:
            psutil = importlib.import_module("psutil")
            return max(1, int(psutil.cpu_count(logical=False) or logical))
        except Exception:
            return logical
