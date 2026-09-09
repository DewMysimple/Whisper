//! Validation for desktop transcription start drafts.

use serde_json::{Map, Value};

use super::model_catalog::{
    SECONDARY_RECOGNITION_MODEL_IDS, SUPPORTED_MODEL_IDS, TRANSLATION_MODEL_IDS,
};
use super::{BridgeHardwarePreference, HostError, StartDraft};
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
    if let Some(hardware) = draft.hardware.as_ref() {
        validate_hardware_preference(hardware)?;
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
            "beam_size" | "best_of" => value.as_i64().is_some_and(|item| (1..=20).contains(&item)),
            "patience" => number_in_range(value, 0.0, 5.0),
            "length_penalty" => number_in_range(value, 0.0, 2.0),
            "temperature" | "no_speech_threshold" | "prompt_reset_on_temperature" => {
                number_in_range(value, 0.0, 1.0)
            }
            "repetition_penalty" => number_in_range(value, 1.0, 2.0),
            "no_repeat_ngram_size" => value.as_i64().is_some_and(|item| (0..=10).contains(&item)),
            "compression_ratio_threshold" => number_in_range(value, 0.0, 10.0),
            "log_prob_threshold" => number_in_range(value, -10.0, 0.0),
            "condition_on_previous_text" => value.is_boolean(),
            "initial_prompt" | "hotwords" => value.as_str().is_some_and(valid_prompt_text),
            "min_silence_duration_ms" => value
                .as_i64()
                .is_some_and(|item| (0..=10_000).contains(&item)),
            _ => false,
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

fn valid_prompt_text(value: &str) -> bool {
    let normalized = value.trim();
    !normalized.is_empty()
        && normalized.chars().count() <= 4000
        && normalized
            .chars()
            .all(|character| !character.is_control() || matches!(character, '\n' | '\t'))
}

fn number_in_range(value: &Value, minimum: f64, maximum: f64) -> bool {
    value
        .as_f64()
        .is_some_and(|item| item.is_finite() && (minimum..=maximum).contains(&item))
}

pub(super) fn validate_hardware_preference(
    hardware: &BridgeHardwarePreference,
) -> Result<(), HostError> {
    if !matches!(hardware.mode.as_str(), "auto" | "cuda" | "cpu")
        || !(0..=31).contains(&hardware.gpu_device_index)
        || !matches!(
            hardware.cuda_compute_type.as_str(),
            "float16" | "int8_float16" | "float32"
        )
        || !matches!(hardware.cpu_compute_type.as_str(), "int8" | "float32")
        || !(1..=256).contains(&hardware.cpu_threads)
    {
        return Err(HostError::new(
            "request.invalid",
            "hardware preference is invalid",
        ));
    }
    Ok(())
}
