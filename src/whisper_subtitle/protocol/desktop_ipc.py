"""Transport-neutral Desktop IPC v1 message definitions and validation."""

from __future__ import annotations

import json
import math
import re
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from enum import Enum
from types import MappingProxyType
from typing import Any, TypeAlias

from ..domain.models import SUPPORTED_MODEL_IDS


PROTOCOL_SCHEMA_VERSION = 1


class MessageType(str, Enum):
    COMMAND = "command"
    EVENT = "event"
    ERROR = "error"


class CommandMethod(str, Enum):
    SYSTEM_HEALTH = "system.health"
    SYSTEM_ENVIRONMENT = "system.environment"
    SYSTEM_METRICS = "system.metrics"
    MEDIA_INSPECT = "media.inspect"
    MODEL_LOAD = "model.load"
    MODEL_UNLOAD = "model.unload"
    TRANSCRIPTION_START = "transcription.start"
    TRANSCRIPTION_CANCEL = "transcription.cancel"
    WORKER_SHUTDOWN = "worker.shutdown"


class EventCode(str, Enum):
    WORKER_READY = "worker.ready"
    COMMAND_COMPLETED = "command.completed"
    MODEL_LOADING = "model.loading"
    MODEL_READY = "model.ready"
    TASK_QUEUED = "task.queued"
    TASK_PROGRESS = "task.progress"
    TASK_COMPLETED = "task.completed"
    TASK_FAILED = "task.failed"
    TASK_CANCELLED = "task.cancelled"


class TaskStage(str, Enum):
    INPUT_VALIDATING = "input.validating"
    INPUT_DISCOVERING = "input.discovering"
    MODEL_LOADING = "model.loading"
    TRANSCRIPTION_RUNNING = "transcription.running"
    POSTPROCESS_RUNNING = "postprocess.running"
    OUTPUT_WRITING = "output.writing"
    TASK_FINALIZING = "task.finalizing"


class ErrorCode(str, Enum):
    PROTOCOL_INVALID_JSON = "protocol.invalid_json"
    PROTOCOL_INVALID_MESSAGE = "protocol.invalid_message"
    PROTOCOL_UNSUPPORTED_VERSION = "protocol.unsupported_version"
    PROTOCOL_UNKNOWN_METHOD = "protocol.unknown_method"
    REQUEST_INVALID = "request.invalid"
    TASK_NOT_FOUND = "task.not_found"
    TASK_CONFLICT = "task.conflict"
    WORKER_BUSY = "worker.busy"
    WORKER_INTERNAL = "worker.internal"
    ENVIRONMENT_UNAVAILABLE = "environment.unavailable"
    MODEL_LOAD_FAILED = "model.load_failed"
    TRANSCRIPTION_FAILED = "transcription.failed"
    OUTPUT_FAILED = "output.failed"


JsonValue: TypeAlias = (
    bool | int | float | str | list["JsonValue"] | dict[str, "JsonValue"] | None
)
FrozenJson: TypeAlias = (
    bool
    | int
    | float
    | str
    | tuple["FrozenJson", ...]
    | Mapping[str, "FrozenJson"]
    | None
)


_IDENTIFIER_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
_PRESET_IDS = frozenset({"cn", "cn2", "en_v1", "en_v2"})
_RECOGNITION_STRATEGIES = frozenset(
    {"stable_primary", "mixed_zh_en", "zh_detail_review"}
)
_MODEL_IDS = frozenset(SUPPORTED_MODEL_IDS)
_INPUT_KINDS = frozenset({"file", "directory"})
_INPUT_ORIGINS = frozenset({"dialog", "drop", "paste", "manual"})
_OUTPUT_MODES = frozenset({"compatibility", "custom"})
_CONFLICT_POLICIES = frozenset({"overwrite", "fail", "auto_rename", "skip"})
_CANCEL_REASONS = frozenset({"user", "shutdown", "superseded"})
_HARDWARE_MODES = frozenset({"auto", "cuda", "cpu"})
_CUDA_COMPUTE_TYPES = frozenset({"float16", "int8_float16", "float32"})
_CPU_COMPUTE_TYPES = frozenset({"int8", "float32"})

_PARAMETER_RULES: Mapping[str, tuple[type, float, float]] = MappingProxyType(
    {
        "beam_size": (int, 1, 20),
        "best_of": (int, 1, 20),
        "patience": (float, 0, 5),
        "length_penalty": (float, 0, 2),
        "temperature": (float, 0, 1),
        "repetition_penalty": (float, 1, 2),
        "no_repeat_ngram_size": (int, 0, 10),
        "compression_ratio_threshold": (float, 0, 10),
        "log_prob_threshold": (float, -10, 0),
        "no_speech_threshold": (float, 0, 1),
        "condition_on_previous_text": (bool, 0, 1),
        "prompt_reset_on_temperature": (float, 0, 1),
        "min_silence_duration_ms": (int, 0, 10000),
    }
)
_SPECIAL_PARAMETER_NAMES = frozenset({"task", "initial_prompt", "hotwords"})

_SUBTITLE_PARAMETER_RULES: Mapping[str, tuple[type, float, float]] = MappingProxyType(
    {
        "max_characters_per_line": (int, 8, 84),
        "max_lines_per_cue": (int, 1, 3),
        "min_cue_duration_ms": (int, 250, 5000),
        "max_cue_duration_ms": (int, 1000, 15000),
        "max_characters_per_second": (float, 5, 40),
        "cue_gap_ms": (int, 0, 1000),
    }
)


def _freeze_json(value: Any, field_name: str = "value") -> FrozenJson:
    if value is None or type(value) in {bool, int, str}:
        return value
    if type(value) is float:
        if not math.isfinite(value):
            raise ProtocolValidationError(
                ErrorCode.PROTOCOL_INVALID_MESSAGE,
                f"{field_name} must contain only finite JSON numbers",
            )
        return value
    if isinstance(value, Mapping):
        frozen = {}
        for key, item in value.items():
            if not isinstance(key, str):
                raise ProtocolValidationError(
                    ErrorCode.PROTOCOL_INVALID_MESSAGE,
                    f"{field_name} object keys must be strings",
                )
            frozen[key] = _freeze_json(item, f"{field_name}.{key}")
        return MappingProxyType(frozen)
    if isinstance(value, Sequence) and not isinstance(
        value, (str, bytes, bytearray)
    ):
        return tuple(
            _freeze_json(item, f"{field_name}[{index}]")
            for index, item in enumerate(value)
        )
    raise ProtocolValidationError(
        ErrorCode.PROTOCOL_INVALID_MESSAGE,
        f"{field_name} is not JSON serializable",
    )


def _thaw_json(value: FrozenJson) -> JsonValue:
    if isinstance(value, Mapping):
        return {key: _thaw_json(item) for key, item in value.items()}
    if isinstance(value, tuple):
        return [_thaw_json(item) for item in value]
    return value


class ProtocolValidationError(ValueError):
    """A validation failure that can be converted into a stable error message."""

    def __init__(
        self,
        code: ErrorCode,
        message: str,
        *,
        data: Mapping[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.data = _freeze_json(data or {}, "error.data")




from .desktop_ipc_validation import (
    _optional_identifier,
    _optional_message,
    _require_bool,
    _require_conflict_groups,
    _require_fields,
    _require_identifier,
    _require_nonempty_string,
    _require_nonnegative_int,
    _require_object,
    _require_path_array,
    _require_version,
    _validate_command_params,
    _validate_detail_candidates,
    _validate_event_data,
    _validate_hardware_preference,
    _validate_hotword_audit,
    _validate_language_regions,
    _validate_output_target,
    _validate_parameter_overrides,
    _validate_quality_diagnostics,
    _validate_subtitle_parameters,
    _validate_transcription_start_params,
)


@dataclass(frozen=True, slots=True)
class CommandMessage:
    request_id: str
    method: CommandMethod | str
    params: Mapping[str, Any] = field(default_factory=dict)
    schema_version: int = PROTOCOL_SCHEMA_VERSION

    def __post_init__(self) -> None:
        object.__setattr__(self, "schema_version", _require_version(self.schema_version))
        object.__setattr__(self, "request_id", _require_identifier(self.request_id, "request_id"))
        try:
            method = CommandMethod(self.method)
        except (TypeError, ValueError) as exc:
            raise ProtocolValidationError(
                ErrorCode.PROTOCOL_UNKNOWN_METHOD,
                f"unknown command method: {self.method!r}",
            ) from exc
        object.__setattr__(self, "method", method)
        object.__setattr__(self, "params", _validate_command_params(method, self.params))

    def to_payload(self) -> dict[str, JsonValue]:
        return {
            "schema_version": self.schema_version,
            "type": MessageType.COMMAND.value,
            "request_id": self.request_id,
            "method": self.method.value,
            "params": _thaw_json(self.params),
        }


@dataclass(frozen=True, slots=True)
class EventMessage:
    event: EventCode | str
    data: Mapping[str, Any]
    request_id: str | None = None
    task_id: str | None = None
    message: str | None = None
    schema_version: int = PROTOCOL_SCHEMA_VERSION

    def __post_init__(self) -> None:
        object.__setattr__(self, "schema_version", _require_version(self.schema_version))
        try:
            event = EventCode(self.event)
        except (TypeError, ValueError) as exc:
            raise ProtocolValidationError(
                ErrorCode.PROTOCOL_INVALID_MESSAGE,
                f"unknown event code: {self.event!r}",
            ) from exc
        object.__setattr__(self, "event", event)
        request_id = _optional_identifier(self.request_id, "request_id")
        task_id = _optional_identifier(self.task_id, "task_id")
        if event.value.startswith("task.") and task_id is None:
            raise ProtocolValidationError(
                ErrorCode.PROTOCOL_INVALID_MESSAGE,
                f"{event.value} requires task_id",
            )
        if event is EventCode.TASK_QUEUED and request_id is None:
            raise ProtocolValidationError(
                ErrorCode.PROTOCOL_INVALID_MESSAGE,
                "task.queued requires request_id",
            )
        if event is EventCode.COMMAND_COMPLETED and request_id is None:
            raise ProtocolValidationError(
                ErrorCode.PROTOCOL_INVALID_MESSAGE,
                "command.completed requires request_id",
            )
        object.__setattr__(self, "request_id", request_id)
        object.__setattr__(self, "task_id", task_id)
        object.__setattr__(self, "message", _optional_message(self.message))
        object.__setattr__(self, "data", _validate_event_data(event, self.data))

    def to_payload(self) -> dict[str, JsonValue]:
        payload: dict[str, JsonValue] = {
            "schema_version": self.schema_version,
            "type": MessageType.EVENT.value,
            "event": self.event.value,
            "data": _thaw_json(self.data),
        }
        if self.request_id is not None:
            payload["request_id"] = self.request_id
        if self.task_id is not None:
            payload["task_id"] = self.task_id
        if self.message is not None:
            payload["message"] = self.message
        return payload


@dataclass(frozen=True, slots=True)
class ErrorMessage:
    code: ErrorCode | str
    data: Mapping[str, Any] = field(default_factory=dict)
    request_id: str | None = None
    task_id: str | None = None
    message: str | None = None
    schema_version: int = PROTOCOL_SCHEMA_VERSION

    def __post_init__(self) -> None:
        object.__setattr__(self, "schema_version", _require_version(self.schema_version))
        try:
            code = ErrorCode(self.code)
        except (TypeError, ValueError) as exc:
            raise ProtocolValidationError(
                ErrorCode.PROTOCOL_INVALID_MESSAGE,
                f"unknown error code: {self.code!r}",
            ) from exc
        object.__setattr__(self, "code", code)
        object.__setattr__(
            self, "request_id", _optional_identifier(self.request_id, "request_id")
        )
        object.__setattr__(
            self, "task_id", _optional_identifier(self.task_id, "task_id")
        )
        object.__setattr__(self, "message", _optional_message(self.message))
        object.__setattr__(self, "data", _freeze_json(_require_object(self.data, "data"), "data"))

    def to_payload(self) -> dict[str, JsonValue]:
        payload: dict[str, JsonValue] = {
            "schema_version": self.schema_version,
            "type": MessageType.ERROR.value,
            "code": self.code.value,
            "data": _thaw_json(self.data),
        }
        if self.request_id is not None:
            payload["request_id"] = self.request_id
        if self.task_id is not None:
            payload["task_id"] = self.task_id
        if self.message is not None:
            payload["message"] = self.message
        return payload


ProtocolMessage: TypeAlias = CommandMessage | EventMessage | ErrorMessage


def parse_protocol_line(line: str) -> ProtocolMessage:
    """Parse one protocol JSON line and reject unknown or ambiguous fields."""
    try:
        payload = json.loads(line)
    except (TypeError, json.JSONDecodeError) as exc:
        raise ProtocolValidationError(
            ErrorCode.PROTOCOL_INVALID_JSON, "protocol line is not valid JSON"
        ) from exc
    payload = _require_object(payload, "message")
    message_type = payload.get("type")
    if message_type == MessageType.COMMAND.value:
        _require_fields(
            payload,
            required={"schema_version", "type", "request_id", "method", "params"},
            field_name="message",
        )
        return CommandMessage(
            schema_version=payload["schema_version"],
            request_id=payload["request_id"],
            method=payload["method"],
            params=payload["params"],
        )
    if message_type == MessageType.EVENT.value:
        _require_fields(
            payload,
            required={"schema_version", "type", "event", "data"},
            optional={"request_id", "task_id", "message"},
            field_name="message",
        )
        return EventMessage(
            schema_version=payload["schema_version"],
            event=payload["event"],
            data=payload["data"],
            request_id=payload.get("request_id"),
            task_id=payload.get("task_id"),
            message=payload.get("message"),
        )
    if message_type == MessageType.ERROR.value:
        _require_fields(
            payload,
            required={"schema_version", "type", "code", "data"},
            optional={"request_id", "task_id", "message"},
            field_name="message",
        )
        return ErrorMessage(
            schema_version=payload["schema_version"],
            code=payload["code"],
            data=payload["data"],
            request_id=payload.get("request_id"),
            task_id=payload.get("task_id"),
            message=payload.get("message"),
        )
    raise ProtocolValidationError(
        ErrorCode.PROTOCOL_INVALID_MESSAGE,
        f"unknown message type: {message_type!r}",
    )


def encode_protocol_message(message: ProtocolMessage) -> str:
    """Encode one compact UTF-8-safe protocol line without a trailing newline."""
    return json.dumps(
        message.to_payload(),
        ensure_ascii=False,
        allow_nan=False,
        separators=(",", ":"),
    )


def protocol_error_from_exception(
    error: ProtocolValidationError,
    *,
    request_id: str | None = None,
    task_id: str | None = None,
) -> ErrorMessage:
    """Turn a local validation failure into a stable machine error envelope."""
    return ErrorMessage(
        code=error.code,
        data=_thaw_json(error.data),
        request_id=request_id,
        task_id=task_id,
        message=str(error),
    )


def validate_task_event_sequence(events: Iterable[EventMessage]) -> None:
    """Validate the lifecycle order for one task's queued/progress/terminal events."""
    sequence = tuple(events)
    if not sequence:
        raise ProtocolValidationError(
            ErrorCode.PROTOCOL_INVALID_MESSAGE, "task event sequence cannot be empty"
        )
    task_ids = {event.task_id for event in sequence}
    if None in task_ids or len(task_ids) != 1:
        raise ProtocolValidationError(
            ErrorCode.PROTOCOL_INVALID_MESSAGE,
            "task event sequence must use exactly one task_id",
        )
    if sequence[0].event is not EventCode.TASK_QUEUED:
        raise ProtocolValidationError(
            ErrorCode.PROTOCOL_INVALID_MESSAGE,
            "task event sequence must start with task.queued",
        )
    terminal_events = {
        EventCode.TASK_COMPLETED,
        EventCode.TASK_FAILED,
        EventCode.TASK_CANCELLED,
    }
    terminal_seen = False
    for index, event in enumerate(sequence[1:], start=1):
        if terminal_seen:
            raise ProtocolValidationError(
                ErrorCode.PROTOCOL_INVALID_MESSAGE,
                "task event sequence cannot continue after a terminal event",
            )
        if event.event not in terminal_events | {EventCode.TASK_PROGRESS}:
            raise ProtocolValidationError(
                ErrorCode.PROTOCOL_INVALID_MESSAGE,
                f"invalid task event at position {index}: {event.event.value}",
            )
        terminal_seen = event.event in terminal_events
    if not terminal_seen:
        raise ProtocolValidationError(
            ErrorCode.PROTOCOL_INVALID_MESSAGE,
            "task event sequence must end with a terminal event",
        )
