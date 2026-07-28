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
_MODEL_IDS = frozenset(
    {"tiny", "base", "small", "medium", "large-v3", "large-v3-turbo"}
)
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


def _require_version(value: Any) -> int:
    if type(value) is not int or value != PROTOCOL_SCHEMA_VERSION:
        raise ProtocolValidationError(
            ErrorCode.PROTOCOL_UNSUPPORTED_VERSION,
            f"unsupported schema_version: {value!r}",
            data={"expected": PROTOCOL_SCHEMA_VERSION, "received": value},
        )
    return value


def _require_identifier(value: Any, field_name: str) -> str:
    if not isinstance(value, str) or not _IDENTIFIER_PATTERN.fullmatch(value):
        raise ProtocolValidationError(
            ErrorCode.PROTOCOL_INVALID_MESSAGE,
            f"{field_name} must be a stable non-empty identifier",
        )
    return value


def _optional_identifier(value: Any, field_name: str) -> str | None:
    if value is None:
        return None
    return _require_identifier(value, field_name)


def _optional_message(value: Any) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str) or not value.strip():
        raise ProtocolValidationError(
            ErrorCode.PROTOCOL_INVALID_MESSAGE,
            "message must be a non-empty string when present",
        )
    return value


def _require_object(
    value: Any,
    field_name: str,
    *,
    code: ErrorCode = ErrorCode.PROTOCOL_INVALID_MESSAGE,
) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise ProtocolValidationError(code, f"{field_name} must be an object")
    return value


def _require_fields(
    value: Mapping[str, Any],
    *,
    required: set[str],
    optional: set[str] = frozenset(),
    field_name: str,
    code: ErrorCode = ErrorCode.PROTOCOL_INVALID_MESSAGE,
) -> None:
    keys = set(value)
    missing = required - keys
    unexpected = keys - required - optional
    if missing or unexpected:
        raise ProtocolValidationError(
            code,
            f"{field_name} has invalid fields",
            data={
                "field": field_name,
                "missing": sorted(missing),
                "unexpected": sorted(unexpected),
            },
        )


def _require_path_array(value: Any, field_name: str) -> list[str]:
    if not isinstance(value, list) or not all(
        isinstance(item, str) and item for item in value
    ):
        raise ProtocolValidationError(
            ErrorCode.PROTOCOL_INVALID_MESSAGE,
            f"{field_name} must be an array of non-empty paths",
        )
    return value


def _require_conflict_groups(value: Any, field_name: str) -> None:
    if not isinstance(value, list):
        raise ProtocolValidationError(
            ErrorCode.PROTOCOL_INVALID_MESSAGE,
            f"{field_name} must be an array",
        )
    for index, item in enumerate(value):
        group = _require_object(item, f"{field_name}[{index}]")
        _require_fields(
            group,
            required={"input_path", "paths"},
            field_name=f"{field_name}[{index}]",
        )
        _require_nonempty_string(
            group["input_path"],
            f"{field_name}[{index}].input_path",
            code=ErrorCode.PROTOCOL_INVALID_MESSAGE,
        )
        _require_path_array(group["paths"], f"{field_name}[{index}].paths")


def _validate_quality_diagnostics(value: Any, field_name: str) -> None:
    diagnostics = _require_object(value, field_name)
    _require_fields(
        diagnostics,
        required={
            "detected_language",
            "language_probability",
            "segment_count",
            "fallback_segment_count",
            "max_temperature",
            "low_confidence_count",
            "segments",
        },
        optional={
            "recognition_strategy",
            "language_regions",
            "detail_candidates",
            "secondary_pass_count",
            "replaced_region_count",
            "review_region_count",
            "rejected_region_count",
            "hotword_audit",
        },
        field_name=field_name,
    )
    language = diagnostics["detected_language"]
    if language is not None:
        _require_nonempty_string(
            language,
            f"{field_name}.detected_language",
            code=ErrorCode.PROTOCOL_INVALID_MESSAGE,
        )
    probability = diagnostics["language_probability"]
    if probability is not None and (
        not isinstance(probability, (int, float))
        or isinstance(probability, bool)
        or not math.isfinite(probability)
        or not 0 <= probability <= 1
    ):
        raise ProtocolValidationError(
            ErrorCode.PROTOCOL_INVALID_MESSAGE,
            f"{field_name}.language_probability must be null or between 0 and 1",
        )
    for name in ("segment_count", "fallback_segment_count", "low_confidence_count"):
        _require_nonnegative_int(diagnostics[name], f"{field_name}.{name}")
    max_temperature = diagnostics["max_temperature"]
    if (
        not isinstance(max_temperature, (int, float))
        or isinstance(max_temperature, bool)
        or not math.isfinite(max_temperature)
        or not 0 <= max_temperature <= 1
    ):
        raise ProtocolValidationError(
            ErrorCode.PROTOCOL_INVALID_MESSAGE,
            f"{field_name}.max_temperature must be between 0 and 1",
        )
    segments = diagnostics["segments"]
    if not isinstance(segments, Sequence) or isinstance(
        segments, (str, bytes, bytearray)
    ):
        raise ProtocolValidationError(
            ErrorCode.PROTOCOL_INVALID_MESSAGE,
            f"{field_name}.segments must be an array",
        )
    allowed_reasons = {
        "fallback_temperature",
        "low_log_probability",
        "high_compression_ratio",
        "silence_conflict",
    }
    for index, item in enumerate(segments):
        segment_name = f"{field_name}.segments[{index}]"
        segment = _require_object(item, segment_name)
        _require_fields(
            segment,
            required={
                "index",
                "start",
                "end",
                "text",
                "temperature",
                "avg_logprob",
                "compression_ratio",
                "no_speech_prob",
                "reasons",
            },
            field_name=segment_name,
        )
        _require_nonnegative_int(segment["index"], f"{segment_name}.index")
        if not isinstance(segment["text"], str) or len(segment["text"]) > 160:
            raise ProtocolValidationError(
                ErrorCode.PROTOCOL_INVALID_MESSAGE,
                f"{segment_name}.text must contain at most 160 characters",
            )
        for name in (
            "start",
            "end",
            "temperature",
            "avg_logprob",
            "compression_ratio",
            "no_speech_prob",
        ):
            number = segment[name]
            if number is not None and (
                not isinstance(number, (int, float))
                or isinstance(number, bool)
                or not math.isfinite(number)
            ):
                raise ProtocolValidationError(
                    ErrorCode.PROTOCOL_INVALID_MESSAGE,
                    f"{segment_name}.{name} must be null or finite",
                )
        for name in ("start", "end", "temperature", "compression_ratio", "no_speech_prob"):
            number = segment[name]
            if number is not None and number < 0:
                raise ProtocolValidationError(
                    ErrorCode.PROTOCOL_INVALID_MESSAGE,
                    f"{segment_name}.{name} must be non-negative",
                )
        for name in ("temperature", "no_speech_prob"):
            number = segment[name]
            if number is not None and number > 1:
                raise ProtocolValidationError(
                    ErrorCode.PROTOCOL_INVALID_MESSAGE,
                    f"{segment_name}.{name} must not exceed 1",
                )
        if (
            segment["start"] is not None
            and segment["end"] is not None
            and segment["end"] < segment["start"]
        ):
            raise ProtocolValidationError(
                ErrorCode.PROTOCOL_INVALID_MESSAGE,
                f"{segment_name}.end cannot precede start",
            )
        reasons = segment["reasons"]
        if (
            not isinstance(reasons, Sequence)
            or isinstance(reasons, (str, bytes, bytearray))
            or not reasons
            or not all(reason in allowed_reasons for reason in reasons)
        ):
            raise ProtocolValidationError(
                ErrorCode.PROTOCOL_INVALID_MESSAGE,
                f"{segment_name}.reasons contains unsupported values",
            )
    if diagnostics["low_confidence_count"] != len(segments):
        raise ProtocolValidationError(
            ErrorCode.PROTOCOL_INVALID_MESSAGE,
            f"{field_name}.low_confidence_count must match segments",
        )
    if "recognition_strategy" in diagnostics and diagnostics[
        "recognition_strategy"
    ] not in _RECOGNITION_STRATEGIES:
        raise ProtocolValidationError(
            ErrorCode.PROTOCOL_INVALID_MESSAGE,
            f"{field_name}.recognition_strategy is unsupported",
        )
    if "language_regions" in diagnostics:
        _validate_language_regions(
            diagnostics["language_regions"], f"{field_name}.language_regions"
        )
    if "detail_candidates" in diagnostics:
        _validate_detail_candidates(
            diagnostics["detail_candidates"], f"{field_name}.detail_candidates"
        )
    for name in (
        "secondary_pass_count",
        "replaced_region_count",
        "review_region_count",
        "rejected_region_count",
    ):
        if name in diagnostics:
            _require_nonnegative_int(diagnostics[name], f"{field_name}.{name}")
    if "hotword_audit" in diagnostics:
        _validate_hotword_audit(
            diagnostics["hotword_audit"], f"{field_name}.hotword_audit"
        )


def _validate_language_regions(value: Any, field_name: str) -> None:
    if not isinstance(value, Sequence) or isinstance(value, (str, bytes, bytearray)):
        raise ProtocolValidationError(
            ErrorCode.PROTOCOL_INVALID_MESSAGE,
            f"{field_name} must be an array",
        )
    for index, item in enumerate(value):
        name = f"{field_name}[{index}]"
        region = _require_object(item, name)
        _require_fields(
            region,
            required={
                "start",
                "end",
                "top_language",
                "top_probability",
                "english_probability",
                "chinese_probability",
                "primary_text",
                "candidate_text",
                "decision",
                "reason",
            },
            field_name=name,
        )
        for number_name in (
            "start",
            "end",
            "top_probability",
            "english_probability",
            "chinese_probability",
        ):
            number = region[number_name]
            if (
                not isinstance(number, (int, float))
                or isinstance(number, bool)
                or not math.isfinite(number)
                or number < 0
            ):
                raise ProtocolValidationError(
                    ErrorCode.PROTOCOL_INVALID_MESSAGE,
                    f"{name}.{number_name} must be a non-negative finite number",
                )
        if region["end"] <= region["start"]:
            raise ProtocolValidationError(
                ErrorCode.PROTOCOL_INVALID_MESSAGE,
                f"{name}.end must be after start",
            )
        for probability_name in (
            "top_probability",
            "english_probability",
            "chinese_probability",
        ):
            if region[probability_name] > 1:
                raise ProtocolValidationError(
                    ErrorCode.PROTOCOL_INVALID_MESSAGE,
                    f"{name}.{probability_name} must not exceed 1",
                )
        _require_nonempty_string(
            region["top_language"],
            f"{name}.top_language",
            code=ErrorCode.PROTOCOL_INVALID_MESSAGE,
        )
        for text_name in ("primary_text", "candidate_text"):
            if not isinstance(region[text_name], str) or len(region[text_name]) > 160:
                raise ProtocolValidationError(
                    ErrorCode.PROTOCOL_INVALID_MESSAGE,
                    f"{name}.{text_name} must contain at most 160 characters",
                )
        if region["decision"] not in {"primary", "replaced", "review", "rejected"}:
            raise ProtocolValidationError(
                ErrorCode.PROTOCOL_INVALID_MESSAGE,
                f"{name}.decision is unsupported",
            )
        if region["reason"] is not None and (
            not isinstance(region["reason"], str) or not region["reason"]
        ):
            raise ProtocolValidationError(
                ErrorCode.PROTOCOL_INVALID_MESSAGE,
                f"{name}.reason must be null or non-empty",
            )


def _validate_detail_candidates(value: Any, field_name: str) -> None:
    if not isinstance(value, Sequence) or isinstance(value, (str, bytes, bytearray)):
        raise ProtocolValidationError(
            ErrorCode.PROTOCOL_INVALID_MESSAGE,
            f"{field_name} must be an array",
        )
    for index, item in enumerate(value):
        name = f"{field_name}[{index}]"
        candidate = _require_object(item, name)
        _require_fields(
            candidate,
            required={
                "start",
                "end",
                "chinese_probability",
                "primary_text",
                "candidate_text",
                "decision",
                "reason",
                "primary_word_probability",
                "candidate_word_probability",
                "primary_log_probability",
                "candidate_log_probability",
                "recovered_hotwords",
            },
            field_name=name,
        )
        for number_name in ("start", "end", "chinese_probability"):
            number = candidate[number_name]
            if (
                not isinstance(number, (int, float))
                or isinstance(number, bool)
                or not math.isfinite(number)
                or number < 0
            ):
                raise ProtocolValidationError(
                    ErrorCode.PROTOCOL_INVALID_MESSAGE,
                    f"{name}.{number_name} must be a non-negative finite number",
                )
        if candidate["end"] <= candidate["start"]:
            raise ProtocolValidationError(
                ErrorCode.PROTOCOL_INVALID_MESSAGE,
                f"{name}.end must be after start",
            )
        if candidate["chinese_probability"] > 1:
            raise ProtocolValidationError(
                ErrorCode.PROTOCOL_INVALID_MESSAGE,
                f"{name}.chinese_probability must not exceed 1",
            )
        for text_name in ("primary_text", "candidate_text"):
            if (
                not isinstance(candidate[text_name], str)
                or len(candidate[text_name]) > 160
            ):
                raise ProtocolValidationError(
                    ErrorCode.PROTOCOL_INVALID_MESSAGE,
                    f"{name}.{text_name} must contain at most 160 characters",
                )
        if candidate["decision"] not in {"replaced", "review", "rejected"}:
            raise ProtocolValidationError(
                ErrorCode.PROTOCOL_INVALID_MESSAGE,
                f"{name}.decision is unsupported",
            )
        if candidate["reason"] is not None and (
            not isinstance(candidate["reason"], str) or not candidate["reason"]
        ):
            raise ProtocolValidationError(
                ErrorCode.PROTOCOL_INVALID_MESSAGE,
                f"{name}.reason must be null or non-empty",
            )
        for probability_name in (
            "primary_word_probability",
            "candidate_word_probability",
        ):
            probability = candidate[probability_name]
            if probability is not None and (
                not isinstance(probability, (int, float))
                or isinstance(probability, bool)
                or not math.isfinite(probability)
                or not 0 <= probability <= 1
            ):
                raise ProtocolValidationError(
                    ErrorCode.PROTOCOL_INVALID_MESSAGE,
                    f"{name}.{probability_name} must be null or between 0 and 1",
                )
        for log_name in ("primary_log_probability", "candidate_log_probability"):
            number = candidate[log_name]
            if number is not None and (
                not isinstance(number, (int, float))
                or isinstance(number, bool)
                or not math.isfinite(number)
            ):
                raise ProtocolValidationError(
                    ErrorCode.PROTOCOL_INVALID_MESSAGE,
                    f"{name}.{log_name} must be null or finite",
                )
        terms = candidate["recovered_hotwords"]
        if (
            not isinstance(terms, Sequence)
            or isinstance(terms, (str, bytes, bytearray))
            or len(terms) > 20
            or not all(isinstance(term, str) and term for term in terms)
        ):
            raise ProtocolValidationError(
                ErrorCode.PROTOCOL_INVALID_MESSAGE,
                f"{name}.recovered_hotwords must contain at most 20 terms",
            )


def _validate_hotword_audit(value: Any, field_name: str) -> None:
    audit = _require_object(value, field_name)
    _require_fields(
        audit,
        required={
            "term_count",
            "matched_count",
            "missing_count",
            "matched_terms",
            "missing_terms",
            "omitted_term_count",
        },
        field_name=field_name,
    )
    for name in (
        "term_count",
        "matched_count",
        "missing_count",
        "omitted_term_count",
    ):
        _require_nonnegative_int(audit[name], f"{field_name}.{name}")
    for name in ("matched_terms", "missing_terms"):
        terms = audit[name]
        if (
            not isinstance(terms, Sequence)
            or isinstance(terms, (str, bytes, bytearray))
            or not all(isinstance(term, str) and term for term in terms)
            or len(terms) > 20
        ):
            raise ProtocolValidationError(
                ErrorCode.PROTOCOL_INVALID_MESSAGE,
                f"{field_name}.{name} must contain at most 20 terms",
            )


def _require_nonempty_string(
    value: Any,
    field_name: str,
    *,
    code: ErrorCode = ErrorCode.REQUEST_INVALID,
) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ProtocolValidationError(code, f"{field_name} must be non-empty")
    return value


def _require_bool(value: Any, field_name: str) -> bool:
    if type(value) is not bool:
        raise ProtocolValidationError(
            ErrorCode.REQUEST_INVALID, f"{field_name} must be boolean"
        )
    return value


def _require_nonnegative_int(value: Any, field_name: str) -> int:
    if type(value) is not int or value < 0:
        raise ProtocolValidationError(
            ErrorCode.PROTOCOL_INVALID_MESSAGE,
            f"{field_name} must be a non-negative integer",
        )
    return value


def _validate_parameter_overrides(
    value: Any, base_preset_id: str, model_id: str
) -> None:
    overrides = _require_object(
        value, "params.profile.overrides", code=ErrorCode.REQUEST_INVALID
    )
    unknown = set(overrides) - set(_PARAMETER_RULES) - _SPECIAL_PARAMETER_NAMES
    if unknown:
        raise ProtocolValidationError(
            ErrorCode.REQUEST_INVALID,
            "params.profile.overrides contains unsupported parameters",
            data={"unsupported": sorted(unknown)},
        )
    for name, parameter_value in overrides.items():
        if name == "task":
            if parameter_value not in {"transcribe", "translate"} or (
                parameter_value == "translate"
                and (
                    base_preset_id not in {"en_v1", "en_v2"}
                    or model_id == "large-v3-turbo"
                )
            ):
                raise ProtocolValidationError(
                    ErrorCode.REQUEST_INVALID,
                    "invalid override for task",
                )
            continue
        if name in {"initial_prompt", "hotwords"}:
            if (
                not isinstance(parameter_value, str)
                or not parameter_value.strip()
                or len(parameter_value) > 4000
                or any(
                    ord(character) < 0x20 and character not in {"\n", "\t"}
                    for character in parameter_value
                )
            ):
                raise ProtocolValidationError(
                    ErrorCode.REQUEST_INVALID,
                    f"invalid override for {name}",
                )
            continue
        expected_type, minimum, maximum = _PARAMETER_RULES[name]
        if expected_type is bool:
            valid_type = type(parameter_value) is bool
        elif expected_type is int:
            valid_type = type(parameter_value) is int
        else:
            valid_type = type(parameter_value) in {int, float}
        if not valid_type or not minimum <= parameter_value <= maximum:
            raise ProtocolValidationError(
                ErrorCode.REQUEST_INVALID,
                f"invalid override for {name}",
                data={
                    "parameter": name,
                    "minimum": minimum,
                    "maximum": maximum,
                    "received": parameter_value,
                },
            )


def _validate_output_target(value: Any, field_name: str) -> None:
    target = _require_object(value, field_name, code=ErrorCode.REQUEST_INVALID)
    _require_fields(
        target,
        required={"enabled"},
        optional={"directory"},
        field_name=field_name,
        code=ErrorCode.REQUEST_INVALID,
    )
    _require_bool(target["enabled"], f"{field_name}.enabled")
    if "directory" in target and target["directory"] is not None:
        _require_nonempty_string(target["directory"], f"{field_name}.directory")


def _validate_subtitle_parameters(value: Any) -> None:
    parameters = _require_object(
        value, "params.output.subtitle", code=ErrorCode.REQUEST_INVALID
    )
    _require_fields(
        parameters,
        required=set(_SUBTITLE_PARAMETER_RULES),
        field_name="params.output.subtitle",
        code=ErrorCode.REQUEST_INVALID,
    )
    for name, (expected_type, minimum, maximum) in _SUBTITLE_PARAMETER_RULES.items():
        item = parameters[name]
        valid_type = (
            type(item) is int
            if expected_type is int
            else type(item) in {int, float}
        )
        if not valid_type or not minimum <= item <= maximum:
            raise ProtocolValidationError(
                ErrorCode.REQUEST_INVALID,
                f"params.output.subtitle.{name} is invalid",
            )
    if parameters["min_cue_duration_ms"] > parameters["max_cue_duration_ms"]:
        raise ProtocolValidationError(
            ErrorCode.REQUEST_INVALID,
            "subtitle minimum duration cannot exceed maximum duration",
        )


def _validate_hardware_preference(value: Any, field_name: str) -> None:
    hardware = _require_object(value, field_name, code=ErrorCode.REQUEST_INVALID)
    _require_fields(
        hardware,
        required={
            "mode",
            "gpu_device_index",
            "cuda_compute_type",
            "cpu_compute_type",
            "cpu_threads",
        },
        field_name=field_name,
        code=ErrorCode.REQUEST_INVALID,
    )
    if hardware["mode"] not in _HARDWARE_MODES:
        raise ProtocolValidationError(
            ErrorCode.REQUEST_INVALID, f"{field_name}.mode is unsupported"
        )
    if type(hardware["gpu_device_index"]) is not int or not 0 <= hardware["gpu_device_index"] <= 31:
        raise ProtocolValidationError(
            ErrorCode.REQUEST_INVALID, f"{field_name}.gpu_device_index is invalid"
        )
    if hardware["cuda_compute_type"] not in _CUDA_COMPUTE_TYPES:
        raise ProtocolValidationError(
            ErrorCode.REQUEST_INVALID, f"{field_name}.cuda_compute_type is unsupported"
        )
    if hardware["cpu_compute_type"] not in _CPU_COMPUTE_TYPES:
        raise ProtocolValidationError(
            ErrorCode.REQUEST_INVALID, f"{field_name}.cpu_compute_type is unsupported"
        )
    if type(hardware["cpu_threads"]) is not int or not 1 <= hardware["cpu_threads"] <= 256:
        raise ProtocolValidationError(
            ErrorCode.REQUEST_INVALID, f"{field_name}.cpu_threads is invalid"
        )


def _validate_transcription_start_params(params: Mapping[str, Any]) -> None:
    _require_fields(
        params,
        required={"inputs", "profile", "output"},
        optional={"model_id", "hardware", "recognition_strategy"},
        field_name="params",
        code=ErrorCode.REQUEST_INVALID,
    )
    if "model_id" in params and params["model_id"] not in _MODEL_IDS:
        raise ProtocolValidationError(
            ErrorCode.REQUEST_INVALID, "params.model_id is unsupported"
        )
    if "hardware" in params:
        _validate_hardware_preference(params["hardware"], "params.hardware")
    inputs = params["inputs"]
    if not isinstance(inputs, Sequence) or isinstance(inputs, (str, bytes)) or not inputs:
        raise ProtocolValidationError(
            ErrorCode.REQUEST_INVALID, "params.inputs must be a non-empty array"
        )
    for index, item in enumerate(inputs):
        source = _require_object(
            item, f"params.inputs[{index}]", code=ErrorCode.REQUEST_INVALID
        )
        _require_fields(
            source,
            required={"path", "kind", "origin"},
            field_name=f"params.inputs[{index}]",
            code=ErrorCode.REQUEST_INVALID,
        )
        _require_nonempty_string(source["path"], f"params.inputs[{index}].path")
        if source["kind"] not in _INPUT_KINDS:
            raise ProtocolValidationError(
                ErrorCode.REQUEST_INVALID,
                f"params.inputs[{index}].kind is unsupported",
            )
        if source["origin"] not in _INPUT_ORIGINS:
            raise ProtocolValidationError(
                ErrorCode.REQUEST_INVALID,
                f"params.inputs[{index}].origin is unsupported",
            )

    profile = _require_object(
        params["profile"], "params.profile", code=ErrorCode.REQUEST_INVALID
    )
    _require_fields(
        profile,
        required={"base_preset_id", "overrides"},
        field_name="params.profile",
        code=ErrorCode.REQUEST_INVALID,
    )
    if profile["base_preset_id"] not in _PRESET_IDS:
        raise ProtocolValidationError(
            ErrorCode.REQUEST_INVALID,
            "params.profile.base_preset_id is unsupported",
        )
    _validate_parameter_overrides(
        profile["overrides"],
        str(profile["base_preset_id"]),
        str(params.get("model_id") or "large-v3-turbo"),
    )
    recognition_strategy = params.get("recognition_strategy", "stable_primary")
    if recognition_strategy not in _RECOGNITION_STRATEGIES:
        raise ProtocolValidationError(
            ErrorCode.REQUEST_INVALID,
            "params.recognition_strategy is unsupported",
        )
    if (
        recognition_strategy != "stable_primary"
        and (
            profile["base_preset_id"] not in {"cn", "cn2"}
            or params.get("model_id", "large-v3-turbo")
            not in {"large-v3", "large-v3-turbo"}
        )
    ):
        raise ProtocolValidationError(
            ErrorCode.REQUEST_INVALID,
            "enhanced recognition is only supported by V3/Turbo cn and cn2",
        )

    output = _require_object(
        params["output"], "params.output", code=ErrorCode.REQUEST_INVALID
    )
    _require_fields(
        output,
        required={
            "mode",
            "txt",
            "markdown",
            "preserve_source_txt",
            "conflict_policy",
        },
        optional={"root_directory", "srt", "subtitle", "preserve_source_markdown"},
        field_name="params.output",
        code=ErrorCode.REQUEST_INVALID,
    )
    if output["mode"] not in _OUTPUT_MODES:
        raise ProtocolValidationError(
            ErrorCode.REQUEST_INVALID, "params.output.mode is unsupported"
        )
    _validate_output_target(output["txt"], "params.output.txt")
    _validate_output_target(output["markdown"], "params.output.markdown")
    srt = output.get("srt", {"enabled": False})
    _validate_output_target(srt, "params.output.srt")
    if not output["txt"]["enabled"] and not output["markdown"]["enabled"] and not srt["enabled"]:
        raise ProtocolValidationError(
            ErrorCode.REQUEST_INVALID, "at least one output target must be enabled"
        )
    if srt["enabled"] and "subtitle" not in output:
        raise ProtocolValidationError(
            ErrorCode.REQUEST_INVALID,
            "SRT output requires subtitle parameters",
        )
    if "subtitle" in output:
        _validate_subtitle_parameters(output["subtitle"])
    _require_bool(output["preserve_source_txt"], "params.output.preserve_source_txt")
    if "preserve_source_markdown" in output:
        _require_bool(
            output["preserve_source_markdown"],
            "params.output.preserve_source_markdown",
        )
    if output["conflict_policy"] not in _CONFLICT_POLICIES:
        raise ProtocolValidationError(
            ErrorCode.REQUEST_INVALID,
            "params.output.conflict_policy is unsupported",
        )
    root = output.get("root_directory")
    if root is not None:
        _require_nonempty_string(root, "params.output.root_directory")
    if output["mode"] == "custom":
        for target_name, target in (
            ("txt", output["txt"]),
            ("markdown", output["markdown"]),
            ("srt", srt),
        ):
            if target["enabled"] and root is None and target.get("directory") is None:
                raise ProtocolValidationError(
                    ErrorCode.REQUEST_INVALID,
                    f"custom output requires a directory for {target_name}",
                )


def _validate_command_params(method: CommandMethod, value: Any) -> FrozenJson:
    params = _require_object(value, "params", code=ErrorCode.REQUEST_INVALID)
    if method in {
        CommandMethod.SYSTEM_HEALTH,
        CommandMethod.SYSTEM_ENVIRONMENT,
        CommandMethod.SYSTEM_METRICS,
        CommandMethod.MODEL_UNLOAD,
        CommandMethod.WORKER_SHUTDOWN,
    }:
        _require_fields(
            params,
            required=set(),
            field_name="params",
            code=ErrorCode.REQUEST_INVALID,
        )
    elif method is CommandMethod.MODEL_LOAD:
        _require_fields(
            params,
            required=set(),
            optional={"model_id", "hardware"},
            field_name="params",
            code=ErrorCode.REQUEST_INVALID,
        )
        if "model_id" in params:
            _require_nonempty_string(params["model_id"], "params.model_id")
        if "hardware" in params:
            _validate_hardware_preference(params["hardware"], "params.hardware")
    elif method is CommandMethod.MEDIA_INSPECT:
        _require_fields(
            params,
            required={"paths"},
            field_name="params",
            code=ErrorCode.REQUEST_INVALID,
        )
        if not _require_path_array(params["paths"], "params.paths"):
            raise ProtocolValidationError(
                ErrorCode.REQUEST_INVALID,
                "params.paths must contain at least one media path",
            )
    elif method is CommandMethod.TRANSCRIPTION_CANCEL:
        _require_fields(
            params,
            required={"task_id"},
            field_name="params",
            code=ErrorCode.REQUEST_INVALID,
        )
        _require_identifier(params["task_id"], "params.task_id")
    elif method is CommandMethod.TRANSCRIPTION_START:
        _validate_transcription_start_params(params)
    return _freeze_json(params, "params")


def _validate_event_data(event: EventCode, value: Any) -> FrozenJson:
    data = _require_object(value, "data")
    if event is EventCode.WORKER_READY:
        _require_fields(
            data,
            required={"pid", "capabilities"},
            field_name="data",
        )
        if type(data["pid"]) is not int or data["pid"] <= 0:
            raise ProtocolValidationError(
                ErrorCode.PROTOCOL_INVALID_MESSAGE, "data.pid must be positive"
            )
        capabilities = _require_object(data["capabilities"], "data.capabilities")
        _require_fields(
            capabilities,
            required={"methods", "events"},
            field_name="data.capabilities",
        )
        if not isinstance(capabilities["methods"], list) or not isinstance(
            capabilities["events"], list
        ):
            raise ProtocolValidationError(
                ErrorCode.PROTOCOL_INVALID_MESSAGE,
                "capability methods and events must be arrays",
            )
        try:
            methods = [CommandMethod(item) for item in capabilities["methods"]]
            events = [EventCode(item) for item in capabilities["events"]]
        except (TypeError, ValueError) as exc:
            raise ProtocolValidationError(
                ErrorCode.PROTOCOL_INVALID_MESSAGE,
                "capabilities contain an unsupported method or event",
            ) from exc
        if len(methods) != len(set(methods)) or len(events) != len(set(events)):
            raise ProtocolValidationError(
                ErrorCode.PROTOCOL_INVALID_MESSAGE,
                "capability methods and events must be unique",
            )
    elif event is EventCode.COMMAND_COMPLETED:
        _require_fields(
            data,
            required={"method", "result"},
            field_name="data",
        )
        try:
            CommandMethod(data["method"])
        except (TypeError, ValueError) as exc:
            raise ProtocolValidationError(
                ErrorCode.PROTOCOL_INVALID_MESSAGE,
                "data.method is unsupported",
            ) from exc
        _require_object(data["result"], "data.result")
    elif event is EventCode.MODEL_LOADING:
        _require_fields(data, required={"model_id"}, field_name="data")
        _require_nonempty_string(
            data["model_id"], "data.model_id", code=ErrorCode.PROTOCOL_INVALID_MESSAGE
        )
    elif event is EventCode.MODEL_READY:
        _require_fields(
            data,
            required={"model_id", "device", "compute_type"},
            optional={"device_index", "cpu_threads"},
            field_name="data",
        )
        for name in ("model_id", "device", "compute_type"):
            _require_nonempty_string(
                data[name], f"data.{name}", code=ErrorCode.PROTOCOL_INVALID_MESSAGE
            )
        if "device_index" in data:
            _require_nonnegative_int(data["device_index"], "data.device_index")
        if "cpu_threads" in data:
            _require_nonnegative_int(data["cpu_threads"], "data.cpu_threads")
    elif event is EventCode.TASK_QUEUED:
        _require_fields(
            data,
            required={"position", "input_count", "effective_parameters"},
            optional={
                "model_id",
                "hardware",
                "recognition_strategy",
                "media_paths",
                "media_durations_seconds",
                "skipped_media",
            },
            field_name="data",
        )
        if "model_id" in data and data["model_id"] not in _MODEL_IDS:
            raise ProtocolValidationError(
                ErrorCode.PROTOCOL_INVALID_MESSAGE,
                "data.model_id is unsupported",
            )
        if (
            "recognition_strategy" in data
            and data["recognition_strategy"] not in _RECOGNITION_STRATEGIES
        ):
            raise ProtocolValidationError(
                ErrorCode.PROTOCOL_INVALID_MESSAGE,
                "data.recognition_strategy is unsupported",
            )
        _require_nonnegative_int(data["position"], "data.position")
        if type(data["input_count"]) is not int or data["input_count"] <= 0:
            raise ProtocolValidationError(
                ErrorCode.PROTOCOL_INVALID_MESSAGE,
                "data.input_count must be a positive integer",
            )
        if "media_paths" in data:
            _require_path_array(data["media_paths"], "data.media_paths")
        if "media_durations_seconds" in data:
            durations = data["media_durations_seconds"]
            if not isinstance(durations, list) or not all(
                item is None
                or (
                    isinstance(item, (int, float))
                    and not isinstance(item, bool)
                    and math.isfinite(item)
                    and item >= 0
                )
                for item in durations
            ):
                raise ProtocolValidationError(
                    ErrorCode.PROTOCOL_INVALID_MESSAGE,
                    "data.media_durations_seconds must contain nonnegative numbers or null",
                )
            if "media_paths" not in data or len(durations) != len(data["media_paths"]):
                raise ProtocolValidationError(
                    ErrorCode.PROTOCOL_INVALID_MESSAGE,
                    "data.media_durations_seconds must align with data.media_paths",
                )
        if "skipped_media" in data:
            _require_conflict_groups(data["skipped_media"], "data.skipped_media")
        _require_object(data["effective_parameters"], "data.effective_parameters")
        if "hardware" in data:
            hardware = _require_object(data["hardware"], "data.hardware")
            _require_fields(
                hardware,
                required={"device", "device_index", "compute_type", "cpu_threads"},
                field_name="data.hardware",
            )
            if hardware["device"] not in {"cpu", "cuda"}:
                raise ProtocolValidationError(
                    ErrorCode.PROTOCOL_INVALID_MESSAGE,
                    "data.hardware.device is unsupported",
                )
            _require_nonnegative_int(hardware["device_index"], "data.hardware.device_index")
            _require_nonnegative_int(hardware["cpu_threads"], "data.hardware.cpu_threads")
            _require_nonempty_string(
                hardware["compute_type"],
                "data.hardware.compute_type",
                code=ErrorCode.PROTOCOL_INVALID_MESSAGE,
            )
    elif event is EventCode.TASK_PROGRESS:
        _require_fields(
            data,
            required={"stage", "current", "total"},
            optional={
                "input_path",
                "media_index",
                "media_progress_percent",
                "media_elapsed_seconds",
                "task_elapsed_seconds",
                "media_status",
                "output_paths",
                "quality_diagnostics",
            },
            field_name="data",
        )
        try:
            TaskStage(data["stage"])
        except (TypeError, ValueError) as exc:
            raise ProtocolValidationError(
                ErrorCode.PROTOCOL_INVALID_MESSAGE,
                "data.stage is unsupported",
            ) from exc
        current = _require_nonnegative_int(data["current"], "data.current")
        total = _require_nonnegative_int(data["total"], "data.total")
        if current > total:
            raise ProtocolValidationError(
                ErrorCode.PROTOCOL_INVALID_MESSAGE,
                "data.current cannot exceed data.total",
            )
        if "input_path" in data:
            _require_nonempty_string(
                data["input_path"],
                "data.input_path",
                code=ErrorCode.PROTOCOL_INVALID_MESSAGE,
            )
        if "media_index" in data:
            media_index = _require_nonnegative_int(data["media_index"], "data.media_index")
            if media_index == 0 or media_index > total:
                raise ProtocolValidationError(
                    ErrorCode.PROTOCOL_INVALID_MESSAGE,
                    "data.media_index must identify a media item",
                )
        for name in ("media_elapsed_seconds", "task_elapsed_seconds"):
            if name in data and (
                not isinstance(data[name], (int, float))
                or isinstance(data[name], bool)
                or data[name] < 0
            ):
                raise ProtocolValidationError(
                    ErrorCode.PROTOCOL_INVALID_MESSAGE,
                    f"data.{name} must be non-negative",
                )
        if "media_progress_percent" in data and (
            not isinstance(data["media_progress_percent"], (int, float))
            or isinstance(data["media_progress_percent"], bool)
            or not 0 <= data["media_progress_percent"] <= 100
        ):
            raise ProtocolValidationError(
                ErrorCode.PROTOCOL_INVALID_MESSAGE,
                "data.media_progress_percent must be between 0 and 100",
            )
        if "media_status" in data and (
            not isinstance(data["media_status"], str)
            or data["media_status"]
            not in {"pending", "running", "completed", "failed", "skipped"}
        ):
            raise ProtocolValidationError(
                ErrorCode.PROTOCOL_INVALID_MESSAGE,
                "data.media_status is unsupported",
            )
        if "output_paths" in data and (
            not isinstance(data["output_paths"], list)
            or not all(isinstance(path, str) and path for path in data["output_paths"])
        ):
            raise ProtocolValidationError(
                ErrorCode.PROTOCOL_INVALID_MESSAGE,
                "data.output_paths must be an array of non-empty paths",
            )
        if "quality_diagnostics" in data:
            _validate_quality_diagnostics(
                data["quality_diagnostics"], "data.quality_diagnostics"
            )
    elif event is EventCode.TASK_COMPLETED:
        _require_fields(
            data,
            required={"success_count", "failure_count", "outputs"},
            optional={"skipped_media"},
            field_name="data",
        )
        _require_nonnegative_int(data["success_count"], "data.success_count")
        _require_nonnegative_int(data["failure_count"], "data.failure_count")
        if not isinstance(data["outputs"], list) or not all(
            isinstance(item, str) and item for item in data["outputs"]
        ):
            raise ProtocolValidationError(
                ErrorCode.PROTOCOL_INVALID_MESSAGE,
                "data.outputs must be an array of non-empty paths",
            )
        if "skipped_media" in data:
            _require_conflict_groups(data["skipped_media"], "data.skipped_media")
    elif event is EventCode.TASK_FAILED:
        _require_fields(
            data,
            required={"error_code", "details"},
            field_name="data",
        )
        try:
            ErrorCode(data["error_code"])
        except (TypeError, ValueError) as exc:
            raise ProtocolValidationError(
                ErrorCode.PROTOCOL_INVALID_MESSAGE,
                "data.error_code is unsupported",
            ) from exc
        _require_object(data["details"], "data.details")
    elif event is EventCode.TASK_CANCELLED:
        _require_fields(data, required={"reason"}, field_name="data")
        if data["reason"] not in _CANCEL_REASONS:
            raise ProtocolValidationError(
                ErrorCode.PROTOCOL_INVALID_MESSAGE,
                "data.reason is unsupported",
            )
    return _freeze_json(data, "data")


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
