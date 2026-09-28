"""PyTorch capability discovery, isolated from the existing CTranslate2 path."""

from __future__ import annotations

import importlib
import os
import platform
from collections.abc import Mapping
from typing import Any

from ..domain.execution import normalize_execution_settings
from ..domain.execution import HardwareInfo
from .cuda_runtime import configure_cuda_runtime


def load_torch() -> Any:
    # Both backends share this process. Register/preload the CUDA wheel before
    # Torch loads its bundled DLLs, so a later Whisper task sees a matched pair.
    configure_cuda_runtime()
    try:
        return importlib.import_module("torch")
    except (ImportError, OSError) as exc:
        raise RuntimeError("Qwen 运行库不可用，请安装 whisper_subtitle[qwen] 或使用含 Qwen 的配套 Worker。") from exc


class TorchHardwareDetector:
    def __init__(self, loader=load_torch) -> None:
        self._loader = loader

    def capabilities(self) -> dict[str, Any]:
        torch = self._loader()
        devices = [{"device": "cpu", "device_index": 0,
                    "name": platform.processor() or "CPU", "compute_types": ["float32"]}]
        for index in range(torch.cuda.device_count()):
            with torch.cuda.device(index):
                types = ["float16", "float32"]
                if torch.cuda.is_bf16_supported():
                    types.append("bfloat16")
            devices.append({"device": "cuda", "device_index": index,
                            "name": torch.cuda.get_device_name(index), "compute_types": types})
        return {"cpu_threads": os.cpu_count() or 1, "devices": devices}

    def resolve(self, execution: Mapping[str, Any] | None = None) -> HardwareInfo:
        options = normalize_execution_settings(execution or {})
        capabilities = self.capabilities()
        device = options.get("device", "auto")
        if device == "auto":
            device = "cuda" if any(d["device"] == "cuda" for d in capabilities["devices"]) else "cpu"
        index = options.get("device_index", 0)
        selected = next((d for d in capabilities["devices"]
                         if d["device"] == device and d["device_index"] == index), None)
        if selected is None:
            raise ValueError(f"{device.upper()} device {index} is unavailable for Qwen")
        precision = options.get("compute_type", "auto")
        if precision == "auto":
            precision = next(p for p in ("bfloat16", "float16", "float32") if p in selected["compute_types"])
        if precision not in selected["compute_types"]:
            raise ValueError(f"Qwen {device.upper()} 不支持 {precision}，支持: {', '.join(selected['compute_types'])}")
        return HardwareInfo(
            device=device, compute_type=precision, cuda_available=device == "cuda",
            gpu_name=selected["name"] if device == "cuda" else None,
            cuda_version=self._loader().version.cuda if device == "cuda" else None,
            cpu_threads=options.get("cpu_threads", 0 if device == "cuda" else 4), device_index=index,
        )
