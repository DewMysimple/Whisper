"""Validation for per-task inference execution settings."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any


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
