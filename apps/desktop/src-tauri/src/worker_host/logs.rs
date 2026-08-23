//! Worker event log formatting kept outside process supervision.

use std::path::Path;

use serde_json::Value;

use crate::protocol::event_code;

use super::model_catalog::DEFAULT_MODEL_ID;

pub(super) fn worker_log_summary(message: &Value) -> Option<String> {
    if message.get("type").and_then(Value::as_str) == Some("error") {
        let code = message
            .get("code")
            .and_then(Value::as_str)
            .unwrap_or("worker.error");
        let detail = message
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("Worker command failed");
        return Some(format!("[ERROR] {code} · {detail}"));
    }

    let event = event_code(message)?;
    let data = message.get("data")?;
    let task = message
        .get("task_id")
        .and_then(Value::as_str)
        .map(short_task_id);
    let envelope_message = message.get("message").and_then(Value::as_str);
    match event {
        "worker.ready" => Some(format!(
            "[WORKER] ready · PID {}",
            data.get("pid").and_then(Value::as_u64).unwrap_or_default()
        )),
        "model.loading" => Some(format!(
            "[MODEL] loading · {}",
            data.get("model_id")
                .and_then(Value::as_str)
                .unwrap_or("unknown")
        )),
        "model.ready" => Some(format!(
            "[MODEL] ready · {} · {} / {}",
            data.get("model_id")
                .and_then(Value::as_str)
                .unwrap_or("unknown"),
            data.get("device")
                .and_then(Value::as_str)
                .unwrap_or("unknown"),
            data.get("compute_type")
                .and_then(Value::as_str)
                .unwrap_or("unknown")
        )),
        "task.queued" => Some(format!(
            "[TASK {}] queued · {} 个媒体 · {} · {}",
            task.unwrap_or("unknown"),
            data.get("input_count")
                .and_then(Value::as_u64)
                .unwrap_or_default(),
            data.get("model_id")
                .and_then(Value::as_str)
                .unwrap_or(DEFAULT_MODEL_ID),
            recognition_strategy_label(
                data.get("recognition_strategy")
                    .and_then(Value::as_str)
                    .unwrap_or("stable_primary")
            )
        )),
        "task.progress" => {
            let stage = data
                .get("stage")
                .and_then(Value::as_str)
                .unwrap_or("unknown");
            if stage == "transcription.running"
                && data
                    .get("media_progress_percent")
                    .and_then(Value::as_f64)
                    .is_some_and(|percent| percent > 0.0)
            {
                return None;
            }
            let current = data
                .get("current")
                .and_then(Value::as_u64)
                .unwrap_or_default();
            let total = data
                .get("total")
                .and_then(Value::as_u64)
                .unwrap_or_default();
            let input = data
                .get("input_path")
                .and_then(Value::as_str)
                .and_then(|value| Path::new(value).file_name())
                .and_then(|value| value.to_str())
                .map(|value| format!(" · {value}"))
                .unwrap_or_default();
            let detail = envelope_message
                .map(|value| format!(" · {value}"))
                .unwrap_or_default();
            Some(format!(
                "[TASK {}] progress · {stage} · {current}/{total}{input}{detail}",
                task.unwrap_or("unknown")
            ))
        }
        "task.completed" => Some(format!(
            "[TASK {}] completed · 成功 {} / 失败 {} · {} 个输出",
            task.unwrap_or("unknown"),
            data.get("success_count")
                .and_then(Value::as_u64)
                .unwrap_or_default(),
            data.get("failure_count")
                .and_then(Value::as_u64)
                .unwrap_or_default(),
            data.get("outputs")
                .and_then(Value::as_array)
                .map_or(0, Vec::len)
        )),
        "task.failed" => Some(format!(
            "[TASK {}] failed · {} · {}",
            task.unwrap_or("unknown"),
            data.get("error_code")
                .and_then(Value::as_str)
                .unwrap_or("transcription.failed"),
            envelope_message.unwrap_or("Worker task failed")
        )),
        "task.cancelled" => Some(format!(
            "[TASK {}] cancelled · {}",
            task.unwrap_or("unknown"),
            data.get("reason")
                .and_then(Value::as_str)
                .unwrap_or("unknown")
        )),
        "command.completed" => None,
        _ => None,
    }
}

pub(super) fn worker_quality_diagnostic_log_lines(message: &Value) -> Vec<String> {
    if event_code(message) != Some("task.progress") {
        return Vec::new();
    }
    let Some(diagnostics) = message
        .get("data")
        .and_then(|data| data.get("quality_diagnostics"))
    else {
        return Vec::new();
    };
    let task = message
        .get("task_id")
        .and_then(Value::as_str)
        .map(short_task_id)
        .unwrap_or("unknown");
    let language = diagnostics
        .get("detected_language")
        .and_then(Value::as_str)
        .unwrap_or("unknown");
    let probability = diagnostics
        .get("language_probability")
        .and_then(Value::as_f64)
        .map(|value| format!("{value:.3}"))
        .unwrap_or_else(|| "unknown".to_owned());
    let segment_count = diagnostics
        .get("segment_count")
        .and_then(Value::as_u64)
        .unwrap_or_default();
    let fallback_count = diagnostics
        .get("fallback_segment_count")
        .and_then(Value::as_u64)
        .unwrap_or_default();
    let low_confidence_count = diagnostics
        .get("low_confidence_count")
        .and_then(Value::as_u64)
        .unwrap_or_default();
    let strategy = recognition_strategy_label(
        diagnostics
            .get("recognition_strategy")
            .and_then(Value::as_str)
            .unwrap_or("stable_primary"),
    );
    let mut lines = vec![format!(
        "[TASK {task}] quality · {strategy} · language {language} ({probability}) · \
         {segment_count} 段 · 温度回退 {fallback_count} · 需复核 {low_confidence_count}"
    )];
    if let Some(segments) = diagnostics.get("segments").and_then(Value::as_array) {
        for segment in segments {
            let start = segment
                .get("start")
                .and_then(Value::as_f64)
                .map(|value| format!("{value:.2}"))
                .unwrap_or_else(|| "?".to_owned());
            let end = segment
                .get("end")
                .and_then(Value::as_f64)
                .map(|value| format!("{value:.2}"))
                .unwrap_or_else(|| "?".to_owned());
            let temperature = segment
                .get("temperature")
                .and_then(Value::as_f64)
                .map(|value| format!("{value:.1}"))
                .unwrap_or_else(|| "?".to_owned());
            let log_probability = segment
                .get("avg_logprob")
                .and_then(Value::as_f64)
                .map(|value| format!("{value:.3}"))
                .unwrap_or_else(|| "?".to_owned());
            let compression = segment
                .get("compression_ratio")
                .and_then(Value::as_f64)
                .map(|value| format!("{value:.3}"))
                .unwrap_or_else(|| "?".to_owned());
            let no_speech = segment
                .get("no_speech_prob")
                .and_then(Value::as_f64)
                .map(|value| format!("{value:.3}"))
                .unwrap_or_else(|| "?".to_owned());
            let reasons = segment
                .get("reasons")
                .and_then(Value::as_array)
                .map(|items| {
                    items
                        .iter()
                        .filter_map(Value::as_str)
                        .collect::<Vec<_>>()
                        .join(",")
                })
                .unwrap_or_default();
            let text = segment.get("text").and_then(Value::as_str).unwrap_or("");
            lines.push(format!(
                "[TASK {task}] quality detail · {start}-{end}s · t={temperature} · \
                 logprob={log_probability} · compression={compression} · \
                 no-speech={no_speech} · {reasons} · {text}"
            ));
        }
    }
    if let Some(regions) = diagnostics
        .get("language_regions")
        .and_then(Value::as_array)
    {
        for region in regions {
            let start = region
                .get("start")
                .and_then(Value::as_f64)
                .map(|value| format!("{value:.2}"))
                .unwrap_or_else(|| "?".to_owned());
            let end = region
                .get("end")
                .and_then(Value::as_f64)
                .map(|value| format!("{value:.2}"))
                .unwrap_or_else(|| "?".to_owned());
            let zh = region
                .get("chinese_probability")
                .and_then(Value::as_f64)
                .map(|value| format!("{value:.3}"))
                .unwrap_or_else(|| "?".to_owned());
            let en = region
                .get("english_probability")
                .and_then(Value::as_f64)
                .map(|value| format!("{value:.3}"))
                .unwrap_or_else(|| "?".to_owned());
            let result = region
                .get("decision")
                .and_then(Value::as_str)
                .unwrap_or("candidate_rejected");
            let primary = region
                .get("primary_text")
                .and_then(Value::as_str)
                .unwrap_or("");
            let candidate = region
                .get("candidate_text")
                .and_then(Value::as_str)
                .unwrap_or("");
            lines.push(format!(
                "[TASK {task}] language region · {start}-{end}s · zh={zh} en={en} · {result} · \
                 first={primary} · second={candidate}"
            ));
        }
    }
    if let Some(candidates) = diagnostics
        .get("detail_candidates")
        .and_then(Value::as_array)
    {
        for candidate in candidates {
            let start = candidate
                .get("start")
                .and_then(Value::as_f64)
                .map(|value| format!("{value:.2}"))
                .unwrap_or_else(|| "?".to_owned());
            let end = candidate
                .get("end")
                .and_then(Value::as_f64)
                .map(|value| format!("{value:.2}"))
                .unwrap_or_else(|| "?".to_owned());
            let result = candidate
                .get("decision")
                .and_then(Value::as_str)
                .unwrap_or("rejected");
            let reason = candidate
                .get("reason")
                .and_then(Value::as_str)
                .unwrap_or("-");
            let primary_word = candidate
                .get("primary_word_probability")
                .and_then(Value::as_f64)
                .map(|value| format!("{value:.3}"))
                .unwrap_or_else(|| "?".to_owned());
            let candidate_word = candidate
                .get("candidate_word_probability")
                .and_then(Value::as_f64)
                .map(|value| format!("{value:.3}"))
                .unwrap_or_else(|| "?".to_owned());
            let primary_log = candidate
                .get("primary_log_probability")
                .and_then(Value::as_f64)
                .map(|value| format!("{value:.3}"))
                .unwrap_or_else(|| "?".to_owned());
            let candidate_log = candidate
                .get("candidate_log_probability")
                .and_then(Value::as_f64)
                .map(|value| format!("{value:.3}"))
                .unwrap_or_else(|| "?".to_owned());
            let recovered = candidate
                .get("recovered_hotwords")
                .and_then(Value::as_array)
                .map(|items| {
                    items
                        .iter()
                        .filter_map(Value::as_str)
                        .collect::<Vec<_>>()
                        .join(", ")
                })
                .unwrap_or_default();
            let primary = candidate
                .get("primary_text")
                .and_then(Value::as_str)
                .unwrap_or("");
            let second = candidate
                .get("candidate_text")
                .and_then(Value::as_str)
                .unwrap_or("");
            lines.push(format!(
                "[TASK {task}] Chinese detail candidate · {start}-{end}s · {result} · {reason} · \
                 word-prob {primary_word}->{candidate_word} · logprob {primary_log}->{candidate_log} · \
                 recovered [{recovered}] · first={primary} · second={second}"
            ));
        }
    }
    if let Some(audit) = diagnostics.get("hotword_audit") {
        let total = audit
            .get("term_count")
            .and_then(Value::as_u64)
            .unwrap_or_default();
        let matched = audit
            .get("matched_terms")
            .and_then(Value::as_array)
            .map(|items| {
                items
                    .iter()
                    .filter_map(Value::as_str)
                    .collect::<Vec<_>>()
                    .join(", ")
            })
            .unwrap_or_default();
        let missing = audit
            .get("missing_terms")
            .and_then(Value::as_array)
            .map(|items| {
                items
                    .iter()
                    .filter_map(Value::as_str)
                    .collect::<Vec<_>>()
                    .join(", ")
            })
            .unwrap_or_default();
        lines.push(format!(
            "[TASK {task}] hotwords · total {total} · matched [{matched}] · missing [{missing}]"
        ));
    }
    lines
}

pub(super) fn recognition_strategy_label(value: &str) -> &'static str {
    match value {
        "mixed_zh_en" => "复杂中英混合",
        "zh_detail_review" => "中文细节增强",
        _ => "稳定主语言",
    }
}

pub(super) fn short_task_id(value: &str) -> &str {
    value.get(value.len().saturating_sub(8)..).unwrap_or(value)
}
