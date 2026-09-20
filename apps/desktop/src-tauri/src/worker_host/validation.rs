//! Validation for desktop transcription start drafts.

use serde_json::{Map, Value};

use super::model_catalog::{
    SECONDARY_RECOGNITION_MODEL_IDS, SUPPORTED_MODEL_IDS, TRANSLATION_MODEL_IDS,
};
use super::{HostError, StartDraft};
use crate::protocol::valid_identifier;

pub(super) fn validate_start_draft(draft: &StartDraft) -> Result<(), HostError> {
    if !valid_identifier(&draft.request_id) {
        return Err(HostError::new("request.invalid", "request_id is invalid"));
    }
    if draft.inputs.is_empty() {
        return Err(HostError::new(
            "request.invalid",
            "at least one input is required",
        ));
    }
    if !SUPPORTED_MODEL_IDS.contains(&draft.model_id.as_str()) {
        return Err(HostError::new("request.invalid", "model_id is unsupported"));
    }
    if !matches!(
        draft.recognition_strategy.as_str(),
        "stable_primary" | "mixed_zh_en" | "zh_detail_review"
    ) || (draft.recognition_strategy != "stable_primary"
        && (!matches!(draft.base_preset_id.as_str(), "cn" | "cn2")
            || !SECONDARY_RECOGNITION_MODEL_IDS.contains(&draft.model_id.as_str())))
    {
        return Err(HostError::new(
            "request.invalid",
            "recognition_strategy is unsupported for the selected preset",
        ));
    }
    if draft
        .finish_action
        .as_deref()
        .is_some_and(|action| action != "shutdown")
    {
        return Err(HostError::new(
            "request.invalid",
            "finish_action is unsupported",
        ));
    }
    for input in &draft.inputs {
        if input.path.trim().is_empty()
            || !matches!(input.kind.as_str(), "file" | "directory")
            || !matches!(
                input.origin.as_str(),
                "dialog" | "drop" | "paste" | "manual"
            )
        {
            return Err(HostError::new("request.invalid", "input source is invalid"));
        }
    }
    if !matches!(
        draft.base_preset_id.as_str(),
        "cn" | "cn2" | "en_v1" | "en_v2"
    ) {
        return Err(HostError::new("request.invalid", "base preset is invalid"));
    }
    validate_overrides(&draft.overrides, &draft.base_preset_id, &draft.model_id)?;
    if draft
        .execution
        .as_ref()
        .is_some_and(|execution| !super::option_validation::valid_execution(execution))
    {
        return Err(HostError::new(
            "request.invalid",
            "execution settings are invalid",
        ));
    }
    let output = &draft.output;
    if !matches!(output.mode.as_str(), "compatibility" | "custom")
        || !matches!(
            output.conflict_policy.as_str(),
            "fail" | "overwrite" | "auto_rename" | "skip"
        )
        || (!output.txt_enabled && !output.markdown_enabled && !output.srt_enabled)
    {
        return Err(HostError::new(
            "request.invalid",
            "output policy is invalid",
        ));
    }
    let subtitle = &output.subtitle;
    if !(8..=84).contains(&subtitle.max_characters_per_line)
        || !(1..=3).contains(&subtitle.max_lines_per_cue)
        || !(250..=5000).contains(&subtitle.min_cue_duration_ms)
        || !(1000..=15000).contains(&subtitle.max_cue_duration_ms)
        || subtitle.min_cue_duration_ms > subtitle.max_cue_duration_ms
        || !subtitle.max_characters_per_second.is_finite()
        || !(5.0..=40.0).contains(&subtitle.max_characters_per_second)
        || !(0..=1000).contains(&subtitle.cue_gap_ms)
    {
        return Err(HostError::new(
            "request.invalid",
            "subtitle parameters are invalid",
        ));
    }
    if output.mode == "custom"
        && output
            .root_directory
            .as_deref()
            .is_none_or(|value| value.trim().is_empty())
    {
        return Err(HostError::new(
            "request.invalid",
            "custom output requires an output root directory",
        ));
    }
    Ok(())
}

fn validate_overrides(
    overrides: &Map<String, Value>,
    base_preset_id: &str,
    model_id: &str,
) -> Result<(), HostError> {
    for (name, value) in overrides {
        let valid = match name.as_str() {
            "task" => value.as_str().is_some_and(|task| {
                task == "transcribe"
                    || (task == "translate"
                        && TRANSLATION_MODEL_IDS.contains(&model_id)
                        && matches!(base_preset_id, "en_v1" | "en_v2"))
            }),
            _ => super::option_validation::valid_parameter(name, value),
        };
        if !valid {
            return Err(HostError::new(
                "request.invalid",
                format!("invalid parameter override: {name}"),
            ));
        }
    }
    Ok(())
}
