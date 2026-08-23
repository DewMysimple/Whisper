use std::collections::{HashMap, HashSet, VecDeque};
use std::env;
use std::ffi::OsString;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex, mpsc};
use std::thread;
use std::time::{Duration, Instant};

use chrono::Local;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};

use crate::protocol::{event_code, request_id, valid_identifier, validate_worker_line};

pub const WORKER_MESSAGE_EVENT: &str = "desktop://worker-message";
pub const HOST_STATUS_EVENT: &str = "desktop://host-status";
pub const WORKER_LOG_EVENT: &str = "desktop://worker-log";
pub const WORKER_LOGS_CLEARED_EVENT: &str = "desktop://worker-logs-cleared";

const START_TIMEOUT: Duration = Duration::from_secs(180);
const MODEL_LOAD_TIMEOUT: Duration = Duration::from_secs(180);
const MEDIA_INSPECT_TIMEOUT: Duration = Duration::from_secs(120);
const COMMAND_TIMEOUT: Duration = Duration::from_secs(30);
const READY_TIMEOUT: Duration = Duration::from_secs(30);
const SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(15);
const CREATE_NO_WINDOW: u32 = 0x0800_0000;
mod logs;
mod media;
mod model_catalog;
mod models;
use self::logs::{worker_log_summary, worker_quality_diagnostic_log_lines};
pub use self::media::{apply_media_inspections, inspect_input_paths};
use self::model_catalog::{DEFAULT_MODEL_ID, SUPPORTED_MODEL_IDS};
use self::models::{inspect_local_models, packaged_worker_environment};

pub type EventSink = Arc<dyn Fn(&str, Value) + Send + Sync + 'static>;
type PendingResult = Result<Value, HostError>;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HostStatus {
    pub state: String,
    pub pid: Option<u32>,
    pub launch_kind: Option<String>,
    pub error: Option<String>,
}

impl HostStatus {
    fn stopped() -> Self {
        Self {
            state: "stopped".to_owned(),
            pid: None,
            launch_kind: None,
            error: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct HostError {
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
}

impl HostError {
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            data: None,
        }
    }

    pub fn with_data(mut self, data: Option<Value>) -> Self {
        self.data = data;
        self
    }
}

impl std::fmt::Display for HostError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for HostError {}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BridgeInputSource {
    pub path: String,
    pub kind: String,
    pub origin: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BridgeOutputPolicy {
    pub mode: String,
    pub root_directory: Option<String>,
    pub txt_enabled: bool,
    pub markdown_enabled: bool,
    pub srt_enabled: bool,
    pub preserve_source_txt: bool,
    #[serde(default)]
    pub preserve_source_markdown: bool,
    pub conflict_policy: String,
    pub subtitle: BridgeSubtitleParameters,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BridgeHardwarePreference {
    pub mode: String,
    pub gpu_device_index: i64,
    pub cuda_compute_type: String,
    pub cpu_compute_type: String,
    pub cpu_threads: i64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BridgeSubtitleParameters {
    pub max_characters_per_line: i64,
    pub max_lines_per_cue: i64,
    pub min_cue_duration_ms: i64,
    pub max_cue_duration_ms: i64,
    pub max_characters_per_second: f64,
    pub cue_gap_ms: i64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StartDraft {
    pub request_id: String,
    #[serde(default = "default_model_id")]
    pub model_id: String,
    #[serde(default = "default_recognition_strategy")]
    pub recognition_strategy: String,
    #[serde(default)]
    pub finish_action: Option<String>,
    pub inputs: Vec<BridgeInputSource>,
    pub base_preset_id: String,
    pub overrides: Map<String, Value>,
    #[serde(default)]
    pub hardware: Option<BridgeHardwarePreference>,
    pub output: BridgeOutputPolicy,
}

fn default_model_id() -> String {
    DEFAULT_MODEL_ID.to_owned()
}

fn default_recognition_strategy() -> String {
    "stable_primary".to_owned()
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartResult {
    pub request_id: String,
    pub task_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InspectedInput {
    pub path: String,
    pub kind: String,
    pub origin: String,
    pub valid: bool,
    pub media_count: Option<usize>,
    pub duration_seconds: Option<f64>,
    pub unknown_duration_count: Option<usize>,
    pub detail: Option<String>,
    #[serde(skip)]
    pub media_paths: Vec<PathBuf>,
}

#[derive(Debug, Clone, Deserialize, PartialEq)]
pub struct MediaInspectionItem {
    pub path: String,
    pub readable: bool,
    pub duration_seconds: Option<f64>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LocalModelDescriptor {
    pub id: String,
    pub label: String,
    pub installed: bool,
    pub path: Option<String>,
    pub size_bytes: Option<u64>,
    pub detail: String,
}

#[derive(Debug, Clone)]
struct WorkerLaunch {
    program: PathBuf,
    arguments: Vec<String>,
    working_directory: PathBuf,
    environment: Vec<(OsString, OsString)>,
    kind: String,
}

pub struct WorkerManager {
    repository_root: PathBuf,
    sink: EventSink,
    status: Mutex<HostStatus>,
    status_changed: Condvar,
    child: Mutex<Option<Child>>,
    stdin: Mutex<Option<ChildStdin>>,
    pending: Mutex<HashMap<String, mpsc::SyncSender<PendingResult>>>,
    active_tasks: Mutex<HashSet<String>>,
    logs: Mutex<VecDeque<String>>,
    request_sequence: AtomicU64,
    generation: AtomicU64,
    stopping: AtomicBool,
}

impl WorkerManager {
    pub fn new(repository_root: PathBuf, sink: EventSink) -> Arc<Self> {
        Arc::new(Self {
            repository_root,
            sink,
            status: Mutex::new(HostStatus::stopped()),
            status_changed: Condvar::new(),
            child: Mutex::new(None),
            stdin: Mutex::new(None),
            pending: Mutex::new(HashMap::new()),
            active_tasks: Mutex::new(HashSet::new()),
            logs: Mutex::new(VecDeque::new()),
            request_sequence: AtomicU64::new(1),
            generation: AtomicU64::new(0),
            stopping: AtomicBool::new(false),
        })
    }

    pub fn status(&self) -> HostStatus {
        self.status
            .lock()
            .map(|status| status.clone())
            .unwrap_or_else(|_| HostStatus {
                state: "failed".to_owned(),
                pid: None,
                launch_kind: None,
                error: Some("host status lock was poisoned".to_owned()),
            })
    }

    pub fn logs(&self) -> Vec<String> {
        self.logs
            .lock()
            .map(|logs| logs.iter().cloned().collect())
            .unwrap_or_default()
    }

    pub fn clear_logs(&self) {
        if let Ok(mut logs) = self.logs.lock() {
            logs.clear();
            // Keep the buffer mutation and its broadcast ordered against
            // concurrent push_log calls: a new line must never be followed
            // by a late "cleared" event in the WebView.
            (self.sink)(WORKER_LOGS_CLEARED_EVENT, json!({}));
            return;
        }
        (self.sink)(WORKER_LOGS_CLEARED_EVENT, json!({}));
    }

    fn push_log(&self, body: impl AsRef<str>) {
        let line = format!(
            "[{}] {}",
            Local::now().format("%Y-%m-%d %H:%M:%S"),
            body.as_ref()
        );
        if let Ok(mut logs) = self.logs.lock() {
            logs.push_back(line.clone());
        }
        (self.sink)(WORKER_LOG_EVENT, json!({"line": line}));
    }

    pub fn start(self: &Arc<Self>) -> Result<HostStatus, HostError> {
        let current = self.status();
        if matches!(current.state.as_str(), "starting" | "ready") {
            return Ok(current);
        }

        let launch = self.resolve_launch()?;
        self.stopping.store(false, Ordering::SeqCst);
        if let Ok(mut active_tasks) = self.active_tasks.lock() {
            active_tasks.clear();
        }
        let generation = self.generation.fetch_add(1, Ordering::SeqCst) + 1;
        self.update_status(HostStatus {
            state: "starting".to_owned(),
            pid: None,
            launch_kind: Some(launch.kind.clone()),
            error: None,
        });

        let mut command = Command::new(&launch.program);
        command
            .args(&launch.arguments)
            .current_dir(&launch.working_directory)
            .envs(launch.environment.iter().cloned())
            .env("PYTHONUTF8", "1")
            .env("PYTHONUNBUFFERED", "1")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(CREATE_NO_WINDOW);
        }

        let mut child = command.spawn().map_err(|error| {
            let failure = HostError::new(
                "host.worker_spawn_failed",
                format!("failed to start controlled Worker: {error}"),
            );
            self.fail_status(failure.message.clone());
            failure
        })?;
        let stdin = child.stdin.take().ok_or_else(|| {
            HostError::new(
                "host.worker_pipe_failed",
                "Worker stdin pipe is unavailable",
            )
        })?;
        let stdout = child.stdout.take().ok_or_else(|| {
            HostError::new(
                "host.worker_pipe_failed",
                "Worker stdout pipe is unavailable",
            )
        })?;
        let stderr = child.stderr.take().ok_or_else(|| {
            HostError::new(
                "host.worker_pipe_failed",
                "Worker stderr pipe is unavailable",
            )
        })?;

        *self
            .stdin
            .lock()
            .map_err(|_| HostError::new("host.internal", "Worker stdin lock was poisoned"))? =
            Some(stdin);
        *self
            .child
            .lock()
            .map_err(|_| HostError::new("host.internal", "Worker child lock was poisoned"))? =
            Some(child);

        let stdout_manager = Arc::clone(self);
        thread::Builder::new()
            .name("desktop-worker-stdout".to_owned())
            .spawn(move || stdout_manager.read_stdout(stdout, generation))
            .map_err(|error| HostError::new("host.thread_failed", error.to_string()))?;

        let stderr_manager = Arc::clone(self);
        thread::Builder::new()
            .name("desktop-worker-stderr".to_owned())
            .spawn(move || stderr_manager.read_stderr(stderr, generation))
            .map_err(|error| HostError::new("host.thread_failed", error.to_string()))?;

        self.wait_until_ready(READY_TIMEOUT)
    }

    pub fn restart(self: &Arc<Self>) -> Result<HostStatus, HostError> {
        self.shutdown(SHUTDOWN_TIMEOUT);
        self.start()
    }

    pub fn environment(&self) -> Result<Value, HostError> {
        self.send_generated_command("system.environment", json!({}), COMMAND_TIMEOUT)
    }

    pub fn health(&self) -> Result<Value, HostError> {
        self.send_generated_command("system.health", json!({}), COMMAND_TIMEOUT)
    }

    pub fn has_active_tasks(&self) -> bool {
        self.active_tasks
            .lock()
            .map(|tasks| !tasks.is_empty())
            .unwrap_or(true)
    }

    pub fn metrics(&self) -> Result<Value, HostError> {
        self.send_generated_command("system.metrics", json!({}), COMMAND_TIMEOUT)
    }

    pub fn inspect_media(&self, paths: &[PathBuf]) -> Result<Vec<MediaInspectionItem>, HostError> {
        if paths.is_empty() {
            return Ok(Vec::new());
        }
        let response = self.send_generated_command(
            "media.inspect",
            json!({"paths": paths}),
            MEDIA_INSPECT_TIMEOUT,
        )?;
        let items = response
            .pointer("/data/result/items")
            .cloned()
            .ok_or_else(|| {
                HostError::new(
                    "host.protocol_mismatch",
                    "media.inspect result has no items",
                )
            })?;
        let items: Vec<MediaInspectionItem> = serde_json::from_value(items).map_err(|error| {
            HostError::new(
                "host.protocol_mismatch",
                format!("media.inspect returned invalid items: {error}"),
            )
        })?;
        if items.len() != paths.len() {
            return Err(HostError::new(
                "host.protocol_mismatch",
                "media.inspect result does not align with requested paths",
            ));
        }
        Ok(items)
    }

    pub fn load_model(
        &self,
        model_id: &str,
        hardware: Option<BridgeHardwarePreference>,
    ) -> Result<Value, HostError> {
        if !SUPPORTED_MODEL_IDS.contains(&model_id) {
            return Err(HostError::new("request.invalid", "model_id is unsupported"));
        }
        if let Some(value) = hardware.as_ref() {
            validate_hardware_preference(value)?;
        }
        let mut params = json!({"model_id": model_id});
        if let Some(value) = hardware {
            params["hardware"] = hardware_to_protocol(value);
        }
        self.send_generated_command("model.load", params, MODEL_LOAD_TIMEOUT)
    }

    pub fn model_root(&self) -> PathBuf {
        if let Ok(current_exe) = env::current_exe()
            && let Some(directory) = current_exe.parent()
            && directory
                .join("worker")
                .join("whisper-subtitle-worker.exe")
                .is_file()
        {
            return directory.join("models");
        }
        self.repository_root.join("models").join("huggingface")
    }

    pub fn local_models(&self) -> Vec<LocalModelDescriptor> {
        inspect_local_models(&self.model_root())
    }

    pub fn start_transcription(&self, draft: StartDraft) -> Result<StartResult, HostError> {
        validate_start_draft(&draft)?;
        let request_id = draft.request_id.clone();
        let params = draft_to_protocol_params(draft);
        let response =
            self.send_command(&request_id, "transcription.start", params, START_TIMEOUT)?;
        if event_code(&response) != Some("task.queued") {
            return Err(HostError::new(
                "host.protocol_mismatch",
                "transcription.start did not resolve with task.queued",
            ));
        }
        let task_id = response
            .get("task_id")
            .and_then(Value::as_str)
            .ok_or_else(|| {
                HostError::new("host.protocol_mismatch", "task.queued has no task_id")
            })?;
        Ok(StartResult {
            request_id,
            task_id: task_id.to_owned(),
        })
    }

    pub fn cancel_transcription(&self, task_id: &str) -> Result<(), HostError> {
        if !valid_identifier(task_id) {
            return Err(HostError::new("request.invalid", "task_id is invalid"));
        }
        self.send_generated_command(
            "transcription.cancel",
            json!({"task_id": task_id}),
            COMMAND_TIMEOUT,
        )?;
        Ok(())
    }

    pub fn shutdown(&self, timeout: Duration) {
        let current = self.status();
        if current.state == "ready" {
            let _ = self.send_generated_command("worker.shutdown", json!({}), COMMAND_TIMEOUT);
        }
        self.stopping.store(true, Ordering::SeqCst);
        self.update_status(HostStatus {
            state: "stopping".to_owned(),
            pid: current.pid,
            launch_kind: current.launch_kind,
            error: None,
        });
        if let Ok(mut stdin) = self.stdin.lock() {
            stdin.take();
        }

        let deadline = Instant::now() + timeout;
        loop {
            let exited = self
                .child
                .lock()
                .ok()
                .and_then(|mut child| {
                    child
                        .as_mut()
                        .and_then(|value| value.try_wait().ok())
                        .flatten()
                })
                .is_some();
            if exited {
                break;
            }
            if Instant::now() >= deadline {
                if let Ok(mut child) = self.child.lock()
                    && let Some(value) = child.as_mut()
                {
                    let _ = value.kill();
                    let _ = value.wait();
                }
                break;
            }
            thread::sleep(Duration::from_millis(50));
        }
        if let Ok(mut child) = self.child.lock() {
            child.take();
        }
        self.fail_pending(HostError::new(
            "host.worker_stopped",
            "Worker stopped before completing the command",
        ));
        self.update_status(HostStatus::stopped());
    }

    fn send_generated_command(
        &self,
        method: &str,
        params: Value,
        timeout: Duration,
    ) -> Result<Value, HostError> {
        let sequence = self.request_sequence.fetch_add(1, Ordering::Relaxed);
        let request_id = format!("host-{sequence}");
        self.send_command(&request_id, method, params, timeout)
    }

    fn send_command(
        &self,
        request_id: &str,
        method: &str,
        params: Value,
        timeout: Duration,
    ) -> Result<Value, HostError> {
        if self.status().state != "ready" {
            return Err(HostError::new(
                "host.worker_not_ready",
                "Python Worker is not ready",
            ));
        }
        if !valid_identifier(request_id) {
            return Err(HostError::new("request.invalid", "request_id is invalid"));
        }
        let message = json!({
            "schema_version": 1,
            "type": "command",
            "request_id": request_id,
            "method": method,
            "params": params,
        });
        let mut line = serde_json::to_vec(&message)
            .map_err(|error| HostError::new("host.serialization_failed", error.to_string()))?;
        line.push(b'\n');
        let (sender, receiver) = mpsc::sync_channel(1);
        {
            let mut pending = self.pending.lock().map_err(|_| {
                HostError::new("host.internal", "pending command lock was poisoned")
            })?;
            if pending.insert(request_id.to_owned(), sender).is_some() {
                return Err(HostError::new(
                    "task.conflict",
                    "request_id is already pending",
                ));
            }
        }
        let write_result = self
            .stdin
            .lock()
            .map_err(|_| HostError::new("host.internal", "Worker stdin lock was poisoned"))?
            .as_mut()
            .ok_or_else(|| HostError::new("host.worker_not_ready", "Worker stdin is closed"))?
            .write_all(&line);
        if let Err(error) = write_result {
            self.remove_pending(request_id);
            return Err(HostError::new(
                "host.worker_write_failed",
                error.to_string(),
            ));
        }

        match receiver.recv_timeout(timeout) {
            Ok(result) => result,
            Err(mpsc::RecvTimeoutError::Timeout) => {
                self.remove_pending(request_id);
                Err(HostError::new(
                    "host.worker_timeout",
                    format!("Worker did not complete {method} before timeout"),
                ))
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => Err(HostError::new(
                "host.worker_disconnected",
                "Worker response channel disconnected",
            )),
        }
    }

    fn resolve_launch(&self) -> Result<WorkerLaunch, HostError> {
        if let Ok(current_exe) = env::current_exe()
            && let Some(directory) = current_exe.parent()
        {
            let packaged = directory.join("worker").join("whisper-subtitle-worker.exe");
            if packaged.is_file() {
                return Ok(WorkerLaunch {
                    program: packaged,
                    arguments: Vec::new(),
                    working_directory: directory.to_path_buf(),
                    environment: packaged_worker_environment(directory),
                    kind: "packaged-sidecar".to_owned(),
                });
            }
        }

        if let Some(program) = env::var_os("WHISPER_SUBTITLE_WORKER_PYTHON").map(PathBuf::from) {
            if !program.is_file() {
                return Err(HostError::new(
                    "host.worker_not_found",
                    "WHISPER_SUBTITLE_WORKER_PYTHON does not point to a file",
                ));
            }
            return Ok(self.python_launch(program, "configured-python"));
        }

        let development_python = self
            .repository_root
            .join("whisper_env")
            .join("Scripts")
            .join("python.exe");
        if development_python.is_file() {
            return Ok(self.python_launch(development_python, "development-python"));
        }

        Err(HostError::new(
            "host.worker_not_found",
            "no packaged Worker or controlled project Python interpreter was found",
        ))
    }

    fn python_launch(&self, program: PathBuf, kind: &str) -> WorkerLaunch {
        let model_root = self.repository_root.join("models").join("huggingface");
        WorkerLaunch {
            program,
            arguments: vec![
                "-m".to_owned(),
                "whisper_subtitle".to_owned(),
                "worker".to_owned(),
            ],
            working_directory: self.repository_root.clone(),
            environment: vec![(
                OsString::from("WHISPER_SUBTITLE_MODEL_DIR"),
                model_root.into_os_string(),
            )],
            kind: kind.to_owned(),
        }
    }

    fn wait_until_ready(&self, timeout: Duration) -> Result<HostStatus, HostError> {
        let deadline = Instant::now() + timeout;
        let mut status = self
            .status
            .lock()
            .map_err(|_| HostError::new("host.internal", "host status lock was poisoned"))?;
        loop {
            match status.state.as_str() {
                "ready" => {
                    return Ok(status.clone());
                }
                "failed" => {
                    return Err(HostError::new(
                        "host.worker_start_failed",
                        status
                            .error
                            .clone()
                            .unwrap_or_else(|| "Worker failed before ready".to_owned()),
                    ));
                }
                _ => {}
            }
            let now = Instant::now();
            if now >= deadline {
                return Err(HostError::new(
                    "host.worker_timeout",
                    "Worker did not emit worker.ready before timeout",
                ));
            }
            let remaining = deadline.saturating_duration_since(now);
            let (next, wait) = self
                .status_changed
                .wait_timeout(status, remaining)
                .map_err(|_| HostError::new("host.internal", "host status wait was poisoned"))?;
            status = next;
            if wait.timed_out() && status.state != "ready" {
                return Err(HostError::new(
                    "host.worker_timeout",
                    "Worker did not emit worker.ready before timeout",
                ));
            }
        }
    }

    fn read_stdout<R: std::io::Read>(&self, stream: R, generation: u64) {
        let reader = BufReader::new(stream);
        for line in reader.lines() {
            if generation != self.generation.load(Ordering::SeqCst) {
                return;
            }
            match line {
                Ok(value) => match validate_worker_line(&value) {
                    Ok(message) => self.handle_worker_message(message, generation),
                    Err(error) => {
                        self.protocol_failure(error.to_string(), generation);
                        return;
                    }
                },
                Err(error) => {
                    self.protocol_failure(
                        format!("failed to read Worker stdout: {error}"),
                        generation,
                    );
                    return;
                }
            }
        }
        self.worker_disconnected(generation);
    }

    fn read_stderr<R: std::io::Read>(&self, stream: R, generation: u64) {
        let reader = BufReader::new(stream);
        for line in reader.lines() {
            if generation != self.generation.load(Ordering::SeqCst) {
                return;
            }
            match line {
                Ok(value) => {
                    self.push_log(format!("[STDERR] {value}"));
                }
                Err(error) => {
                    self.push_log(format!("[STDERR] read error: {error}"));
                    return;
                }
            }
        }
    }

    fn handle_worker_message(&self, message: Value, generation: u64) {
        if generation != self.generation.load(Ordering::SeqCst) {
            return;
        }
        if event_code(&message) == Some("worker.ready") {
            let capabilities = message
                .pointer("/data/capabilities/methods")
                .and_then(Value::as_array);
            let has_required_methods = capabilities.is_some_and(|items| {
                [
                    "system.health",
                    "system.environment",
                    "system.metrics",
                    "transcription.start",
                    "transcription.cancel",
                    "worker.shutdown",
                ]
                .iter()
                .all(|required| items.iter().any(|item| item.as_str() == Some(required)))
            });
            if !has_required_methods {
                self.protocol_failure(
                    "worker.ready does not advertise required host methods".to_owned(),
                    generation,
                );
                return;
            }
            let pid = message
                .pointer("/data/pid")
                .and_then(Value::as_u64)
                .map(|value| value as u32);
            let mut status = self.status();
            status.state = "ready".to_owned();
            status.pid = pid;
            status.error = None;
            self.update_status(status);
        }

        match event_code(&message) {
            Some("task.queued") => {
                if let Some(task_id) = message
                    .get("task_id")
                    .and_then(Value::as_str)
                    .or_else(|| message.get("taskId").and_then(Value::as_str))
                    && let Ok(mut active_tasks) = self.active_tasks.lock()
                {
                    active_tasks.insert(task_id.to_owned());
                }
            }
            Some("task.completed" | "task.failed" | "task.cancelled") => {
                if let Some(task_id) = message
                    .get("task_id")
                    .and_then(Value::as_str)
                    .or_else(|| message.get("taskId").and_then(Value::as_str))
                    && let Ok(mut active_tasks) = self.active_tasks.lock()
                {
                    active_tasks.remove(task_id);
                }
            }
            _ => {}
        }

        let completion = matches!(
            event_code(&message),
            Some("command.completed" | "task.queued")
        );
        let is_error = message.get("type").and_then(Value::as_str) == Some("error");
        if completion || is_error {
            self.resolve_pending(&message, is_error);
        }
        if let Some(summary) = worker_log_summary(&message) {
            self.push_log(summary);
        }
        for line in worker_quality_diagnostic_log_lines(&message) {
            self.push_log(line);
        }
        (self.sink)(WORKER_MESSAGE_EVENT, message);
    }

    fn resolve_pending(&self, message: &Value, is_error: bool) {
        let Some(id) = request_id(message) else {
            return;
        };
        let sender = self
            .pending
            .lock()
            .ok()
            .and_then(|mut pending| pending.remove(id));
        if let Some(sender) = sender {
            let result = if is_error {
                Err(HostError::new(
                    message
                        .get("code")
                        .and_then(Value::as_str)
                        .unwrap_or("worker.error"),
                    message
                        .get("message")
                        .and_then(Value::as_str)
                        .unwrap_or("Python Worker rejected the command"),
                )
                .with_data(message.get("data").cloned()))
            } else {
                Ok(message.clone())
            };
            let _ = sender.send(result);
        }
    }

    fn remove_pending(&self, id: &str) {
        if let Ok(mut pending) = self.pending.lock() {
            pending.remove(id);
        }
    }

    fn fail_pending(&self, error: HostError) {
        let senders: Vec<_> = self
            .pending
            .lock()
            .map(|mut pending| pending.drain().map(|(_, sender)| sender).collect())
            .unwrap_or_default();
        for sender in senders {
            let _ = sender.send(Err(error.clone()));
        }
    }

    fn protocol_failure(&self, message: String, generation: u64) {
        if generation != self.generation.load(Ordering::SeqCst) {
            return;
        }
        let error = HostError::new("host.protocol_invalid", message);
        self.fail_pending(error.clone());
        self.fail_status(error.message);
        if let Ok(mut child) = self.child.lock()
            && let Some(value) = child.as_mut()
        {
            let _ = value.kill();
        }
    }

    fn worker_disconnected(&self, generation: u64) {
        if generation != self.generation.load(Ordering::SeqCst) {
            return;
        }
        if let Ok(mut active_tasks) = self.active_tasks.lock() {
            active_tasks.clear();
        }
        if self.stopping.load(Ordering::SeqCst) {
            self.update_status(HostStatus::stopped());
            return;
        }
        let error = HostError::new(
            "host.worker_disconnected",
            "Python Worker closed its protocol stream unexpectedly",
        );
        self.fail_pending(error.clone());
        self.fail_status(error.message);
    }

    fn fail_status(&self, message: String) {
        let previous = self.status();
        self.update_status(HostStatus {
            state: "failed".to_owned(),
            pid: previous.pid,
            launch_kind: previous.launch_kind,
            error: Some(message),
        });
    }

    fn update_status(&self, status: HostStatus) {
        if let Ok(mut current) = self.status.lock() {
            *current = status.clone();
            self.status_changed.notify_all();
        }
        (self.sink)(
            HOST_STATUS_EVENT,
            serde_json::to_value(status).unwrap_or(Value::Null),
        );
    }
}

mod validation;
use validation::{validate_hardware_preference, validate_start_draft};

fn hardware_to_protocol(hardware: BridgeHardwarePreference) -> Value {
    json!({
        "mode": hardware.mode,
        "gpu_device_index": hardware.gpu_device_index,
        "cuda_compute_type": hardware.cuda_compute_type,
        "cpu_compute_type": hardware.cpu_compute_type,
        "cpu_threads": hardware.cpu_threads,
    })
}

fn draft_to_protocol_params(draft: StartDraft) -> Value {
    let hardware = draft.hardware;
    let mut params = json!({
        "model_id": draft.model_id,
        "recognition_strategy": draft.recognition_strategy,
        "inputs": draft.inputs,
        "profile": {
            "base_preset_id": draft.base_preset_id,
            "overrides": draft.overrides,
        },
        "output": {
            "mode": draft.output.mode,
            "root_directory": draft.output.root_directory,
            "txt": {"enabled": draft.output.txt_enabled, "directory": null},
            "markdown": {"enabled": draft.output.markdown_enabled, "directory": null},
            "srt": {"enabled": draft.output.srt_enabled, "directory": null},
            "subtitle": {
                "max_characters_per_line": draft.output.subtitle.max_characters_per_line,
                "max_lines_per_cue": draft.output.subtitle.max_lines_per_cue,
                "min_cue_duration_ms": draft.output.subtitle.min_cue_duration_ms,
                "max_cue_duration_ms": draft.output.subtitle.max_cue_duration_ms,
                "max_characters_per_second": draft.output.subtitle.max_characters_per_second,
                "cue_gap_ms": draft.output.subtitle.cue_gap_ms,
            },
            "preserve_source_txt": draft.output.preserve_source_txt,
            "preserve_source_markdown": draft.output.preserve_source_markdown,
            "conflict_policy": draft.output.conflict_policy,
        }
    });
    if let Some(value) = hardware {
        params["hardware"] = hardware_to_protocol(value);
    }
    params
}

#[cfg(test)]
mod tests {
    use std::env;
    use std::fs;
    use std::path::PathBuf;
    use std::sync::{Arc, Mutex, mpsc};
    use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

    use serde_json::{Map, Value, json};

    use super::media::strip_one_pair_of_quotes;
    use super::{
        BridgeHardwarePreference, BridgeInputSource, BridgeOutputPolicy, BridgeSubtitleParameters,
        MediaInspectionItem, StartDraft, WORKER_LOGS_CLEARED_EVENT, WORKER_MESSAGE_EVENT,
        WorkerManager, apply_media_inspections, draft_to_protocol_params, inspect_input_paths,
        inspect_local_models, validate_start_draft, worker_log_summary,
        worker_quality_diagnostic_log_lines,
    };

    fn subtitle_parameters() -> BridgeSubtitleParameters {
        BridgeSubtitleParameters {
            max_characters_per_line: 42,
            max_lines_per_cue: 2,
            min_cue_duration_ms: 800,
            max_cue_duration_ms: 7000,
            max_characters_per_second: 20.0,
            cue_gap_ms: 80,
        }
    }

    fn valid_draft() -> StartDraft {
        StartDraft {
            request_id: "desktop-1".to_owned(),
            model_id: "large-v3-turbo".to_owned(),
            recognition_strategy: "stable_primary".to_owned(),
            finish_action: None,
            inputs: vec![BridgeInputSource {
                path: r"C:\Media\lesson.mp4".to_owned(),
                kind: "file".to_owned(),
                origin: "dialog".to_owned(),
            }],
            base_preset_id: "en_v1".to_owned(),
            overrides: Map::new(),
            hardware: None,
            output: BridgeOutputPolicy {
                mode: "compatibility".to_owned(),
                root_directory: None,
                txt_enabled: true,
                markdown_enabled: false,
                srt_enabled: false,
                preserve_source_txt: true,
                preserve_source_markdown: false,
                conflict_policy: "fail".to_owned(),
                subtitle: subtitle_parameters(),
            },
        }
    }

    #[test]
    fn converts_bridge_draft_to_exact_worker_shape() {
        let params = draft_to_protocol_params(valid_draft());
        assert_eq!(params["profile"]["base_preset_id"], json!("en_v1"));
        assert_eq!(params["model_id"], json!("large-v3-turbo"));
        assert_eq!(params["recognition_strategy"], json!("stable_primary"));
        assert_eq!(params["output"]["txt"]["enabled"], json!(true));
        assert_eq!(params["output"]["root_directory"], Value::Null);
        assert_eq!(params["output"]["preserve_source_markdown"], json!(false));
        assert!(params.get("effectiveParameters").is_none());
    }

    #[test]
    fn accepts_mixed_strategy_only_for_chinese_presets_and_freezes_it() {
        let mut draft = valid_draft();
        draft.base_preset_id = "cn2".to_owned();
        draft.recognition_strategy = "mixed_zh_en".to_owned();
        validate_start_draft(&draft).expect("mixed strategy is valid for cn2");
        let params = draft_to_protocol_params(draft);
        assert_eq!(params["recognition_strategy"], json!("mixed_zh_en"));

        let mut english = valid_draft();
        english.recognition_strategy = "mixed_zh_en".to_owned();
        assert!(validate_start_draft(&english).is_err());

        let mut detail = valid_draft();
        detail.base_preset_id = "cn".to_owned();
        detail.model_id = "large-v3".to_owned();
        detail.recognition_strategy = "zh_detail_review".to_owned();
        validate_start_draft(&detail).expect("detail strategy is valid for V3 Chinese preset");
        let params = draft_to_protocol_params(detail);
        assert_eq!(params["recognition_strategy"], json!("zh_detail_review"));

        let mut hidden_model = valid_draft();
        hidden_model.base_preset_id = "cn2".to_owned();
        hidden_model.model_id = "small".to_owned();
        hidden_model.recognition_strategy = "zh_detail_review".to_owned();
        assert!(validate_start_draft(&hidden_model).is_err());
    }

    #[test]
    fn preserves_en_v2_identity_in_worker_request() {
        let mut draft = valid_draft();
        draft.base_preset_id = "en_v2".to_owned();

        validate_start_draft(&draft).expect("valid en_v2 draft");
        let params = draft_to_protocol_params(draft);

        assert_eq!(params["profile"]["base_preset_id"], json!("en_v2"));
    }

    #[test]
    fn freezes_validated_hardware_and_overwrite_policy_in_worker_request() {
        let mut draft = valid_draft();
        draft.hardware = Some(BridgeHardwarePreference {
            mode: "cuda".to_owned(),
            gpu_device_index: 1,
            cuda_compute_type: "int8_float16".to_owned(),
            cpu_compute_type: "int8".to_owned(),
            cpu_threads: 4,
        });
        draft.output.conflict_policy = "overwrite".to_owned();

        validate_start_draft(&draft).expect("valid hardware draft");
        let params = draft_to_protocol_params(draft);

        assert_eq!(params["hardware"]["mode"], json!("cuda"));
        assert_eq!(params["hardware"]["gpu_device_index"], json!(1));
        assert_eq!(
            params["hardware"]["cuda_compute_type"],
            json!("int8_float16")
        );
        assert_eq!(params["output"]["conflict_policy"], json!("overwrite"));
    }

    #[test]
    fn rejects_hardware_values_outside_the_host_whitelist() {
        let mut draft = valid_draft();
        draft.hardware = Some(BridgeHardwarePreference {
            mode: "cuda".to_owned(),
            gpu_device_index: 0,
            cuda_compute_type: "int8".to_owned(),
            cpu_compute_type: "int8".to_owned(),
            cpu_threads: 4,
        });

        assert!(validate_start_draft(&draft).is_err());
    }

    #[test]
    fn accepts_translation_guidance_and_repeat_overrides_for_english_presets() {
        let mut draft = valid_draft();
        draft.model_id = "large-v3".to_owned();
        draft.base_preset_id = "en_v2".to_owned();
        draft.overrides = Map::from_iter([
            ("task".to_owned(), json!("translate")),
            ("initial_prompt".to_owned(), json!("CTranslate2\nWebView2")),
            ("hotwords".to_owned(), json!("WhisperSubtitle Large V3")),
            ("repetition_penalty".to_owned(), json!(1.15)),
            ("no_repeat_ngram_size".to_owned(), json!(3)),
            ("prompt_reset_on_temperature".to_owned(), json!(0.7)),
            ("temperature".to_owned(), json!(0.0)),
        ]);

        validate_start_draft(&draft).expect("valid advanced overrides");
        let params = draft_to_protocol_params(draft);
        assert_eq!(params["profile"]["overrides"]["task"], json!("translate"));
        assert_eq!(
            params["profile"]["overrides"]["initial_prompt"],
            json!("CTranslate2\nWebView2")
        );
    }

    #[test]
    fn rejects_translation_for_chinese_presets_and_invalid_prompt_text() {
        let mut translated = valid_draft();
        translated.base_preset_id = "cn2".to_owned();
        translated
            .overrides
            .insert("task".to_owned(), json!("translate"));
        assert!(validate_start_draft(&translated).is_err());

        let mut turbo_translation = valid_draft();
        turbo_translation.base_preset_id = "en_v2".to_owned();
        turbo_translation
            .overrides
            .insert("task".to_owned(), json!("translate"));
        assert!(validate_start_draft(&turbo_translation).is_err());

        let mut invalid_prompt = valid_draft();
        invalid_prompt
            .overrides
            .insert("initial_prompt".to_owned(), json!("bad\u{0}prompt"));
        assert!(validate_start_draft(&invalid_prompt).is_err());
    }

    #[test]
    fn accepts_only_shutdown_as_a_finish_action() {
        let mut draft = valid_draft();
        draft.finish_action = Some("shutdown".to_owned());
        assert!(validate_start_draft(&draft).is_ok());
        draft.finish_action = Some("hibernate".to_owned());
        assert!(validate_start_draft(&draft).is_err());
    }

    #[test]
    fn deserializes_subtitle_bridge_fields_only_in_camel_case() {
        let camel_case = serde_json::to_value(valid_draft()).expect("serialize valid bridge draft");
        let subtitle = &camel_case["output"]["subtitle"];
        assert_eq!(subtitle["maxCharactersPerLine"], json!(42));
        assert_eq!(subtitle["cueGapMs"], json!(80));
        assert!(subtitle.get("max_characters_per_line").is_none());
        assert!(subtitle.get("cue_gap_ms").is_none());
        serde_json::from_value::<StartDraft>(camel_case).expect("deserialize camelCase draft");

        let mut snake_case = serde_json::to_value(valid_draft()).expect("serialize bridge draft");
        let subtitle = snake_case["output"]["subtitle"]
            .as_object_mut()
            .expect("subtitle object");
        let cue_gap = subtitle.remove("cueGapMs").expect("camelCase cue gap");
        subtitle.insert("cue_gap_ms".to_owned(), cue_gap);
        assert!(serde_json::from_value::<StartDraft>(snake_case).is_err());
    }

    #[test]
    fn custom_output_requires_a_real_root() {
        let mut draft = valid_draft();
        draft.output.mode = "custom".to_owned();
        assert!(validate_start_draft(&draft).is_err());
        draft.output.root_directory = Some(r"D:\Transcripts".to_owned());
        assert!(validate_start_draft(&draft).is_ok());
    }

    #[test]
    fn strips_only_one_complete_quote_pair() {
        assert_eq!(
            strip_one_pair_of_quotes(r#""C:\Media Files\a.mp4""#),
            r"C:\Media Files\a.mp4"
        );
        assert_eq!(
            strip_one_pair_of_quotes(r#""C:\Media Files\a.mp4"#),
            r#""C:\Media Files\a.mp4"#
        );
    }

    #[test]
    fn missing_input_is_retained_as_invalid() {
        let inspected = inspect_input_paths(
            vec![r"Z:\definitely-missing\file.mp4".to_owned()],
            "drop".to_owned(),
        );
        assert_eq!(inspected.len(), 1);
        assert!(!inspected[0].valid);
        assert_eq!(inspected[0].origin, "drop");
    }

    #[test]
    fn recursively_counts_only_supported_media() {
        let root = env::temp_dir().join(format!(
            "whisper-subtitle-inspect-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system clock")
                .as_nanos()
        ));
        let nested = root.join("nested");
        fs::create_dir_all(&nested).expect("nested fixture directory");
        fs::write(root.join("one.mp4"), b"fixture").expect("media fixture");
        fs::write(nested.join("two.WAV"), b"fixture").expect("nested media fixture");
        fs::write(nested.join("ignore.txt"), b"fixture").expect("non-media fixture");

        let mut inspected = inspect_input_paths(
            vec![root.to_string_lossy().into_owned()],
            "dialog".to_owned(),
        );
        assert!(inspected[0].valid);
        assert_eq!(inspected[0].kind, "directory");
        assert_eq!(inspected[0].media_count, Some(2));
        assert_eq!(
            inspected[0].detail.as_deref(),
            Some("递归发现 2 个媒体文件")
        );
        assert_eq!(inspected[0].media_paths.len(), 2);
        let media_paths = inspected[0].media_paths.clone();
        apply_media_inspections(
            &mut inspected,
            &[
                MediaInspectionItem {
                    path: media_paths[0].to_string_lossy().into_owned(),
                    readable: true,
                    duration_seconds: Some(12.25),
                    error: None,
                },
                MediaInspectionItem {
                    path: media_paths[1].to_string_lossy().into_owned(),
                    readable: true,
                    duration_seconds: None,
                    error: None,
                },
            ],
        )
        .expect("aligned media inspections");
        assert_eq!(inspected[0].duration_seconds, Some(12.25));
        assert_eq!(inspected[0].unknown_duration_count, Some(1));

        fs::remove_dir_all(root).expect("remove temporary fixture");
    }

    #[test]
    fn discovers_exact_managed_and_hugging_face_models() {
        let root = env::temp_dir().join(format!(
            "whisper-subtitle-models-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system clock")
                .as_nanos()
        ));
        let turbo = root.join("large-v3-turbo");
        let medium = root
            .join("hub")
            .join("models--Systran--faster-whisper-medium")
            .join("snapshots")
            .join("revision");
        let legacy_turbo = root
            .join("hub")
            .join("models--Systran--faster-whisper-large-v3-turbo")
            .join("snapshots")
            .join("legacy-revision");
        fs::create_dir_all(&turbo).expect("turbo model directory");
        fs::create_dir_all(&medium).expect("medium snapshot directory");
        fs::create_dir_all(&legacy_turbo).expect("legacy turbo snapshot directory");
        for directory in [&turbo, &medium, &legacy_turbo] {
            fs::write(directory.join("config.json"), b"{}").expect("model config");
            fs::write(directory.join("model.bin"), b"model").expect("model binary");
        }

        let models = inspect_local_models(&root);
        assert_eq!(models.len(), 6);
        assert!(
            models
                .iter()
                .find(|item| item.id == "medium")
                .unwrap()
                .installed
        );
        fs::remove_dir_all(&turbo).expect("remove managed turbo model");
        let models = inspect_local_models(&root);
        assert!(
            models
                .iter()
                .find(|item| item.id == "large-v3-turbo")
                .unwrap()
                .path
                .as_deref()
                .is_some_and(|path| path.contains("models--Systran--faster-whisper-large-v3-turbo"))
        );
        assert!(
            models
                .iter()
                .find(|item| item.id == "large-v3-turbo")
                .unwrap()
                .installed
        );
        assert!(
            !models
                .iter()
                .find(|item| item.id == "large-v3")
                .unwrap()
                .installed
        );

        fs::remove_dir_all(root).expect("remove model fixture");
    }

    #[test]
    fn formats_task_lifecycle_but_ignores_command_completions() {
        let progress = json!({
            "schema_version": 1,
            "type": "event",
            "event": "task.progress",
            "task_id": "task-12345678",
            "message": "正在转录",
            "data": {
                "stage": "transcription.running",
                "current": 2,
                "total": 8,
                "input_path": r"C:\Media\lesson.mp4"
            }
        });
        let summary = worker_log_summary(&progress).expect("task progress log");
        assert!(summary.contains("[TASK 12345678] progress"));
        assert!(summary.contains("2/8"));
        assert!(summary.contains("lesson.mp4"));

        let completion = json!({
            "schema_version": 1,
            "type": "event",
            "event": "command.completed",
            "request_id": "desktop-1",
            "data": {"method": "system.metrics", "result": {}}
        });
        assert_eq!(worker_log_summary(&completion), None);
    }

    #[test]
    fn formats_every_quality_diagnostic_for_worker_logs() {
        let progress = json!({
            "schema_version": 1,
            "type": "event",
            "event": "task.progress",
            "task_id": "task-12345678",
            "data": {
                "stage": "transcription.running",
                "current": 1,
                "total": 1,
                "quality_diagnostics": {
                    "detected_language": "zh",
                    "language_probability": 0.91,
                    "segment_count": 2,
                    "fallback_segment_count": 1,
                    "max_temperature": 0.4,
                    "low_confidence_count": 1,
                    "recognition_strategy": "mixed_zh_en",
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
                        "end": 31.0,
                        "top_language": "en",
                        "top_probability": 0.92,
                        "english_probability": 0.92,
                        "chinese_probability": 0.03,
                        "primary_text": "错误中文",
                        "candidate_text": "I'm free.",
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
                        "reasons": ["fallback_temperature"]
                    }]
                }
            }
        });

        let lines = worker_quality_diagnostic_log_lines(&progress);
        assert_eq!(lines.len(), 5);
        assert!(lines[0].contains("复杂中英混合"));
        assert!(lines[0].contains("需复核 1"));
        assert!(lines[1].contains("需要复核"));
        assert!(lines[1].contains("logprob=-1.200"));
        assert!(lines[2].contains("language region"));
        assert!(lines[2].contains("second=I'm free."));
        assert!(lines[3].contains("Chinese detail candidate"));
        assert!(lines[3].contains("first=拟太环境"));
        assert!(lines[4].contains("missing [simulacra-self]"));
    }

    #[test]
    fn keeps_the_full_session_log_and_clears_it_atomically() {
        let channels = Arc::new(Mutex::new(Vec::new()));
        let captured = Arc::clone(&channels);
        let sink = Arc::new(move |channel: &str, _payload: Value| {
            captured
                .lock()
                .expect("captured channels")
                .push(channel.to_owned());
        });
        let manager = WorkerManager::new(PathBuf::from("."), sink);

        for index in 0..205 {
            manager.push_log(format!("line {index}"));
        }
        assert_eq!(manager.logs().len(), 205);

        manager.clear_logs();
        assert!(manager.logs().is_empty());
        assert_eq!(
            channels
                .lock()
                .expect("captured channels")
                .last()
                .map(String::as_str),
            Some(WORKER_LOGS_CLEARED_EVENT)
        );
    }

    #[test]
    fn tracks_active_tasks_from_authoritative_worker_events() {
        let manager = WorkerManager::new(PathBuf::from("."), Arc::new(|_, _| {}));
        let generation = manager.generation.load(std::sync::atomic::Ordering::SeqCst);

        manager.handle_worker_message(
            json!({
                "schema_version": 1,
                "type": "event",
                "event": "task.queued",
                "request_id": "request-1",
                "task_id": "task-1",
                "message": "queued",
                "data": {}
            }),
            generation,
        );
        assert!(manager.has_active_tasks());

        manager.handle_worker_message(
            json!({
                "schema_version": 1,
                "type": "event",
                "event": "task.completed",
                "task_id": "task-1",
                "message": "completed",
                "data": {"outputs": []}
            }),
            generation,
        );
        assert!(!manager.has_active_tasks());
    }

    #[test]
    #[ignore = "requires the project Python environment and a real NVIDIA GPU"]
    fn real_worker_process_gpu_smoke() {
        let repository_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .ancestors()
            .nth(3)
            .map(PathBuf::from)
            .expect("repository root");
        let fixture = env::var_os("WHISPER_SUBTITLE_GPU_FIXTURE")
            .map(PathBuf::from)
            .unwrap_or_else(|| {
                repository_root
                    .join("tests")
                    .join("fixtures")
                    .join("chinese_short.wav")
            });
        let preset_id = env::var("WHISPER_SUBTITLE_GPU_PRESET").unwrap_or_else(|_| "cn".to_owned());
        let output_root = env::var_os("WHISPER_SUBTITLE_GPU_OUTPUT_ROOT")
            .map(PathBuf::from)
            .unwrap_or_else(|| {
                repository_root
                    .join("build")
                    .join("batch4-host-gpu-validation")
            });
        let (sender, receiver) = mpsc::channel();
        let sink = Arc::new(move |channel: &str, payload: Value| {
            if channel == WORKER_MESSAGE_EVENT {
                let _ = sender.send(payload);
            }
        });
        let manager = WorkerManager::new(repository_root, sink);
        let status = manager.start().expect("real Worker must start");
        assert_eq!(status.state, "ready");
        let environment = manager.environment().expect("environment command");
        assert_eq!(environment["data"]["result"]["available"], json!(true));
        let restarted = manager.restart().expect("real Worker must restart");
        assert_eq!(restarted.state, "ready");
        assert_ne!(restarted.pid, status.pid);
        let metrics = manager.metrics().expect("system.metrics command");
        let result = &metrics["data"]["result"];
        assert!(result["cpu_percent"].is_number());
        assert!(result["memory_percent"].is_number());
        assert!(result["gpu_percent"].is_number());
        assert!(result["vram_total_gib"].is_number());
        assert!(result["cpu_name"].is_string());
        assert!(result["cpu_logical_cores"].is_number());
        assert!(result["memory_available_gib"].is_number());
        assert!(result["worker_rss_gib"].is_number());
        assert!(result["gpu_temperature_c"].is_number());
        assert!(result["gpu_power_watts"].is_number());
        assert!(result["gpu_driver_version"].is_string());

        let draft = StartDraft {
            request_id: "batch4-real-gpu".to_owned(),
            model_id: "large-v3-turbo".to_owned(),
            recognition_strategy: "stable_primary".to_owned(),
            finish_action: None,
            inputs: vec![BridgeInputSource {
                path: fixture.to_string_lossy().into_owned(),
                kind: "file".to_owned(),
                origin: "manual".to_owned(),
            }],
            base_preset_id: preset_id,
            overrides: Map::new(),
            hardware: None,
            output: BridgeOutputPolicy {
                mode: "custom".to_owned(),
                root_directory: Some(output_root.to_string_lossy().into_owned()),
                txt_enabled: true,
                markdown_enabled: true,
                srt_enabled: false,
                preserve_source_txt: false,
                preserve_source_markdown: false,
                conflict_policy: "auto_rename".to_owned(),
                subtitle: subtitle_parameters(),
            },
        };
        let started = manager
            .start_transcription(draft)
            .expect("host must receive task.queued");
        let deadline = Instant::now() + Duration::from_secs(300);
        let completed = loop {
            let remaining = deadline.saturating_duration_since(Instant::now());
            let message = receiver
                .recv_timeout(remaining)
                .expect("terminal Worker event before timeout");
            if message.get("task_id").and_then(Value::as_str) != Some(started.task_id.as_str()) {
                continue;
            }
            match message.get("event").and_then(Value::as_str) {
                Some("task.completed") => break message,
                Some("task.failed" | "task.cancelled") => {
                    panic!("real task did not complete: {message}")
                }
                _ => {}
            }
        };
        let outputs = completed["data"]["outputs"]
            .as_array()
            .expect("completed outputs");
        assert_eq!(outputs.len(), 2);
        assert!(outputs.iter().all(|path| {
            path.as_str()
                .map(PathBuf::from)
                .is_some_and(|value| value.is_file())
        }));
        manager.shutdown(Duration::from_secs(15));
    }
}
