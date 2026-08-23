use serde_json::{Map, Value};

use crate::protocol::{
    ProtocolError, exact_fields, invalid, require_allowed_string, require_nonempty_string,
    require_nonnegative_integer, require_nonnegative_number, require_object,
};

const QUALITY_DIAGNOSTIC_REASONS: &[&str] = &[
    "fallback_temperature",
    "low_log_probability",
    "high_compression_ratio",
    "silence_conflict",
];

pub(crate) fn validate_quality_diagnostics(value: &Value) -> Result<(), ProtocolError> {
    let diagnostics = require_object(value, "task.progress quality_diagnostics")?;
    exact_fields(
        diagnostics,
        &[
            "detected_language",
            "language_probability",
            "segment_count",
            "fallback_segment_count",
            "max_temperature",
            "low_confidence_count",
            "segments",
        ],
        &[
            "recognition_strategy",
            "language_regions",
            "secondary_pass_count",
            "replaced_region_count",
            "review_region_count",
            "rejected_region_count",
            "detail_candidates",
            "hotword_audit",
        ],
        "task.progress quality_diagnostics",
    )?;
    if diagnostics.contains_key("recognition_strategy") {
        require_allowed_string(
            diagnostics,
            "recognition_strategy",
            &["stable_primary", "mixed_zh_en", "zh_detail_review"],
        )?;
    }
    if let Some(language) = diagnostics.get("detected_language")
        && !language.is_null()
        && language.as_str().is_none_or(str::is_empty)
    {
        return Err(invalid(
            "quality_diagnostics detected_language must be null or non-empty",
        ));
    }
    validate_nullable_bounded_number(diagnostics, "language_probability", Some(0.0), Some(1.0))?;
    for name in [
        "segment_count",
        "fallback_segment_count",
        "low_confidence_count",
    ] {
        require_nonnegative_integer(diagnostics, name)?;
    }
    validate_nullable_bounded_number(diagnostics, "max_temperature", Some(0.0), Some(1.0))?;
    let segments = diagnostics
        .get("segments")
        .and_then(Value::as_array)
        .ok_or_else(|| invalid("quality_diagnostics segments must be an array"))?;
    for segment in segments {
        let segment = require_object(segment, "quality_diagnostics segment")?;
        exact_fields(
            segment,
            &[
                "index",
                "start",
                "end",
                "text",
                "temperature",
                "avg_logprob",
                "compression_ratio",
                "no_speech_prob",
                "reasons",
            ],
            &[],
            "quality_diagnostics segment",
        )?;
        require_nonnegative_integer(segment, "index")?;
        let text = segment
            .get("text")
            .and_then(Value::as_str)
            .ok_or_else(|| invalid("quality_diagnostics segment text must be a string"))?;
        if text.chars().count() > 160 {
            return Err(invalid(
                "quality_diagnostics segment text must contain at most 160 characters",
            ));
        }
        let start = validate_nullable_bounded_number(segment, "start", Some(0.0), None)?;
        let end = validate_nullable_bounded_number(segment, "end", Some(0.0), None)?;
        validate_nullable_bounded_number(segment, "temperature", Some(0.0), Some(1.0))?;
        validate_nullable_bounded_number(segment, "avg_logprob", None, None)?;
        validate_nullable_bounded_number(segment, "compression_ratio", Some(0.0), None)?;
        validate_nullable_bounded_number(segment, "no_speech_prob", Some(0.0), Some(1.0))?;
        if start.zip(end).is_some_and(|(start, end)| end < start) {
            return Err(invalid(
                "quality_diagnostics segment end cannot precede start",
            ));
        }
        let reasons = segment
            .get("reasons")
            .and_then(Value::as_array)
            .ok_or_else(|| invalid("quality_diagnostics segment reasons must be an array"))?;
        if reasons.is_empty()
            || reasons.iter().any(|reason| {
                reason
                    .as_str()
                    .is_none_or(|reason| !QUALITY_DIAGNOSTIC_REASONS.contains(&reason))
            })
        {
            return Err(invalid(
                "quality_diagnostics segment reasons contains unsupported values",
            ));
        }
    }
    let low_confidence_count = require_nonnegative_integer(diagnostics, "low_confidence_count")?;
    if low_confidence_count != segments.len() as u64 {
        return Err(invalid(
            "quality_diagnostics low_confidence_count must match segments",
        ));
    }
    for name in [
        "secondary_pass_count",
        "replaced_region_count",
        "review_region_count",
        "rejected_region_count",
    ] {
        if diagnostics.contains_key(name) {
            require_nonnegative_integer(diagnostics, name)?;
        }
    }
    if let Some(regions) = diagnostics.get("language_regions") {
        validate_language_regions(regions)?;
    }
    if let Some(candidates) = diagnostics.get("detail_candidates") {
        validate_detail_candidates(candidates)?;
    }
    if let Some(audit) = diagnostics.get("hotword_audit") {
        validate_hotword_audit(audit)?;
    }
    Ok(())
}

fn validate_language_regions(value: &Value) -> Result<(), ProtocolError> {
    let regions = value
        .as_array()
        .ok_or_else(|| invalid("quality_diagnostics language_regions must be an array"))?;
    for region in regions {
        let region = require_object(region, "quality_diagnostics language region")?;
        exact_fields(
            region,
            &[
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
            ],
            &[],
            "quality_diagnostics language region",
        )?;
        let start = require_nonnegative_number(region, "start")?;
        let end = require_nonnegative_number(region, "end")?;
        if end <= start {
            return Err(invalid(
                "quality_diagnostics language region end must be after start",
            ));
        }
        require_nonempty_string(region, "top_language")?;
        for name in [
            "top_probability",
            "english_probability",
            "chinese_probability",
        ] {
            let number = require_nonnegative_number(region, name)?;
            if number > 1.0 {
                return Err(invalid(format!(
                    "quality_diagnostics language region {name} must not exceed 1"
                )));
            }
        }
        for name in ["primary_text", "candidate_text"] {
            let text = region
                .get(name)
                .and_then(Value::as_str)
                .ok_or_else(|| invalid(format!("{name} must be a string")))?;
            if text.chars().count() > 160 {
                return Err(invalid(format!(
                    "quality_diagnostics language region {name} must contain at most 160 characters"
                )));
            }
        }
        require_allowed_string(
            region,
            "decision",
            &["primary", "replaced", "review", "rejected"],
        )?;
        if region
            .get("reason")
            .is_none_or(|value| !value.is_null() && value.as_str().is_none_or(str::is_empty))
        {
            return Err(invalid(
                "quality_diagnostics language region reason must be null or non-empty",
            ));
        }
    }
    Ok(())
}

fn validate_detail_candidates(value: &Value) -> Result<(), ProtocolError> {
    let candidates = value
        .as_array()
        .ok_or_else(|| invalid("quality_diagnostics detail_candidates must be an array"))?;
    for candidate in candidates {
        let candidate = require_object(candidate, "quality_diagnostics detail candidate")?;
        exact_fields(
            candidate,
            &[
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
            ],
            &[],
            "quality_diagnostics detail candidate",
        )?;
        let start = require_nonnegative_number(candidate, "start")?;
        let end = require_nonnegative_number(candidate, "end")?;
        if end <= start {
            return Err(invalid(
                "quality_diagnostics detail candidate end must be after start",
            ));
        }
        let chinese_probability = require_nonnegative_number(candidate, "chinese_probability")?;
        if chinese_probability > 1.0 {
            return Err(invalid(
                "quality_diagnostics detail candidate chinese_probability must not exceed 1",
            ));
        }
        for name in ["primary_text", "candidate_text"] {
            let text = candidate
                .get(name)
                .and_then(Value::as_str)
                .ok_or_else(|| invalid(format!("{name} must be a string")))?;
            if text.chars().count() > 160 {
                return Err(invalid(format!(
                    "quality_diagnostics detail candidate {name} must contain at most 160 characters"
                )));
            }
        }
        require_allowed_string(
            candidate,
            "decision",
            &["unchanged", "replaced", "review", "rejected"],
        )?;
        if candidate
            .get("reason")
            .is_none_or(|value| !value.is_null() && value.as_str().is_none_or(str::is_empty))
        {
            return Err(invalid(
                "quality_diagnostics detail candidate reason must be null or non-empty",
            ));
        }
        for name in ["primary_word_probability", "candidate_word_probability"] {
            validate_nullable_bounded_number(candidate, name, Some(0.0), Some(1.0))?;
        }
        for name in ["primary_log_probability", "candidate_log_probability"] {
            validate_nullable_bounded_number(candidate, name, None, None)?;
        }
        let recovered = candidate
            .get("recovered_hotwords")
            .and_then(Value::as_array)
            .ok_or_else(|| {
                invalid("quality_diagnostics detail candidate recovered_hotwords must be an array")
            })?;
        if recovered.len() > 20
            || recovered
                .iter()
                .any(|term| term.as_str().is_none_or(str::is_empty))
        {
            return Err(invalid(
                "quality_diagnostics detail candidate recovered_hotwords must contain at most 20 non-empty terms",
            ));
        }
    }
    Ok(())
}

fn validate_hotword_audit(value: &Value) -> Result<(), ProtocolError> {
    let audit = require_object(value, "quality_diagnostics hotword_audit")?;
    exact_fields(
        audit,
        &[
            "term_count",
            "matched_count",
            "missing_count",
            "matched_terms",
            "missing_terms",
            "omitted_term_count",
        ],
        &[],
        "quality_diagnostics hotword_audit",
    )?;
    for name in [
        "term_count",
        "matched_count",
        "missing_count",
        "omitted_term_count",
    ] {
        require_nonnegative_integer(audit, name)?;
    }
    for name in ["matched_terms", "missing_terms"] {
        let terms = audit
            .get(name)
            .and_then(Value::as_array)
            .ok_or_else(|| invalid(format!("quality_diagnostics {name} must be an array")))?;
        if terms.len() > 20
            || terms
                .iter()
                .any(|term| term.as_str().is_none_or(str::is_empty))
        {
            return Err(invalid(format!(
                "quality_diagnostics {name} must contain at most 20 non-empty terms"
            )));
        }
    }
    Ok(())
}

fn validate_nullable_bounded_number(
    value: &Map<String, Value>,
    name: &str,
    minimum: Option<f64>,
    maximum: Option<f64>,
) -> Result<Option<f64>, ProtocolError> {
    let Some(item) = value.get(name) else {
        return Err(invalid(format!("{name} is required")));
    };
    if item.is_null() {
        return Ok(None);
    }
    let number = item
        .as_f64()
        .filter(|number| number.is_finite())
        .ok_or_else(|| invalid(format!("{name} must be null or a finite number")))?;
    if minimum.is_some_and(|minimum| number < minimum)
        || maximum.is_some_and(|maximum| number > maximum)
    {
        return Err(invalid(format!("{name} is outside its supported range")));
    }
    Ok(Some(number))
}
