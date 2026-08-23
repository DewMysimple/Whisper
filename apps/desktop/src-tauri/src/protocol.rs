use std::collections::HashSet;

use serde_json::{Map, Value};
use thiserror::Error;

use crate::protocol_quality::validate_quality_diagnostics;

pub const SCHEMA_VERSION: u64 = 1;

pub const COMMAND_METHODS: &[&str] = &[
    "system.health",
    "system.environment",
    "system.metrics",
    "media.inspect",
    "model.load",
    "model.unload",
    "transcription.start",
    "transcription.cancel",
    "worker.shutdown",
];

pub const EVENT_CODES: &[&str] = &[
    "worker.ready",
    "command.completed",
    "model.loading",
    "model.ready",
    "task.queued",
    "task.progress",
    "task.completed",
    "task.failed",
    "task.cancelled",
];

const TASK_STAGES: &[&str] = &[
    "input.validating",
    "input.discovering",
    "model.loading",
    "transcription.running",
    "postprocess.running",
    "output.writing",
    "task.finalizing",
];

const ERROR_CODES: &[&str] = &[
    "protocol.invalid_json",
    "protocol.invalid_message",
    "protocol.unsupported_version",
    "protocol.unknown_method",
    "request.invalid",
    "task.not_found",
    "task.conflict",
    "worker.busy",
    "worker.internal",
    "environment.unavailable",
    "model.load_failed",
    "transcription.failed",
    "output.failed",
];

#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum ProtocolError {
    #[error("invalid worker JSON: {0}")]
    InvalidJson(String),
    #[error("invalid Desktop IPC v1 message: {0}")]
    InvalidMessage(String),
}

pub fn validate_worker_line(line: &str) -> Result<Value, ProtocolError> {
    let value: Value = serde_json::from_str(line)
        .map_err(|error| ProtocolError::InvalidJson(error.to_string()))?;
    validate_worker_message(&value)?;
    Ok(value)
}

pub fn validate_worker_message(value: &Value) -> Result<(), ProtocolError> {
    let message = require_object(value, "message")?;
    require_version(message)?;
    match message.get("type").and_then(Value::as_str) {
        Some("event") => validate_event(message),
        Some("error") => validate_error(message),
        Some(other) => Err(invalid(format!(
            "worker emitted unsupported type {other:?}"
        ))),
        None => Err(invalid("message.type must be a string")),
    }
}

pub fn event_code(value: &Value) -> Option<&str> {
    value.get("event").and_then(Value::as_str)
}

pub fn request_id(value: &Value) -> Option<&str> {
    value.get("request_id").and_then(Value::as_str)
}

fn validate_event(message: &Map<String, Value>) -> Result<(), ProtocolError> {
    exact_fields(
        message,
        &["schema_version", "type", "event", "data"],
        &["request_id", "task_id", "message"],
        "event",
    )?;
    validate_optional_envelope_fields(message)?;
    let event = require_allowed_string(message, "event", EVENT_CODES)?;
    let data = require_object(
        message
            .get("data")
            .ok_or_else(|| invalid("event.data is required"))?,
        "event.data",
    )?;

    match event {
        "worker.ready" => {
            exact_fields(data, &["pid", "capabilities"], &[], "worker.ready data")?;
            require_positive_integer(data, "pid")?;
            let capabilities = require_object(
                data.get("capabilities")
                    .ok_or_else(|| invalid("worker.ready capabilities are required"))?,
                "worker.ready capabilities",
            )?;
            exact_fields(capabilities, &["methods", "events"], &[], "capabilities")?;
            require_unique_allowed_array(capabilities, "methods", COMMAND_METHODS)?;
            require_unique_allowed_array(capabilities, "events", EVENT_CODES)?;
        }
        "command.completed" => {
            require_identifier_field(message, "request_id")?;
            exact_fields(data, &["method", "result"], &[], "command.completed data")?;
            require_allowed_string(data, "method", COMMAND_METHODS)?;
            require_object(
                data.get("result")
                    .ok_or_else(|| invalid("command.completed result is required"))?,
                "command.completed result",
            )?;
        }
        "model.loading" => {
            exact_fields(data, &["model_id"], &[], "model.loading data")?;
            require_nonempty_string(data, "model_id")?;
        }
        "model.ready" => {
            exact_fields(
                data,
                &["model_id", "device", "compute_type"],
                &["device_index", "cpu_threads"],
                "model.ready data",
            )?;
            require_nonempty_string(data, "model_id")?;
            require_nonempty_string(data, "device")?;
            require_nonempty_string(data, "compute_type")?;
            if data.contains_key("device_index") {
                require_nonnegative_integer(data, "device_index")?;
            }
            if data.contains_key("cpu_threads") {
                require_nonnegative_integer(data, "cpu_threads")?;
            }
        }
        "task.queued" => {
            require_identifier_field(message, "request_id")?;
            require_identifier_field(message, "task_id")?;
            exact_fields(
                data,
                &["position", "input_count", "effective_parameters"],
                &[
                    "model_id",
                    "hardware",
                    "recognition_strategy",
                    "media_paths",
                    "media_durations_seconds",
                    "skipped_media",
                ],
                "task.queued data",
            )?;
            if data.contains_key("model_id") {
                require_nonempty_string(data, "model_id")?;
            }
            if data.contains_key("recognition_strategy") {
                require_allowed_string(
                    data,
                    "recognition_strategy",
                    &["stable_primary", "mixed_zh_en", "zh_detail_review"],
                )?;
            }
            require_nonnegative_integer(data, "position")?;
            require_positive_integer(data, "input_count")?;
            if data.contains_key("media_paths") {
                require_path_array(data, "media_paths")?;
            }
            if let Some(durations) = data.get("media_durations_seconds") {
                let durations = durations
                    .as_array()
                    .ok_or_else(|| invalid("media_durations_seconds must be an array"))?;
                if durations.iter().any(|value| {
                    !value.is_null()
                        && value
                            .as_f64()
                            .is_none_or(|number| !number.is_finite() || number < 0.0)
                }) {
                    return Err(invalid(
                        "media_durations_seconds must contain nonnegative numbers or null",
                    ));
                }
                let media_paths = data
                    .get("media_paths")
                    .and_then(Value::as_array)
                    .ok_or_else(|| {
                        invalid("media_durations_seconds requires aligned media_paths")
                    })?;
                if durations.len() != media_paths.len() {
                    return Err(invalid(
                        "media_durations_seconds must align with media_paths",
                    ));
                }
            }
            if data.contains_key("skipped_media") {
                require_conflict_groups(data, "skipped_media")?;
            }
            require_object(
                data.get("effective_parameters")
                    .ok_or_else(|| invalid("effective_parameters are required"))?,
                "effective_parameters",
            )?;
            if let Some(hardware) = data.get("hardware") {
                let hardware = require_object(hardware, "task.queued hardware")?;
                exact_fields(
                    hardware,
                    &["device", "device_index", "compute_type", "cpu_threads"],
                    &[],
                    "task.queued hardware",
                )?;
                require_allowed_string(hardware, "device", &["cpu", "cuda"])?;
                require_nonnegative_integer(hardware, "device_index")?;
                require_nonempty_string(hardware, "compute_type")?;
                require_nonnegative_integer(hardware, "cpu_threads")?;
            }
        }
        "task.progress" => {
            require_identifier_field(message, "task_id")?;
            exact_fields(
                data,
                &["stage", "current", "total"],
                &[
                    "input_path",
                    "media_index",
                    "media_progress_percent",
                    "media_elapsed_seconds",
                    "task_elapsed_seconds",
                    "media_status",
                    "output_paths",
                    "quality_diagnostics",
                ],
                "task.progress data",
            )?;
            require_allowed_string(data, "stage", TASK_STAGES)?;
            let current = require_nonnegative_integer(data, "current")?;
            let total = require_nonnegative_integer(data, "total")?;
            if current > total {
                return Err(invalid("task.progress current cannot exceed total"));
            }
            if data.contains_key("input_path") {
                require_nonempty_string(data, "input_path")?;
            }
            if data.contains_key("media_index") {
                let media_index = require_positive_integer(data, "media_index")?;
                if media_index > total {
                    return Err(invalid("task.progress media_index cannot exceed total"));
                }
            }
            for name in ["media_elapsed_seconds", "task_elapsed_seconds"] {
                if data.contains_key(name) {
                    require_nonnegative_number(data, name)?;
                }
            }
            if data.contains_key("media_progress_percent") {
                let percent = require_nonnegative_number(data, "media_progress_percent")?;
                if percent > 100.0 {
                    return Err(invalid(
                        "task.progress media_progress_percent cannot exceed 100",
                    ));
                }
            }
            if let Some(status) = data.get("media_status") {
                let status = status
                    .as_str()
                    .ok_or_else(|| invalid("task.progress media_status must be a string"))?;
                if !matches!(
                    status,
                    "pending" | "running" | "completed" | "failed" | "skipped"
                ) {
                    return Err(invalid("task.progress media_status is unsupported"));
                }
            }
            if let Some(output_paths) = data.get("output_paths") {
                let output_paths = output_paths
                    .as_array()
                    .ok_or_else(|| invalid("task.progress output_paths must be an array"))?;
                if output_paths
                    .iter()
                    .any(|item| item.as_str().is_none_or(|text| text.is_empty()))
                {
                    return Err(invalid("task.progress output_paths must contain paths"));
                }
            }
            if let Some(diagnostics) = data.get("quality_diagnostics") {
                validate_quality_diagnostics(diagnostics)?;
            }
        }
        "task.completed" => {
            require_identifier_field(message, "task_id")?;
            exact_fields(
                data,
                &["success_count", "failure_count", "outputs"],
                &["skipped_media"],
                "task.completed data",
            )?;
            require_nonnegative_integer(data, "success_count")?;
            require_nonnegative_integer(data, "failure_count")?;
            let outputs = data
                .get("outputs")
                .and_then(Value::as_array)
                .ok_or_else(|| invalid("task.completed outputs must be an array"))?;
            if outputs
                .iter()
                .any(|item| item.as_str().is_none_or(|text| text.is_empty()))
            {
                return Err(invalid("task.completed outputs must contain paths"));
            }
            if data.contains_key("skipped_media") {
                require_conflict_groups(data, "skipped_media")?;
            }
        }
        "task.failed" => {
            require_identifier_field(message, "task_id")?;
            exact_fields(data, &["error_code", "details"], &[], "task.failed data")?;
            require_allowed_string(data, "error_code", ERROR_CODES)?;
            require_object(
                data.get("details")
                    .ok_or_else(|| invalid("task.failed details are required"))?,
                "task.failed details",
            )?;
        }
        "task.cancelled" => {
            require_identifier_field(message, "task_id")?;
            exact_fields(data, &["reason"], &[], "task.cancelled data")?;
            require_allowed_string(data, "reason", &["user", "shutdown", "superseded"])?;
        }
        _ => unreachable!("event code was checked against EVENT_CODES"),
    }
    Ok(())
}

fn validate_error(message: &Map<String, Value>) -> Result<(), ProtocolError> {
    exact_fields(
        message,
        &["schema_version", "type", "code", "data"],
        &["request_id", "task_id", "message"],
        "error",
    )?;
    validate_optional_envelope_fields(message)?;
    require_allowed_string(message, "code", ERROR_CODES)?;
    require_object(
        message
            .get("data")
            .ok_or_else(|| invalid("error.data is required"))?,
        "error.data",
    )?;
    Ok(())
}

fn validate_optional_envelope_fields(message: &Map<String, Value>) -> Result<(), ProtocolError> {
    for name in ["request_id", "task_id"] {
        if message.contains_key(name) {
            require_identifier_field(message, name)?;
        }
    }
    if let Some(value) = message.get("message")
        && value.as_str().is_none_or(|text| text.trim().is_empty())
    {
        return Err(invalid("message must be a non-empty string"));
    }
    Ok(())
}

fn require_version(message: &Map<String, Value>) -> Result<(), ProtocolError> {
    if message.get("schema_version").and_then(Value::as_u64) != Some(SCHEMA_VERSION) {
        return Err(invalid("schema_version must be 1"));
    }
    Ok(())
}

pub(crate) fn require_object<'a>(
    value: &'a Value,
    name: &str,
) -> Result<&'a Map<String, Value>, ProtocolError> {
    value
        .as_object()
        .ok_or_else(|| invalid(format!("{name} must be an object")))
}

pub(crate) fn exact_fields(
    value: &Map<String, Value>,
    required: &[&str],
    optional: &[&str],
    name: &str,
) -> Result<(), ProtocolError> {
    let required: HashSet<&str> = required.iter().copied().collect();
    let allowed: HashSet<&str> = required
        .iter()
        .copied()
        .chain(optional.iter().copied())
        .collect();
    let present: HashSet<&str> = value.keys().map(String::as_str).collect();
    let missing: Vec<_> = required.difference(&present).copied().collect();
    let unexpected: Vec<_> = present.difference(&allowed).copied().collect();
    if !missing.is_empty() || !unexpected.is_empty() {
        return Err(invalid(format!(
            "{name} fields are invalid; missing={missing:?}, unexpected={unexpected:?}"
        )));
    }
    Ok(())
}

fn require_identifier_field(value: &Map<String, Value>, name: &str) -> Result<(), ProtocolError> {
    let text = value
        .get(name)
        .and_then(Value::as_str)
        .ok_or_else(|| invalid(format!("{name} must be an identifier")))?;
    if !valid_identifier(text) {
        return Err(invalid(format!("{name} is not a valid identifier")));
    }
    Ok(())
}

pub fn valid_identifier(value: &str) -> bool {
    let mut characters = value.chars();
    let Some(first) = characters.next() else {
        return false;
    };
    if !first.is_ascii_alphanumeric() || value.len() > 128 {
        return false;
    }
    characters.all(|item| item.is_ascii_alphanumeric() || matches!(item, '.' | '_' | ':' | '-'))
}

pub(crate) fn require_nonempty_string(
    value: &Map<String, Value>,
    name: &str,
) -> Result<(), ProtocolError> {
    if value
        .get(name)
        .and_then(Value::as_str)
        .is_none_or(str::is_empty)
    {
        return Err(invalid(format!("{name} must be a non-empty string")));
    }
    Ok(())
}

pub(crate) fn require_allowed_string<'a>(
    value: &'a Map<String, Value>,
    name: &str,
    allowed: &[&str],
) -> Result<&'a str, ProtocolError> {
    let text = value
        .get(name)
        .and_then(Value::as_str)
        .ok_or_else(|| invalid(format!("{name} must be a string")))?;
    if !allowed.contains(&text) {
        return Err(invalid(format!(
            "{name} contains unsupported value {text:?}"
        )));
    }
    Ok(text)
}

pub(crate) fn require_nonnegative_integer(
    value: &Map<String, Value>,
    name: &str,
) -> Result<u64, ProtocolError> {
    value
        .get(name)
        .and_then(Value::as_u64)
        .ok_or_else(|| invalid(format!("{name} must be a non-negative integer")))
}

fn require_positive_integer(value: &Map<String, Value>, name: &str) -> Result<u64, ProtocolError> {
    let number = require_nonnegative_integer(value, name)?;
    if number == 0 {
        return Err(invalid(format!("{name} must be positive")));
    }
    Ok(number)
}

pub(crate) fn require_nonnegative_number(
    value: &Map<String, Value>,
    name: &str,
) -> Result<f64, ProtocolError> {
    let number = value
        .get(name)
        .and_then(Value::as_f64)
        .ok_or_else(|| invalid(format!("{name} must be a number")))?;
    if !number.is_finite() || number < 0.0 {
        return Err(invalid(format!("{name} must be non-negative")));
    }
    Ok(number)
}

fn require_path_array(value: &Map<String, Value>, name: &str) -> Result<(), ProtocolError> {
    let paths = value
        .get(name)
        .and_then(Value::as_array)
        .ok_or_else(|| invalid(format!("{name} must be an array")))?;
    if paths
        .iter()
        .any(|item| item.as_str().is_none_or(str::is_empty))
    {
        return Err(invalid(format!("{name} must contain non-empty paths")));
    }
    Ok(())
}

fn require_conflict_groups(value: &Map<String, Value>, name: &str) -> Result<(), ProtocolError> {
    let groups = value
        .get(name)
        .and_then(Value::as_array)
        .ok_or_else(|| invalid(format!("{name} must be an array")))?;
    for group in groups {
        let group = require_object(group, name)?;
        exact_fields(group, &["input_path", "paths"], &[], name)?;
        require_nonempty_string(group, "input_path")?;
        require_path_array(group, "paths")?;
    }
    Ok(())
}

fn require_unique_allowed_array(
    value: &Map<String, Value>,
    name: &str,
    allowed: &[&str],
) -> Result<(), ProtocolError> {
    let items = value
        .get(name)
        .and_then(Value::as_array)
        .ok_or_else(|| invalid(format!("{name} must be an array")))?;
    let mut unique = HashSet::new();
    for item in items {
        let text = item
            .as_str()
            .ok_or_else(|| invalid(format!("{name} must contain strings")))?;
        if !allowed.contains(&text) || !unique.insert(text) {
            return Err(invalid(format!(
                "{name} contains unsupported or duplicate values"
            )));
        }
    }
    Ok(())
}

pub(crate) fn invalid(message: impl Into<String>) -> ProtocolError {
    ProtocolError::InvalidMessage(message.into())
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{ProtocolError, valid_identifier, validate_worker_message};

    #[test]
    fn accepts_a_valid_task_progress_event() {
        let quality_diagnostics = json!({
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
            "detail_candidates": [{
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
                "recovered_hotwords": ["拟态"]
            }],
            "language_regions": [{
                "start": 25.0,
                "end": 31.5,
                "top_language": "en",
                "top_probability": 0.91,
                "english_probability": 0.91,
                "chinese_probability": 0.04,
                "primary_text": "第一遍文本",
                "candidate_text": "This is an English candidate.",
                "decision": "replaced",
                "reason": null
            }],
            "hotword_audit": {
                "term_count": 2,
                "matched_count": 1,
                "missing_count": 1,
                "matched_terms": ["Walter Lippmann"],
                "missing_terms": ["simulacra-self"],
                "omitted_term_count": 0
            },
            "segments": [{
                "index": 1,
                "start": 3.0,
                "end": 5.0,
                "text": "需要复核",
                "temperature": 0.4,
                "avg_logprob": -1.2,
                "compression_ratio": 2.5,
                "no_speech_prob": 0.1,
                "reasons": ["fallback_temperature", "low_log_probability"]
            }]
        });
        let value = json!({
            "schema_version": 1,
            "type": "event",
            "task_id": "task-1",
            "event": "task.progress",
            "data": {
                "stage": "transcription.running",
                "current": 1,
                "total": 2,
                "input_path": "C:\\Media\\one.mp4",
                "media_index": 1,
                "media_progress_percent": 42.5,
                "media_elapsed_seconds": 12.25,
                "task_elapsed_seconds": 14.0,
                "media_status": "running",
                "output_paths": [
                    "C:\\Media\\Text\\one.txt",
                    "C:\\Media\\Markdown\\one.md"
                ],
                "quality_diagnostics": quality_diagnostics
            }
        });
        assert_eq!(validate_worker_message(&value), Ok(()));
    }

    #[test]
    fn rejects_quality_diagnostics_with_mismatched_count() {
        let value = json!({
            "schema_version": 1,
            "type": "event",
            "task_id": "task-1",
            "event": "task.progress",
            "data": {
                "stage": "transcription.running",
                "current": 1,
                "total": 1,
                "quality_diagnostics": {
                    "detected_language": "zh",
                    "language_probability": 0.92,
                    "segment_count": 1,
                    "fallback_segment_count": 0,
                    "max_temperature": 0.0,
                    "low_confidence_count": 1,
                    "segments": []
                }
            }
        });
        assert!(matches!(
            validate_worker_message(&value),
            Err(ProtocolError::InvalidMessage(_))
        ));
    }

    #[test]
    fn rejects_invalid_task_progress_output_paths() {
        let value = json!({
            "schema_version": 1,
            "type": "event",
            "task_id": "task-1",
            "event": "task.progress",
            "data": {
                "stage": "output.writing",
                "current": 1,
                "total": 1,
                "output_paths": "C:\\Media\\Text\\one.txt"
            }
        });
        assert!(matches!(
            validate_worker_message(&value),
            Err(ProtocolError::InvalidMessage(_))
        ));
    }

    #[test]
    fn rejects_unknown_fields_before_forwarding() {
        let value = json!({
            "schema_version": 1,
            "type": "event",
            "task_id": "task-1",
            "event": "task.cancelled",
            "data": {"reason": "user"},
            "unexpected": true
        });
        assert!(matches!(
            validate_worker_message(&value),
            Err(ProtocolError::InvalidMessage(_))
        ));
    }

    #[test]
    fn identifier_rules_match_desktop_ipc_v1() {
        assert!(valid_identifier("desktop-1234.ab_cd:5"));
        assert!(!valid_identifier("-starts-with-symbol"));
        assert!(!valid_identifier("contains space"));
    }
}
