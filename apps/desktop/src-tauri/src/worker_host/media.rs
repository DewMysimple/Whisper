//! Input media discovery and duration-inspection merge helpers.

use std::collections::BTreeSet;
use std::io::{Error, ErrorKind};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use super::{
    HostError, InspectedInput, MEDIA_INSPECT_TIMEOUT, MediaInspectionItem, READY_TIMEOUT,
    WorkerManager, valid_identifier,
};

pub(super) type InspectionUpdate = Arc<dyn Fn(&Value) + Send + Sync>;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InputInspectionProgress {
    index: usize,
    phase: &'static str,
    item: InspectedInput,
    checked_count: usize,
}

#[derive(Debug, Deserialize)]
struct ProgressItem {
    index: usize,
    item: MediaInspectionItem,
}

const SUPPORTED_MEDIA_EXTENSIONS: &[&str] = &[
    "aac", "avi", "flv", "m4a", "m4v", "mkv", "mov", "mp3", "mp4", "mpeg", "mpg", "ogg", "wav",
    "webm", "wmv",
];

fn is_supported_media(path: &Path) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .is_some_and(|value| {
            SUPPORTED_MEDIA_EXTENSIONS.contains(&value.to_ascii_lowercase().as_str())
        })
}

fn collect_directory_media(
    path: &Path,
    media: &mut Vec<PathBuf>,
    cancelled: &AtomicBool,
) -> std::io::Result<()> {
    for entry in std::fs::read_dir(path)? {
        if cancelled.load(Ordering::Acquire) {
            return Err(Error::new(
                ErrorKind::Interrupted,
                "media inspection cancelled",
            ));
        }
        let entry = entry?;
        let file_type = entry.file_type()?;
        let path = entry.path();
        if file_type.is_dir() {
            collect_directory_media(&path, media, cancelled)?;
        } else if file_type.is_file() && is_supported_media(&path) {
            media.push(path);
        }
    }
    Ok(())
}

#[cfg(test)]
pub fn inspect_input_paths(paths: Vec<String>, origin: String) -> Vec<InspectedInput> {
    discover_input_paths(paths, origin, &AtomicBool::new(false), |_, _| {})
}

fn discover_input_paths(
    paths: Vec<String>,
    origin: String,
    cancelled: &AtomicBool,
    mut progress: impl FnMut(usize, &InspectedInput),
) -> Vec<InspectedInput> {
    let normalized_origin = if matches!(origin.as_str(), "dialog" | "drop" | "paste" | "manual") {
        origin
    } else {
        "manual".to_owned()
    };
    paths
        .into_iter()
        .enumerate()
        .take_while(|_| !cancelled.load(Ordering::Acquire))
        .map(|(index, raw)| {
            let path = strip_one_pair_of_quotes(raw.trim());
            let target = Path::new(path);
            let input = match std::fs::metadata(target) {
                Ok(metadata) if metadata.is_dir() || metadata.is_file() => {
                    let mut media_paths = Vec::new();
                    let (kind, result) = if metadata.is_dir() {
                        let result = collect_directory_media(target, &mut media_paths, cancelled)
                            .map(|()| {
                                media_paths.sort_by_cached_key(|entry| {
                                    entry.to_string_lossy().to_lowercase()
                                });
                            });
                        ("directory", result)
                    } else {
                        if is_supported_media(target) {
                            media_paths.push(target.to_path_buf());
                        }
                        ("file", Ok(()))
                    };
                    match result {
                        Ok(()) if !media_paths.is_empty() => InspectedInput {
                            path: path.to_owned(),
                            kind: kind.to_owned(),
                            origin: normalized_origin.clone(),
                            valid: true,
                            media_count: Some(media_paths.len()),
                            duration_seconds: None,
                            unknown_duration_count: Some(media_paths.len()),
                            detail: (kind == "directory")
                                .then(|| format!("递归发现 {} 个媒体文件", media_paths.len())),
                            error_code: None,
                            media_paths,
                        },
                        Ok(()) => InspectedInput {
                            path: path.to_owned(),
                            kind: kind.to_owned(),
                            origin: normalized_origin.clone(),
                            valid: false,
                            media_count: Some(0),
                            duration_seconds: None,
                            unknown_duration_count: Some(0),
                            detail: Some(
                                if kind == "directory" {
                                    "未发现支持的媒体文件"
                                } else {
                                    "不支持此媒体类型"
                                }
                                .to_owned(),
                            ),
                            error_code: Some("media.unsupported".to_owned()),
                            media_paths: Vec::new(),
                        },
                        Err(error) => InspectedInput {
                            path: path.to_owned(),
                            kind: kind.to_owned(),
                            origin: normalized_origin.clone(),
                            valid: false,
                            media_count: None,
                            duration_seconds: None,
                            unknown_duration_count: None,
                            detail: Some(format!("无法读取媒体目录: {error}")),
                            error_code: Some(discovery_error_code(&error).to_owned()),
                            media_paths: Vec::new(),
                        },
                    }
                }
                Ok(_) => InspectedInput {
                    path: path.to_owned(),
                    kind: "file".to_owned(),
                    origin: normalized_origin.clone(),
                    valid: false,
                    media_count: None,
                    duration_seconds: None,
                    unknown_duration_count: None,
                    detail: Some("输入不是文件或目录".to_owned()),
                    error_code: Some("media.unsupported".to_owned()),
                    media_paths: Vec::new(),
                },
                Err(error) => InspectedInput {
                    path: path.to_owned(),
                    kind: "file".to_owned(),
                    origin: normalized_origin.clone(),
                    valid: false,
                    media_count: None,
                    duration_seconds: None,
                    unknown_duration_count: None,
                    detail: Some(error.to_string()),
                    error_code: Some(discovery_error_code(&error).to_owned()),
                    media_paths: Vec::new(),
                },
            };
            progress(index, &input);
            input
        })
        .collect()
}

fn discovery_error_code(error: &Error) -> &'static str {
    match error.kind() {
        ErrorKind::NotFound => "media.not_found",
        ErrorKind::PermissionDenied => "media.access_denied",
        ErrorKind::Interrupted => "media.cancelled",
        _ => "media.path_unavailable",
    }
}

pub fn apply_media_inspections(
    inputs: &mut [InspectedInput],
    inspections: &[MediaInspectionItem],
) -> Result<(), HostError> {
    let expected = inputs
        .iter()
        .map(|input| input.media_paths.len())
        .sum::<usize>();
    if expected != inspections.len() {
        return Err(HostError::new(
            "host.protocol_mismatch",
            "media inspections do not align with inspected inputs",
        ));
    }
    let mut cursor = 0;
    for input in inputs {
        let count = input.media_paths.len();
        if count == 0 {
            continue;
        }
        let values = &inspections[cursor..cursor + count];
        cursor += count;
        let known = values
            .iter()
            .filter_map(|item| item.duration_seconds)
            .collect::<Vec<_>>();
        input.duration_seconds = (!known.is_empty()).then(|| known.iter().sum());
        input.unknown_duration_count = Some(count.saturating_sub(known.len()));
        if let Some(item) = values.iter().find(|item| !item.readable) {
            input.valid = false;
            apply_probe_error(input, item);
        }
    }
    Ok(())
}

fn apply_probe_error(input: &mut InspectedInput, item: &MediaInspectionItem) {
    let code = item.error_code.as_deref().unwrap_or("media.unreadable");
    input.error_code = Some(code.to_owned());
    input.detail = Some(format!(
        "{}：{}",
        match code {
            "media.no_audio" => "媒体没有音轨",
            "media.not_found" => "媒体已不存在",
            "media.access_denied" => "无法访问媒体",
            "media.path_unavailable" => "媒体路径不可用",
            "media.unsupported" => "不支持此媒体类型",
            "media.cancelled" => "媒体检查已取消",
            "media.timeout" => "媒体容器检查超时",
            "media.probe_unavailable" => "媒体探测进程不可用",
            _ => "无法读取媒体容器",
        },
        item.path,
    ));
}

fn emit_progress(
    send: &impl Fn(InputInspectionProgress),
    index: usize,
    item: &InspectedInput,
    checked_count: usize,
    finished: bool,
) {
    send(InputInspectionProgress {
        index,
        phase: if finished { "inspected" } else { "discovered" },
        item: InspectedInput {
            path: item.path.clone(),
            kind: item.kind.clone(),
            origin: item.origin.clone(),
            valid: item.valid,
            media_count: item.media_count,
            duration_seconds: item.duration_seconds,
            unknown_duration_count: item.unknown_duration_count,
            detail: item.detail.clone(),
            error_code: item.error_code.clone(),
            media_paths: Vec::new(),
        },
        checked_count,
    });
}

#[derive(Default)]
struct PartialInspection {
    checked_count: usize,
    known: usize,
    total_duration: f64,
    first_failure: Option<usize>,
}

impl PartialInspection {
    fn update(
        &mut self,
        position: usize,
        inspection: MediaInspectionItem,
        input: &mut InspectedInput,
    ) {
        self.checked_count += 1;
        if let Some(duration) = inspection.duration_seconds {
            self.known += 1;
            self.total_duration += duration;
        }
        input.unknown_duration_count = input.media_count.map(|count| count - self.known);
        input.duration_seconds = (self.known > 0).then_some(self.total_duration);
        if !inspection.readable && self.first_failure.is_none_or(|index| position < index) {
            apply_probe_error(input, &inspection);
            self.first_failure = Some(position);
            input.valid = false;
        }
    }
}

impl WorkerManager {
    pub fn inspect_import(
        &self,
        paths: Vec<String>,
        origin: String,
        import_id: Option<String>,
        send: impl Fn(InputInspectionProgress) + Send + Sync + 'static,
    ) -> Result<Vec<InspectedInput>, HostError> {
        let request_id = format!(
            "host-{}",
            self.request_sequence.fetch_add(1, Ordering::Relaxed)
        );
        let import_id = import_id.unwrap_or_else(|| request_id.clone());
        if !valid_identifier(&import_id) {
            return Err(HostError::new("request.invalid", "invalid importId"));
        }
        let cancel = Arc::new(AtomicBool::new(false));
        {
            let mut imports = self
                .pending_imports
                .lock()
                .map_err(|_| HostError::new("host.internal", "inspection lock was poisoned"))?;
            if imports.len() >= 8 || imports.contains_key(&import_id) {
                return Err(HostError::new(
                    "worker.busy",
                    "too many pending media inspections or duplicate importId",
                ));
            }
            imports.insert(import_id.clone(), Arc::clone(&cancel));
        }
        let result = self.run_import(paths, origin, &import_id, &request_id, cancel, send);
        if let Ok(mut imports) = self.pending_imports.lock() {
            imports.remove(&import_id);
        }
        result
    }

    pub fn cancel_import(&self, import_id: &str) -> bool {
        let Some(cancel) = self
            .pending_imports
            .lock()
            .ok()
            .and_then(|items| items.get(import_id).cloned())
        else {
            return false;
        };
        cancel.store(true, Ordering::Release);
        true
    }

    fn run_import(
        &self,
        paths: Vec<String>,
        origin: String,
        import_id: &str,
        request_id: &str,
        cancel: Arc<AtomicBool>,
        send: impl Fn(InputInspectionProgress) + Send + Sync + 'static,
    ) -> Result<Vec<InspectedInput>, HostError> {
        let began = Instant::now();
        let send = Arc::new(send);
        let discover = Arc::clone(&send);
        let mut inputs = discover_input_paths(paths, origin, &cancel, |index, input| {
            emit_progress(&*discover, index, input, 0, !input.valid);
        });
        let discovery_ms = began.elapsed().as_secs_f64() * 1000.0;
        let media_paths = inputs
            .iter()
            .flat_map(|input| input.media_paths.iter().cloned())
            .collect::<Vec<_>>();
        if media_paths.is_empty() || cancel.load(Ordering::Acquire) {
            let status = if cancel.load(Ordering::Acquire) {
                "cancelled"
            } else {
                "no_media"
            };
            self.push_log(format!(
                "[IMPORT {import_id}] {status} · request_id={request_id} discovery_ms={discovery_ms:.2}"
            ));
            return Ok(inputs);
        }
        let supports_progress = self.supports_progressive_inspection();
        let ipc_began = Instant::now();
        if cancel.load(Ordering::Acquire) {
            self.push_log(format!(
                "[IMPORT {import_id}] cancelled · request_id={request_id} discovery_ms={discovery_ms:.2}"
            ));
            return Ok(inputs);
        }
        if let Ok(true) = supports_progress {
            let media_input_indices = inputs
                .iter()
                .enumerate()
                .flat_map(|(index, input)| std::iter::repeat_n(index, input.media_paths.len()))
                .collect::<Vec<_>>();
            let send = Arc::clone(&send);
            let cancel = Arc::clone(&cancel);
            let progress = Mutex::new((
                inputs.clone(),
                (0..inputs.len())
                    .map(|_| PartialInspection::default())
                    .collect::<Vec<_>>(),
                BTreeSet::new(),
            ));
            let update: InspectionUpdate = Arc::new(move |data| {
                if cancel.load(Ordering::Acquire) {
                    return;
                }
                let Ok(items) = serde_json::from_value::<Vec<ProgressItem>>(data["items"].clone())
                else {
                    return;
                };
                let Ok(mut state) = progress.lock() else {
                    return;
                };
                let (inputs, counts, seen) = &mut *state;
                let mut updated = BTreeSet::new();
                for progress in items {
                    if let Some(&index) = media_input_indices.get(progress.index)
                        && seen.insert(progress.index)
                    {
                        counts[index].update(progress.index, progress.item, &mut inputs[index]);
                        updated.insert(index);
                    }
                }
                for index in updated {
                    let checked = counts[index].checked_count;
                    emit_progress(
                        &*send,
                        index,
                        &inputs[index],
                        checked,
                        Some(checked) == inputs[index].media_count,
                    );
                }
            });
            self.inspection_updates
                .lock()
                .map_err(|_| {
                    HostError::new("host.internal", "inspection progress lock was poisoned")
                })?
                .insert(request_id.to_owned(), update);
        }
        let response = supports_progress.and_then(|progressive| {
            let mut params = json!({"paths": media_paths});
            if progressive {
                params["progressive"] = Value::Bool(true);
            }
            self.send_command_waiting(
                request_id,
                "media.inspect",
                params,
                MEDIA_INSPECT_TIMEOUT,
                progressive.then_some(&*cancel),
            )
        });
        if let Ok(mut updates) = self.inspection_updates.lock() {
            updates.remove(request_id);
        }
        let ipc_ms = ipc_began.elapsed().as_secs_f64() * 1000.0;
        let total_ms = began.elapsed().as_secs_f64() * 1000.0;
        let report = response.and_then(|envelope| {
            let data = &envelope["data"]["result"];
            let items: Vec<MediaInspectionItem> = serde_json::from_value(data["items"].clone()).map_err(|error| {
                HostError::new("host.protocol_mismatch", format!("media.inspect returned invalid items: {error}"))
            })?;
            apply_media_inspections(&mut inputs, &items)?;
            let hits = items.iter().filter(|item| item.cache_hit == Some(true)).count();
            let errors = items.iter().filter(|item| !item.readable).count();
            let slowest = items.iter().filter_map(|item| item.elapsed_ms).fold(0.0_f64, f64::max);
            let latest_start = items.iter().filter_map(|item| item.queue_ms).fold(0.0_f64, f64::max);
            let worker_wait = data["worker_wait_ms"].as_f64();
            let worker_elapsed = data["worker_elapsed_ms"].as_f64();
            self.push_log(format!(
                "[IMPORT {import_id}] {} · request_id={request_id} files={} hits={hits} errors={errors} discovery_ms={discovery_ms:.2} ipc_ms={ipc_ms:.2} total_ms={total_ms:.2} worker_wait_ms={worker_wait:?} worker_elapsed_ms={worker_elapsed:?} max_probe_ms={slowest:.2} max_probe_queue_ms={latest_start:.2}",
                if cancel.load(Ordering::Acquire) { "cancelled" } else { "complete" },
                items.len(),
            ));
            Ok(())
        });
        if let Err(error) = report {
            self.push_log(format!(
                "[IMPORT {import_id}] {} · request_id={request_id} discovery_ms={discovery_ms:.2} ipc_ms={ipc_ms:.2} total_ms={total_ms:.2}",
                error.code,
            ));
            for input in &mut inputs {
                if input.valid {
                    input.valid = false;
                    input.error_code = Some(error.code.clone());
                    input.detail = Some(match error.code.as_str() {
                        "host.worker_not_ready" => "Worker 未就绪".to_owned(),
                        "host.worker_timeout" => "Worker 未在期限内完成媒体检查".to_owned(),
                        _ => format!("Worker 媒体检查失败（{}）", error.code),
                    });
                }
            }
        }
        Ok(inputs)
    }

    fn supports_progressive_inspection(&self) -> Result<bool, HostError> {
        if self.status().state == "starting" {
            self.wait_until_ready(READY_TIMEOUT)?;
        }
        let generation = self.generation.load(Ordering::SeqCst);
        if let Ok(version) = self.media_inspection_version.lock()
            && let Some((_, supported)) = version.filter(|(worker, _)| *worker == generation)
        {
            return Ok(supported);
        }
        Ok(self
            .health()?
            .pointer("/data/result/media_inspection_version")
            .and_then(Value::as_u64)
            == Some(1))
    }
}

pub fn strip_one_pair_of_quotes(value: &str) -> &str {
    value
        .strip_prefix('"')
        .and_then(|inner| inner.strip_suffix('"'))
        .unwrap_or(value)
}
