//! Validate public inference options against the generated v1 definition.
//! This deliberately handles only the schema keywords used by ParameterOverrides.

use serde_json::Value;
use std::sync::LazyLock;

static PARAMETERS: LazyLock<Value> = LazyLock::new(|| {
    let schema: Value = serde_json::from_str(include_str!(
        "../../../../../contracts/desktop_ipc/v1/desktop_ipc.schema.json"
    ))
    .expect("embedded IPC schema must be valid JSON");
    schema["$defs"]["ParameterOverrides"]["properties"].clone()
});

pub(super) fn valid_parameter(name: &str, value: &Value) -> bool {
    let Some(rule) = PARAMETERS.get(name) else {
        return false;
    };
    if !matches_rule(value, rule) {
        return false;
    }
    if name == "temperature"
        && let Some(items) = value.as_array()
    {
        return items
            .windows(2)
            .all(|pair| pair[0].as_f64() < pair[1].as_f64());
    }
    if let Some(text) = value.as_str() {
        return text.chars().all(|c| c >= ' ' || matches!(c, '\n' | '\t'))
            && (matches!(name, "prepend_punctuations" | "append_punctuations")
                || !text.trim().is_empty());
    }
    true
}

fn matches_rule(value: &Value, rule: &Value) -> bool {
    if let Some(choices) = rule.get("anyOf").or_else(|| rule.get("oneOf")) {
        return choices
            .as_array()
            .is_some_and(|items| items.iter().any(|item| matches_rule(value, item)));
    }
    if let Some(choices) = rule.get("enum")
        && !choices
            .as_array()
            .is_some_and(|items| items.contains(value))
    {
        return false;
    }
    match rule["type"].as_str() {
        Some("null") => value.is_null(),
        Some("boolean") => value.is_boolean(),
        Some("string") => value.as_str().is_some_and(|text| {
            let count = text.chars().count() as u64;
            rule["minLength"].as_u64().is_none_or(|min| count >= min)
                && rule["maxLength"].as_u64().is_none_or(|max| count <= max)
        }),
        Some("number" | "integer") => value.as_f64().is_some_and(|number| {
            number.is_finite()
                && (rule["type"] != "integer" || value.is_i64() || value.is_u64())
                && rule["minimum"].as_f64().is_none_or(|min| number >= min)
                && rule["maximum"].as_f64().is_none_or(|max| number <= max)
        }),
        Some("array") => value.as_array().is_some_and(|items| {
            let count = items.len() as u64;
            rule["minItems"].as_u64().is_none_or(|min| count >= min)
                && rule["maxItems"].as_u64().is_none_or(|max| count <= max)
                && items.iter().all(|item| matches_rule(item, &rule["items"]))
        }),
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn accepts_public_options_and_rejects_invalid_values() {
        for (name, value) in [
            ("language", json!(null)),
            ("language", json!("yue")),
            ("temperature", json!([0.0, 0.2, 0.6])),
            ("vad_threshold", json!(0.65)),
            ("prefix", json!(null)),
            ("suppress_tokens", json!([-1, 25])),
            ("prepend_punctuations", json!("")),
            ("max_new_tokens", json!(400)),
        ] {
            assert!(valid_parameter(name, &value), "{name}");
        }
        for (name, value) in [
            ("language", json!("invalid")),
            ("beam_size", json!(1.5)),
            ("temperature", json!([0.8, 0.2])),
            ("temperature", json!([])),
            ("vad_filter", json!(1)),
            ("max_new_tokens", json!(449)),
            ("hotwords", json!(" \n")),
            ("prefix", json!("bad\u{0000}")),
            ("suppress_tokens", json!([51865])),
            ("device", json!("cuda")),
        ] {
            assert!(!valid_parameter(name, &value), "{name}");
        }
    }
}
