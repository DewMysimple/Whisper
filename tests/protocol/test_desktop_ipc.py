"""Contract tests for the versioned desktop IPC without starting a Worker."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from whisper_subtitle.domain.contracts import ProgressEvent
from whisper_subtitle.domain.presets import EDITABLE_PARAMETER_RULES
from whisper_subtitle.presentation.console import progress_event_payload
from whisper_subtitle.protocol import (
    PROTOCOL_SCHEMA_VERSION,
    CommandMessage,
    CommandMethod,
    ErrorCode,
    ErrorMessage,
    EventCode,
    EventMessage,
    MessageType,
    ProtocolValidationError,
    TaskStage,
    encode_protocol_message,
    parse_protocol_line,
    protocol_error_from_exception,
    validate_task_event_sequence,
)


PROJECT_ROOT = Path(__file__).resolve().parents[2]
SCHEMA_PATH = (
    PROJECT_ROOT
    / "contracts"
    / "desktop_ipc"
    / "v1"
    / "desktop_ipc.schema.json"
)


def load_schema() -> dict:
    return json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))


def start_params(*, overrides=None, mode="compatibility") -> dict:
    output = {
        "mode": mode,
        "txt": {"enabled": True},
        "markdown": {"enabled": False},
        "preserve_source_txt": True,
        "conflict_policy": "overwrite",
    }
    if mode == "custom":
        output["root_directory"] = "D:/Transcripts"
    return {
        "inputs": [
            {
                "path": '"C:/Media Folder/中文文件.mp4"',
                "kind": "file",
                "origin": "paste",
            },
            {
                "path": "D:/Batch",
                "kind": "directory",
                "origin": "dialog",
            },
        ],
        "profile": {
            "base_preset_id": "cn2",
            "overrides": overrides or {},
        },
        "output": output,
    }


def test_media_inspect_accepts_nonempty_local_paths():
    message = CommandMessage(
        "req-media-inspect",
        CommandMethod.MEDIA_INSPECT,
        {"paths": ["C:/Media/one.mp4", "D:/Batch/two.wav"]},
    )

    assert message.params["paths"] == ("C:/Media/one.mp4", "D:/Batch/two.wav")


def test_media_inspect_rejects_empty_path_list():
    with pytest.raises(ProtocolValidationError):
        CommandMessage("req-media-inspect", CommandMethod.MEDIA_INSPECT, {"paths": []})


def queued(task_id="task-1") -> EventMessage:
    return EventMessage(
        EventCode.TASK_QUEUED,
        {
            "position": 0,
            "input_count": 2,
            "effective_parameters": {"language": "zh", "beam_size": 5},
        },
        request_id="req-1",
        task_id=task_id,
        message="任务已加入队列",
    )


def progress(task_id="task-1", current=1, total=2) -> EventMessage:
    return EventMessage(
        EventCode.TASK_PROGRESS,
        {
            "stage": TaskStage.TRANSCRIPTION_RUNNING.value,
            "current": current,
            "total": total,
            "input_path": "C:/Media/input.wav",
            "media_index": current,
            "media_progress_percent": 42.5,
            "media_elapsed_seconds": 12.25,
            "task_elapsed_seconds": 14.0,
            "media_status": "running",
            "output_paths": ["C:/Media/Text/input.txt"],
        },
        task_id=task_id,
        message="正在转录",
    )


def completed(task_id="task-1") -> EventMessage:
    return EventMessage(
        EventCode.TASK_COMPLETED,
        {
            "success_count": 2,
            "failure_count": 0,
            "outputs": ["C:/Media/Text/a.txt", "C:/Media/Text/b.txt"],
        },
        task_id=task_id,
        message="任务完成",
    )


def test_schema_is_v1_and_python_codes_match_the_source_of_truth():
    schema = load_schema()
    definitions = schema["$defs"]

    assert schema["$schema"] == "https://json-schema.org/draft/2020-12/schema"
    assert definitions["SchemaVersion"]["const"] == PROTOCOL_SCHEMA_VERSION
    assert definitions["CommandMethod"]["enum"] == [
        item.value for item in CommandMethod
    ]
    assert definitions["EventCode"]["enum"] == [item.value for item in EventCode]
    assert definitions["TaskStage"]["enum"] == [item.value for item in TaskStage]
    assert definitions["ErrorCode"]["enum"] == [item.value for item in ErrorCode]
    assert set(schema["oneOf"][index]["$ref"] for index in range(3)) == {
        "#/$defs/CommandMessage",
        "#/$defs/EventMessage",
        "#/$defs/ErrorMessage",
    }


def test_schema_is_self_contained_and_has_no_unresolved_local_refs():
    schema = load_schema()
    references = []

    def visit(value):
        if isinstance(value, dict):
            if "$ref" in value:
                references.append(value["$ref"])
            for child in value.values():
                visit(child)
        elif isinstance(value, list):
            for child in value:
                visit(child)

    visit(schema)
    assert references
    for reference in references:
        assert reference.startswith("#/$defs/")
        assert reference.removeprefix("#/$defs/") in schema["$defs"]

    output_policy = schema["$defs"]["OutputPolicy"]
    assert output_policy["allOf"][0]["anyOf"]
    assert output_policy["allOf"][1]["if"]["properties"]["mode"]["const"] == "custom"

    hardware = schema["$defs"]["HardwarePreference"]
    assert hardware["properties"]["mode"]["enum"] == ["auto", "cuda", "cpu"]
    assert hardware["properties"]["cuda_compute_type"]["enum"] == [
        "float16",
        "int8_float16",
        "float32",
    ]
    assert (
        schema["$defs"]["TranscriptionStartParams"]["properties"]["hardware"]["$ref"]
        == "#/$defs/HardwarePreference"
    )
    assert (
        schema["$defs"]["TaskQueuedData"]["properties"]["hardware"]["$ref"]
        == "#/$defs/ResolvedHardware"
    )


def test_schema_parameter_boundaries_match_worker_domain_validation():
    properties = load_schema()["$defs"]["ParameterOverrides"]["properties"]

    assert set(properties) == set(EDITABLE_PARAMETER_RULES) | {
        "task",
        "initial_prompt",
        "hotwords",
    }
    for name, (expected_type, minimum, maximum) in EDITABLE_PARAMETER_RULES.items():
        if expected_type is bool:
            assert properties[name]["type"] == "boolean"
            continue
        assert properties[name]["minimum"] == minimum
        assert properties[name]["maximum"] == maximum
    assert properties["task"]["enum"] == ["transcribe", "translate"]
    assert properties["initial_prompt"]["maxLength"] == 4000
    assert properties["hotwords"]["maxLength"] == 4000


def test_transcription_start_round_trips_structured_paths_and_custom_overrides():
    message = CommandMessage(
        "req-001",
        CommandMethod.TRANSCRIPTION_START,
        start_params(
            overrides={
                "beam_size": 8,
                "temperature": 0.2,
                "condition_on_previous_text": False,
            },
            mode="custom",
        ),
    )

    line = encode_protocol_message(message)
    parsed = parse_protocol_line(line)

    assert isinstance(parsed, CommandMessage)
    assert parsed.to_payload() == message.to_payload()
    assert parsed.params["inputs"][0]["path"] == '"C:/Media Folder/中文文件.mp4"'
    assert parsed.params["profile"]["base_preset_id"] == "cn2"
    assert parsed.params["output"]["markdown"]["enabled"] is False
    with pytest.raises(TypeError):
        parsed.params["profile"]["overrides"]["beam_size"] = 10


def test_transcription_start_accepts_english_translation_and_guidance_overrides():
    params = start_params(
        overrides={
            "task": "translate",
            "initial_prompt": "CTranslate2\nWebView2",
            "hotwords": "WhisperSubtitle Large V3",
            "repetition_penalty": 1.1,
            "no_repeat_ngram_size": 3,
            "prompt_reset_on_temperature": 0.7,
            "temperature": 0.0,
        }
    )
    params["profile"]["base_preset_id"] = "en_v2"
    params["model_id"] = "large-v3"
    parsed = CommandMessage(
        "req-advanced-parameters",
        CommandMethod.TRANSCRIPTION_START,
        params,
    )

    assert parsed.params["profile"]["overrides"]["task"] == "translate"
    assert parsed.params["profile"]["overrides"]["temperature"] == 0.0


def test_transcription_start_rejects_translation_for_chinese_preset():
    with pytest.raises(ProtocolValidationError):
        CommandMessage(
            "req-invalid-translation",
            CommandMethod.TRANSCRIPTION_START,
            start_params(overrides={"task": "translate"}),
        )


def test_transcription_start_rejects_translation_for_turbo_model():
    params = start_params(overrides={"task": "translate"})
    params["profile"]["base_preset_id"] = "en_v2"
    params["model_id"] = "large-v3-turbo"
    with pytest.raises(ProtocolValidationError):
        CommandMessage(
            "req-invalid-turbo-translation",
            CommandMethod.TRANSCRIPTION_START,
            params,
        )


def test_transcription_model_id_is_optional_and_restricted_to_local_catalog():
    legacy = CommandMessage(
        "req-legacy-model", CommandMethod.TRANSCRIPTION_START, start_params()
    )
    assert "model_id" not in legacy.params

    params = start_params()
    params["model_id"] = "medium"
    selected = CommandMessage(
        "req-medium-model", CommandMethod.TRANSCRIPTION_START, params
    )
    assert selected.params["model_id"] == "medium"

    params["model_id"] = "unknown-model"
    with pytest.raises(ProtocolValidationError):
        CommandMessage("req-invalid-model", CommandMethod.TRANSCRIPTION_START, params)


def test_task_queued_may_echo_the_frozen_model_id():
    event = EventMessage(
        EventCode.TASK_QUEUED,
        {
            "position": 0,
            "input_count": 1,
            "model_id": "small",
            "effective_parameters": {"language": "en"},
        },
        request_id="req-model-event",
        task_id="task-model-event",
    )
    assert event.data["model_id"] == "small"

def test_mixed_recognition_strategy_is_frozen_and_limited_to_v3_chinese_presets():
    params = start_params()
    params["model_id"] = "large-v3"
    params["profile"]["base_preset_id"] = "cn2"
    params["recognition_strategy"] = "mixed_zh_en"
    command = CommandMessage(
        "req-mixed-strategy", CommandMethod.TRANSCRIPTION_START, params
    )
    assert command.params["recognition_strategy"] == "mixed_zh_en"

    queued = EventMessage(
        EventCode.TASK_QUEUED,
        {
            "position": 0,
            "input_count": 1,
            "recognition_strategy": "mixed_zh_en",
            "effective_parameters": {"language": "zh"},
        },
        request_id="req-mixed-strategy",
        task_id="task-mixed-strategy",
    )
    assert queued.data["recognition_strategy"] == "mixed_zh_en"

    english = start_params()
    english["profile"]["base_preset_id"] = "en_v2"
    english["recognition_strategy"] = "mixed_zh_en"
    with pytest.raises(ProtocolValidationError):
        CommandMessage(
            "req-mixed-english", CommandMethod.TRANSCRIPTION_START, english
        )

    hidden_model = start_params()
    hidden_model["model_id"] = "small"
    hidden_model["profile"]["base_preset_id"] = "cn2"
    hidden_model["recognition_strategy"] = "mixed_zh_en"
    with pytest.raises(ProtocolValidationError):
        CommandMessage(
            "req-mixed-small", CommandMethod.TRANSCRIPTION_START, hidden_model
        )

    detail = start_params()
    detail["model_id"] = "large-v3-turbo"
    detail["profile"]["base_preset_id"] = "cn"
    detail["recognition_strategy"] = "zh_detail_review"
    command = CommandMessage(
        "req-detail-strategy", CommandMethod.TRANSCRIPTION_START, detail
    )
    assert command.params["recognition_strategy"] == "zh_detail_review"


def test_hardware_preference_is_optional_and_frozen_in_task_event():
    legacy = CommandMessage(
        "req-legacy-hardware", CommandMethod.TRANSCRIPTION_START, start_params()
    )
    assert "hardware" not in legacy.params

    preference = {
        "mode": "cuda",
        "gpu_device_index": 1,
        "cuda_compute_type": "int8_float16",
        "cpu_compute_type": "int8",
        "cpu_threads": 4,
    }
    params = start_params()
    params["hardware"] = preference
    command = CommandMessage(
        "req-hardware", CommandMethod.TRANSCRIPTION_START, params
    )
    assert dict(command.params["hardware"]) == preference

    model_load = CommandMessage(
        "req-model-hardware",
        CommandMethod.MODEL_LOAD,
        {"model_id": "large-v3-turbo", "hardware": preference},
    )
    assert dict(model_load.params["hardware"]) == preference

    event = EventMessage(
        EventCode.TASK_QUEUED,
        {
            "position": 0,
            "input_count": 1,
            "model_id": "large-v3-turbo",
            "hardware": {
                "device": "cuda",
                "device_index": 1,
                "compute_type": "int8_float16",
                "cpu_threads": 0,
            },
            "effective_parameters": {"language": "en"},
        },
        request_id="req-hardware",
        task_id="task-hardware",
    )
    assert event.data["hardware"]["device_index"] == 1


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("mode", "directml"),
        ("gpu_device_index", -1),
        ("cuda_compute_type", "int8"),
        ("cpu_compute_type", "float16"),
        ("cpu_threads", 0),
    ],
)
def test_invalid_hardware_preferences_are_rejected(field, value):
    params = start_params()
    hardware = {
        "mode": "auto",
        "gpu_device_index": 0,
        "cuda_compute_type": "float16",
        "cpu_compute_type": "int8",
        "cpu_threads": 4,
    }
    hardware[field] = value
    params["hardware"] = hardware

    with pytest.raises(ProtocolValidationError):
        CommandMessage("req-invalid-hardware", CommandMethod.TRANSCRIPTION_START, params)


def test_srt_output_accepts_complete_user_controlled_subtitle_parameters():
    params = start_params()
    params["output"].update(
        {
            "txt": {"enabled": False},
            "srt": {"enabled": True},
            "preserve_source_txt": False,
            "subtitle": {
                "max_characters_per_line": 18,
                "max_lines_per_cue": 2,
                "min_cue_duration_ms": 800,
                "max_cue_duration_ms": 7000,
                "max_characters_per_second": 20,
                "cue_gap_ms": 80,
            },
        }
    )

    message = CommandMessage("req-srt", CommandMethod.TRANSCRIPTION_START, params)

    assert message.params["output"]["srt"]["enabled"] is True
    assert message.params["output"]["subtitle"]["max_characters_per_line"] == 18


def test_markdown_source_copy_is_an_optional_boolean_v1_extension():
    params = start_params(mode="custom")
    params["output"]["markdown"] = {"enabled": True}
    params["output"]["preserve_source_markdown"] = True

    message = CommandMessage("req-md-copy", CommandMethod.TRANSCRIPTION_START, params)

    assert message.params["output"]["preserve_source_markdown"] is True
    params["output"]["preserve_source_markdown"] = "yes"
    with pytest.raises(ProtocolValidationError):
        CommandMessage("req-md-invalid", CommandMethod.TRANSCRIPTION_START, params)


@pytest.mark.parametrize(
    ("method", "params"),
    [
        (CommandMethod.SYSTEM_HEALTH, {}),
        (CommandMethod.SYSTEM_ENVIRONMENT, {}),
        (CommandMethod.MODEL_LOAD, {"model_id": "large-v3-turbo"}),
        (CommandMethod.MODEL_UNLOAD, {}),
        (CommandMethod.TRANSCRIPTION_CANCEL, {"task_id": "task-1"}),
        (CommandMethod.WORKER_SHUTDOWN, {}),
    ],
)
def test_each_non_start_command_has_a_stable_round_trip(method, params):
    message = CommandMessage("req-1", method, params)
    assert parse_protocol_line(encode_protocol_message(message)) == message


@pytest.mark.parametrize(
    "overrides",
    [
        {"unknown_option": 1},
        {"beam_size": 0},
        {"beam_size": True},
        {"temperature": 1.1},
        {"condition_on_previous_text": 1},
        {"min_silence_duration_ms": -1},
    ],
)
def test_start_rejects_unsupported_or_out_of_range_overrides(overrides):
    with pytest.raises(ProtocolValidationError) as captured:
        CommandMessage(
            "req-1",
            CommandMethod.TRANSCRIPTION_START,
            start_params(overrides=overrides),
        )

    assert captured.value.code is ErrorCode.REQUEST_INVALID


def test_custom_output_requires_a_resolvable_directory_for_enabled_targets():
    params = start_params(mode="custom")
    params["output"].pop("root_directory")

    with pytest.raises(ProtocolValidationError) as captured:
        CommandMessage("req-1", CommandMethod.TRANSCRIPTION_START, params)

    assert captured.value.code is ErrorCode.REQUEST_INVALID
    assert "directory" in str(captured.value)


@pytest.mark.parametrize(
    ("line", "expected_code"),
    [
        ("not-json", ErrorCode.PROTOCOL_INVALID_JSON),
        ("[]", ErrorCode.PROTOCOL_INVALID_MESSAGE),
        (
            '{"schema_version":2,"type":"command","request_id":"req-1",'
            '"method":"system.health","params":{}}',
            ErrorCode.PROTOCOL_UNSUPPORTED_VERSION,
        ),
        (
            '{"schema_version":1,"type":"command","request_id":"req-1",'
            '"method":"unknown","params":{}}',
            ErrorCode.PROTOCOL_UNKNOWN_METHOD,
        ),
        (
            '{"schema_version":1,"type":"command","request_id":"req-1",'
            '"method":"system.health","params":{},"extra":true}',
            ErrorCode.PROTOCOL_INVALID_MESSAGE,
        ),
    ],
)
def test_parser_maps_bad_lines_to_stable_error_codes(line, expected_code):
    with pytest.raises(ProtocolValidationError) as captured:
        parse_protocol_line(line)

    assert captured.value.code is expected_code


def test_validation_failure_converts_to_a_separate_machine_error_and_message():
    try:
        parse_protocol_line("not-json")
    except ProtocolValidationError as error:
        response = protocol_error_from_exception(error, request_id="req-1")
    else:
        raise AssertionError("invalid JSON should fail")

    assert isinstance(response, ErrorMessage)
    assert response.code is ErrorCode.PROTOCOL_INVALID_JSON
    assert response.request_id == "req-1"
    assert response.message == "protocol line is not valid JSON"
    assert response.to_payload()["data"] == {}
    assert parse_protocol_line(encode_protocol_message(response)) == response


def test_worker_and_model_events_do_not_require_task_identity():
    ready = EventMessage(
        EventCode.WORKER_READY,
        {
            "pid": 1234,
            "capabilities": {
                "methods": [item.value for item in CommandMethod],
                "events": [item.value for item in EventCode],
            },
        },
        message="Worker ready",
    )
    loading = EventMessage(
        EventCode.MODEL_LOADING,
        {"model_id": "large-v3-turbo"},
    )
    model_ready = EventMessage(
        EventCode.MODEL_READY,
        {
            "model_id": "large-v3-turbo",
            "device": "cuda",
            "compute_type": "float16",
        },
    )

    assert ready.task_id is None
    assert loading.task_id is None
    assert model_ready.task_id is None
    for event in (ready, loading, model_ready):
        assert parse_protocol_line(encode_protocol_message(event)) == event


def test_command_completed_is_request_correlated_and_machine_readable():
    completed_command = EventMessage(
        EventCode.COMMAND_COMPLETED,
        {
            "method": CommandMethod.SYSTEM_HEALTH.value,
            "result": {"status": "ok", "model_loaded": False},
        },
        request_id="req-health",
    )

    assert parse_protocol_line(encode_protocol_message(completed_command)) == completed_command
    with pytest.raises(ProtocolValidationError, match="requires request_id"):
        EventMessage(
            EventCode.COMMAND_COMPLETED,
            {"method": "system.health", "result": {}},
        )


@pytest.mark.parametrize(
    "capabilities",
    [
        {"methods": ["unknown.method"], "events": []},
        {"methods": [], "events": ["unknown.event"]},
        {"methods": ["system.health", "system.health"], "events": []},
        {"methods": [], "events": ["worker.ready", "worker.ready"]},
    ],
)
def test_worker_ready_rejects_unknown_or_duplicate_capabilities(capabilities):
    with pytest.raises(ProtocolValidationError) as captured:
        EventMessage(
            EventCode.WORKER_READY,
            {"pid": 1234, "capabilities": capabilities},
        )

    assert captured.value.code is ErrorCode.PROTOCOL_INVALID_MESSAGE


@pytest.mark.parametrize(
    "terminal",
    [
        completed(),
        EventMessage(
            EventCode.TASK_FAILED,
            {"error_code": "transcription.failed", "details": {"input": "a.wav"}},
            task_id="task-1",
        ),
        EventMessage(
            EventCode.TASK_CANCELLED,
            {"reason": "user"},
            task_id="task-1",
        ),
    ],
)
def test_valid_task_event_sequences_end_in_exactly_one_terminal_event(terminal):
    validate_task_event_sequence([queued(), progress(), progress(current=2), terminal])


@pytest.mark.parametrize(
    "events",
    [
        [],
        [progress(), completed()],
        [queued(), progress()],
        [queued(), completed(), progress()],
        [queued(), completed("task-2")],
    ],
)
def test_invalid_task_event_sequences_are_rejected(events):
    with pytest.raises(ProtocolValidationError) as captured:
        validate_task_event_sequence(events)

    assert captured.value.code is ErrorCode.PROTOCOL_INVALID_MESSAGE


def test_task_events_require_task_id_and_queued_also_requires_request_id():
    with pytest.raises(ProtocolValidationError, match="requires task_id"):
        EventMessage(
            EventCode.TASK_PROGRESS,
            {"stage": "input.validating", "current": 0, "total": 1},
        )
    with pytest.raises(ProtocolValidationError, match="requires request_id"):
        EventMessage(
            EventCode.TASK_QUEUED,
            {"position": 0, "input_count": 1, "effective_parameters": {}},
            task_id="task-1",
        )


def test_task_progress_accepts_optional_output_paths_and_rejects_invalid_values():
    event = progress()
    assert event.data["output_paths"] == ("C:/Media/Text/input.txt",)

    with pytest.raises(
        ProtocolValidationError, match="output_paths must be an array"
    ):
        EventMessage(
            EventCode.TASK_PROGRESS,
            {
                "stage": TaskStage.OUTPUT_WRITING.value,
                "current": 1,
                "total": 1,
                "output_paths": "C:/Media/Text/input.txt",
            },
            task_id="task-1",
        )


def test_task_progress_accepts_structured_quality_diagnostics():
    diagnostics = {
        "detected_language": "zh",
        "language_probability": 0.92,
        "segment_count": 2,
        "fallback_segment_count": 1,
        "max_temperature": 0.4,
        "low_confidence_count": 1,
        "recognition_strategy": "mixed_zh_en",
        "secondary_pass_count": 1,
        "replaced_region_count": 1,
        "review_region_count": 0,
        "rejected_region_count": 0,
        "detail_candidates": [
            {
                "start": 35.0,
                "end": 40.0,
                "chinese_probability": 0.94,
                "primary_text": "拟太环境",
                "candidate_text": "拟态环境",
                "decision": "replaced",
                "reason": "hotword_recovered",
                "primary_word_probability": 0.62,
                "candidate_word_probability": 0.91,
                "primary_log_probability": -0.85,
                "candidate_log_probability": -0.62,
                "recovered_hotwords": ["拟态"],
            }
        ],
        "language_regions": [
            {
                "start": 25.0,
                "end": 31.5,
                "top_language": "en",
                "top_probability": 0.91,
                "english_probability": 0.91,
                "chinese_probability": 0.04,
                "primary_text": "第一遍文本",
                "candidate_text": "This is an English candidate.",
                "decision": "replaced",
                "reason": None,
            }
        ],
        "hotword_audit": {
            "term_count": 2,
            "matched_count": 1,
            "missing_count": 1,
            "matched_terms": ["Walter Lippmann"],
            "missing_terms": ["simulacra-self"],
            "omitted_term_count": 0,
        },
        "segments": [
            {
                "index": 1,
                "start": 3.0,
                "end": 5.0,
                "text": "需要复核",
                "temperature": 0.4,
                "avg_logprob": -1.2,
                "compression_ratio": 2.5,
                "no_speech_prob": 0.1,
                "reasons": ["fallback_temperature", "low_log_probability"],
            }
        ],
    }
    event = EventMessage(
        EventCode.TASK_PROGRESS,
        {
            "stage": TaskStage.TRANSCRIPTION_RUNNING.value,
            "current": 1,
            "total": 1,
            "quality_diagnostics": diagnostics,
        },
        task_id="task-1",
    )

    assert event.to_payload()["data"]["quality_diagnostics"] == diagnostics

    invalid = {**diagnostics, "low_confidence_count": 2}
    with pytest.raises(ProtocolValidationError, match="must match segments"):
        EventMessage(
            EventCode.TASK_PROGRESS,
            {
                "stage": TaskStage.TRANSCRIPTION_RUNNING.value,
                "current": 1,
                "total": 1,
                "quality_diagnostics": invalid,
            },
            task_id="task-1",
        )


def test_human_message_is_optional_and_machine_data_drives_state():
    event = completed()
    without_message = EventMessage(
        event.event,
        event.to_payload()["data"],
        task_id=event.task_id,
    )

    assert without_message.message is None
    assert without_message.event is EventCode.TASK_COMPLETED
    assert without_message.data["success_count"] == 2


def test_legacy_cli_jsonl_shape_remains_unchanged_and_is_not_desktop_ipc():
    payload = progress_event_payload(
        ProgressEvent(
            "file_started",
            "开始处理",
            current=1,
            total=2,
            preset_id="cn",
            input_path="input.wav",
        )
    )

    assert payload == {
        "type": "progress",
        "stage": "file_started",
        "message": "开始处理",
        "current": 1,
        "total": 2,
        "preset_id": "cn",
        "input_path": str(Path("input.wav")),
    }
    with pytest.raises(ProtocolValidationError) as captured:
        parse_protocol_line(json.dumps(payload, ensure_ascii=False))
    assert captured.value.code is ErrorCode.PROTOCOL_INVALID_MESSAGE


def test_message_type_values_are_explicit_and_stable():
    assert [item.value for item in MessageType] == ["command", "event", "error"]
