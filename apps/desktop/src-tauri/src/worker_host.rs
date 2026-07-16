use std::collections::{HashMap, VecDeque};
use std::env;
use std::ffi::OsString;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex, mpsc};
use std::thread;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};

use crate::protocol::{event_code, request_id, valid_identifier, validate_worker_line};

pub const WORKER_MESSAGE_EVENT: &str = "desktop://worker-message";
pub const HOST_STATUS_EVENT: &str = "desktop://host-status";
pub const WORKER_LOG_EVENT: &str = "desktop://worker-log";

const START_TIMEOUT: Duration = Duration::from_secs(180);
const COMMAND_TIMEOUT: Duration = Duration::from_secs(30);
const READY_TIMEOUT: Duration = Duration::from_secs(30);
const SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(15);
const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const LOG_LIMIT: usize = 200;

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
}

impl HostError {
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
        }
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
    pub preserve_source_txt: bool,
    pub conflict_policy: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StartDraft {
    pub request_id: String,
    pub inputs: Vec<BridgeInputSource>,
    pub base_preset_id: String,
    pub overrides: Map<String, Value>,
    pub output: BridgeOutputPolicy,
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
    pub detail: Option<String>,
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

    pub fn start(self: &Arc<Self>) -> Result<HostStatus, HostError> {
        let current = self.status();
        if matches!(current.state.as_str(), "starting" | "ready") {
            return Ok(current);
        }

        let launch = self.resolve_launch()?;
        self.stopping.store(false, Ordering::SeqCst);
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

    pub fn metrics(&self) -> Result<Value, HostError> {
        self.send_generated_command("system.metrics", json!({}), COMMAND_TIMEOUT)
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
        WorkerLaunch {
            program,
            arguments: vec![
                "-m".to_owned(),
                "whisper_subtitle".to_owned(),
                "worker".to_owned(),
            ],
            working_directory: self.repository_root.clone(),
            environment: Vec::new(),
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
                    if let Ok(mut logs) = self.logs.lock() {
                        logs.push_back(value.clone());
                        while logs.len() > LOG_LIMIT {
                            logs.pop_front();
                        }
                    }
                    (self.sink)(WORKER_LOG_EVENT, json!({"line": value}));
                }
                Err(error) => {
                    (self.sink)(
                        WORKER_LOG_EVENT,
                        json!({"line": format!("stderr read error: {error}")}),
                    );
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

        let completion = matches!(
            event_code(&message),
            Some("command.completed" | "task.queued")
        );
        let is_error = message.get("type").and_then(Value::as_str) == Some("error");
        if completion || is_error {
            self.resolve_pending(&message, is_error);
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
                ))
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

fn packaged_worker_environment(directory: &Path) -> Vec<(OsString, OsString)> {
    let mut environment = vec![(
        OsString::from("WHISPER_SUBTITLE_HOME"),
        directory.as_os_str().to_owned(),
    )];
    let model = directory.join("models").join("large-v3-turbo");
    if model.join("config.json").is_file() && model.join("model.bin").is_file() {
        environment.push((
            OsString::from("WHISPER_SUBTITLE_MODEL_DIR"),
            model.into_os_string(),
        ));
    }
    environment
}

pub fn inspect_input_paths(paths: Vec<String>, origin: String) -> Vec<InspectedInput> {
    let normalized_origin = if matches!(origin.as_str(), "dialog" | "drop" | "paste" | "manual") {
        origin
    } else {
        "manual".to_owned()
    };
    paths
        .into_iter()
        .map(|raw| {
            let path = strip_one_pair_of_quotes(raw.trim());
            match std::fs::metadata(path) {
                Ok(metadata) => InspectedInput {
                    path: path.to_owned(),
                    kind: if metadata.is_dir() {
                        "directory"
                    } else {
                        "file"
                    }
                    .to_owned(),
                    origin: normalized_origin.clone(),
                    valid: metadata.is_dir() || metadata.is_file(),
                    detail: None,
                },
                Err(error) => InspectedInput {
                    path: path.to_owned(),
                    kind: "file".to_owned(),
                    origin: normalized_origin.clone(),
                    valid: false,
                    detail: Some(error.to_string()),
                },
            }
        })
        .collect()
}

fn strip_one_pair_of_quotes(value: &str) -> &str {
    value
        .strip_prefix('"')
        .and_then(|inner| inner.strip_suffix('"'))
        .unwrap_or(value)
}

fn validate_start_draft(draft: &StartDraft) -> Result<(), HostError> {
    if !valid_identifier(&draft.request_id) {
        return Err(HostError::new("request.invalid", "request_id is invalid"));
    }
    if draft.inputs.is_empty() {
        return Err(HostError::new(
            "request.invalid",
            "at least one input is required",
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
    validate_overrides(&draft.overrides)?;
    let output = &draft.output;
    if !matches!(output.mode.as_str(), "compatibility" | "custom")
        || !matches!(output.conflict_policy.as_str(), "fail" | "auto_rename")
        || (!output.txt_enabled && !output.markdown_enabled)
    {
        return Err(HostError::new(
            "request.invalid",
            "output policy is invalid",
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

fn validate_overrides(overrides: &Map<String, Value>) -> Result<(), HostError> {
    for (name, value) in overrides {
        let valid = match name.as_str() {
            "beam_size" | "best_of" => value.as_i64().is_some_and(|item| (1..=20).contains(&item)),
            "patience" => number_in_range(value, 0.0, 5.0),
            "length_penalty" => number_in_range(value, 0.0, 2.0),
            "temperature" | "no_speech_threshold" => number_in_range(value, 0.0, 1.0),
            "compression_ratio_threshold" => number_in_range(value, 0.0, 10.0),
            "log_prob_threshold" => number_in_range(value, -10.0, 0.0),
            "condition_on_previous_text" => value.is_boolean(),
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

fn number_in_range(value: &Value, minimum: f64, maximum: f64) -> bool {
    value
        .as_f64()
        .is_some_and(|item| item.is_finite() && (minimum..=maximum).contains(&item))
}

fn draft_to_protocol_params(draft: StartDraft) -> Value {
    json!({
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
            "preserve_source_txt": draft.output.preserve_source_txt,
            "conflict_policy": draft.output.conflict_policy,
        }
    })
}

#[cfg(test)]
mod tests {
    use std::env;
    use std::path::PathBuf;
    use std::sync::{Arc, mpsc};
    use std::time::{Duration, Instant};

    use serde_json::{Map, Value, json};

    use super::{
        BridgeInputSource, BridgeOutputPolicy, StartDraft, WORKER_MESSAGE_EVENT, WorkerManager,
        draft_to_protocol_params, inspect_input_paths, strip_one_pair_of_quotes,
        validate_start_draft,
    };

    fn valid_draft() -> StartDraft {
        StartDraft {
            request_id: "desktop-1".to_owned(),
            inputs: vec![BridgeInputSource {
                path: r"C:\Media\lesson.mp4".to_owned(),
                kind: "file".to_owned(),
                origin: "dialog".to_owned(),
            }],
            base_preset_id: "en_v1".to_owned(),
            overrides: Map::new(),
            output: BridgeOutputPolicy {
                mode: "compatibility".to_owned(),
                root_directory: None,
                txt_enabled: true,
                markdown_enabled: false,
                preserve_source_txt: true,
                conflict_policy: "fail".to_owned(),
            },
        }
    }

    #[test]
    fn converts_bridge_draft_to_exact_worker_shape() {
        let params = draft_to_protocol_params(valid_draft());
        assert_eq!(params["profile"]["base_preset_id"], json!("en_v1"));
        assert_eq!(params["output"]["txt"]["enabled"], json!(true));
        assert_eq!(params["output"]["root_directory"], Value::Null);
        assert!(params.get("effectiveParameters").is_none());
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

        let draft = StartDraft {
            request_id: "batch4-real-gpu".to_owned(),
            inputs: vec![BridgeInputSource {
                path: fixture.to_string_lossy().into_owned(),
                kind: "file".to_owned(),
                origin: "manual".to_owned(),
            }],
            base_preset_id: preset_id,
            overrides: Map::new(),
            output: BridgeOutputPolicy {
                mode: "custom".to_owned(),
                root_directory: Some(output_root.to_string_lossy().into_owned()),
                txt_enabled: true,
                markdown_enabled: true,
                preserve_source_txt: false,
                conflict_policy: "auto_rename".to_owned(),
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
