"""Typed data exchanged across WhisperSubtitle application boundaries."""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from pathlib import Path
from types import MappingProxyType
from typing import Any


def _freeze(value: Any) -> Any:
    if isinstance(value, Mapping):
        return MappingProxyType({key: _freeze(item) for key, item in value.items()})
    if isinstance(value, list):
        return tuple(_freeze(item) for item in value)
    if isinstance(value, tuple):
        return tuple(_freeze(item) for item in value)
    return value


def _thaw(value: Any) -> Any:
    if isinstance(value, Mapping):
        return {key: _thaw(item) for key, item in value.items()}
    if isinstance(value, tuple):
        return [_thaw(item) for item in value]
    return value


def _require_nonempty(value: str, field_name: str) -> None:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{field_name} must be a non-empty string")


@dataclass(frozen=True, slots=True)
class Preset:
    """A complete transcription mode definition from the single registry."""

    id: str
    cli_alias: str
    label: str
    description: str
    group: str
    params: Mapping[str, Any]
    postprocess_strategy: str

    def __post_init__(self) -> None:
        for field_name in (
            "id",
            "cli_alias",
            "label",
            "description",
            "group",
            "postprocess_strategy",
        ):
            _require_nonempty(getattr(self, field_name), field_name)
        if not isinstance(self.params, Mapping):
            raise TypeError("params must be a mapping")
        object.__setattr__(self, "params", _freeze(self.params))

    def transcription_options(self) -> dict[str, Any]:
        """Return an independent mutable copy for an inference engine call."""
        return _thaw(self.params)


@dataclass(frozen=True, slots=True)
class TranscriptionRequest:
    """Canonical input accepted by the future transcription application service."""

    input_path: Path
    preset_id: str
    output_dir: Path | None = None
    desktop: bool = False

    def __post_init__(self) -> None:
        _require_nonempty(self.preset_id, "preset_id")
        object.__setattr__(self, "input_path", Path(self.input_path))
        if self.output_dir is not None:
            object.__setattr__(self, "output_dir", Path(self.output_dir))
        if type(self.desktop) is not bool:
            raise TypeError("desktop must be bool")


@dataclass(frozen=True, slots=True)
class TranscriptionResult:
    """Structured outcome for one transcription request."""

    request: TranscriptionRequest
    success: bool
    output_path: Path | None = None
    error: str | None = None

    def __post_init__(self) -> None:
        if type(self.success) is not bool:
            raise TypeError("success must be bool")
        if self.output_path is not None:
            object.__setattr__(self, "output_path", Path(self.output_path))
        if self.success and self.error is not None:
            raise ValueError("successful result cannot contain an error")
        if not self.success and (not isinstance(self.error, str) or not self.error):
            raise ValueError("failed result must contain an error")

    @property
    def input_path(self) -> Path:
        return self.request.input_path

    @property
    def preset_id(self) -> str:
        return self.request.preset_id


@dataclass(frozen=True, slots=True)
class ProgressEvent:
    """Transport-neutral progress notification emitted by application services."""

    stage: str
    message: str
    current: int | None = None
    total: int | None = None
    preset_id: str | None = None
    input_path: Path | None = None

    def __post_init__(self) -> None:
        _require_nonempty(self.stage, "stage")
        _require_nonempty(self.message, "message")
        for field_name in ("current", "total"):
            value = getattr(self, field_name)
            if value is not None and (type(value) is not int or value < 0):
                raise ValueError(f"{field_name} must be a non-negative integer")
        if self.current is not None and self.total is not None and self.current > self.total:
            raise ValueError("current cannot exceed total")
        if self.input_path is not None:
            object.__setattr__(self, "input_path", Path(self.input_path))


@dataclass(frozen=True, slots=True)
class BatchResult:
    """Aggregate outcome for a batch while retaining each individual result."""

    results: tuple[TranscriptionResult, ...] = field(default_factory=tuple)

    def __post_init__(self) -> None:
        object.__setattr__(self, "results", tuple(self.results))
        if not all(isinstance(result, TranscriptionResult) for result in self.results):
            raise TypeError("results must contain only TranscriptionResult values")

    @classmethod
    def from_results(cls, results: Iterable[TranscriptionResult]) -> "BatchResult":
        return cls(tuple(results))

    @property
    def success_count(self) -> int:
        return sum(result.success for result in self.results)

    @property
    def failure_count(self) -> int:
        return len(self.results) - self.success_count

    @property
    def success(self) -> bool:
        return self.failure_count == 0

    @property
    def outcome(self) -> str:
        """Classify a batch without changing the historical 0/1 exit codes."""
        if self.failure_count == 0:
            return "success"
        if self.success_count:
            return "partial_failure"
        return "failure"

    @property
    def exit_code(self) -> int:
        return 0 if self.success else 1
