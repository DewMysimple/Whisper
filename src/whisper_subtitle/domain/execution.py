"""Backend-neutral hardware contract and per-task execution validation."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any


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


EXECUTION_DEVICES = ("auto", "cuda", "cpu")
EXECUTION_COMPUTE_TYPES = (
    "auto", "float16", "float32", "int8", "int8_float16", "int8_float32",
    "bfloat16", "int8_bfloat16",
)
EXECUTION_INTEGER_LIMITS = {"device_index": (0, 31), "cpu_threads": (0, 256)}


def normalize_execution_settings(value: Any) -> dict[str, Any]:
    """Preserve omissions: absent CPU threads and explicit zero are distinct."""
    if not isinstance(value, Mapping):
        raise ValueError("params.execution must be an object")
    rules = {"device": EXECUTION_DEVICES, "compute_type": EXECUTION_COMPUTE_TYPES}
    unknown = set(value) - rules.keys() - EXECUTION_INTEGER_LIMITS.keys()
    if unknown:
        raise ValueError(f"params.execution contains unsupported fields: {', '.join(sorted(unknown))}")
    for name, allowed in rules.items():
        if name in value and value[name] not in allowed:
            raise ValueError(f"params.execution.{name} is unsupported")
    for name, (minimum, maximum) in EXECUTION_INTEGER_LIMITS.items():
        if name in value and (
            type(value[name]) is not int or not minimum <= value[name] <= maximum
        ):
            raise ValueError(f"params.execution.{name} must be an integer from {minimum} to {maximum}")
    return dict(value)
