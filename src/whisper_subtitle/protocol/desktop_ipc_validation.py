"""Validation rules for Desktop IPC v1 command and event payloads."""

from __future__ import annotations

import math
from collections.abc import Mapping, Sequence
from typing import Any

from .desktop_ipc import (
    CommandMethod,
    ErrorCode,
    EventCode,
    FrozenJson,
    JsonValue,
    PROTOCOL_SCHEMA_VERSION,
    ProtocolValidationError,
    TaskStage,
    _CANCEL_REASONS,
    _CONFLICT_POLICIES,
    _CPU_COMPUTE_TYPES,
    _CUDA_COMPUTE_TYPES,
    _HARDWARE_MODES,
    _IDENTIFIER_PATTERN,
    _INPUT_KINDS,
    _INPUT_ORIGINS,
    _MODEL_IDS,
    _OUTPUT_MODES,
    _PARAMETER_RULES,
    _PRESET_IDS,
    _RECOGNITION_STRATEGIES,
    _SPECIAL_PARAMETER_NAMES,
    _SUBTITLE_PARAMETER_RULES,
    _freeze_json,
)

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


from .desktop_ipc_quality import (
    _validate_detail_candidates,
    _validate_hotword_audit,
    _validate_language_regions,
    _validate_quality_diagnostics,
)
