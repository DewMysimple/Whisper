use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Serialize;

use crate::worker_host::{EventSink, HostError};

const POWER_EVENT: &str = "desktop://power-action";

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PowerCapabilities {
    pub shutdown: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PowerActionStatus {
    pub state: String,
    pub action: Option<String>,
    pub execute_at_epoch_ms: Option<u64>,
    pub error: Option<String>,
}

impl PowerActionStatus {
    fn idle() -> Self {
        Self {
            state: "idle".to_owned(),
            action: None,
            execute_at_epoch_ms: None,
            error: None,
        }
    }
}

trait PowerExecutor: Send + Sync {
    fn capabilities(&self) -> PowerCapabilities;
    fn execute(&self, action: &str) -> Result<(), String>;
}

struct SystemPowerExecutor;

#[cfg(windows)]
impl PowerExecutor for SystemPowerExecutor {
    fn capabilities(&self) -> PowerCapabilities {
        PowerCapabilities { shutdown: true }
    }

    fn execute(&self, action: &str) -> Result<(), String> {
        use std::os::windows::process::CommandExt;
        use std::process::Command;

        match action {
            "shutdown" => Command::new("shutdown.exe")
                .args(["/s", "/t", "0", "/d", "p:0:0"])
                .creation_flags(0x0800_0000)
                .spawn()
                .map(|_| ())
                .map_err(|error| format!("Windows shutdown request failed: {error}")),
            _ => Err("unsupported power action".to_owned()),
        }
    }
}

#[cfg(not(windows))]
impl PowerExecutor for SystemPowerExecutor {
    fn capabilities(&self) -> PowerCapabilities {
        PowerCapabilities { shutdown: false }
    }

    fn execute(&self, _action: &str) -> Result<(), String> {
        Err("power actions are only supported on Windows".to_owned())
    }
}

struct PowerInner {
    generation: u64,
    status: PowerActionStatus,
    active_tasks: HashSet<String>,
    recent_terminal: HashMap<String, String>,
}

pub struct PowerManager {
    inner: Arc<Mutex<PowerInner>>,
    sink: EventSink,
    notice_sink: Arc<dyn Fn(u64) + Send + Sync>,
    executor: Arc<dyn PowerExecutor>,
}

impl PowerManager {
    pub fn new(sink: EventSink, notice_sink: Arc<dyn Fn(u64) + Send + Sync>) -> Arc<Self> {
        Self::with_executor(sink, notice_sink, Arc::new(SystemPowerExecutor))
    }

    fn with_executor(
        sink: EventSink,
        notice_sink: Arc<dyn Fn(u64) + Send + Sync>,
        executor: Arc<dyn PowerExecutor>,
    ) -> Arc<Self> {
        Arc::new(Self {
            inner: Arc::new(Mutex::new(PowerInner {
                generation: 0,
                status: PowerActionStatus::idle(),
                active_tasks: HashSet::new(),
                recent_terminal: HashMap::new(),
            })),
            sink,
            notice_sink,
            executor,
        })
    }

    pub fn capabilities(&self) -> PowerCapabilities {
        self.executor.capabilities()
    }

    pub fn status(&self) -> PowerActionStatus {
        self.inner
            .lock()
            .map(|inner| inner.status.clone())
            .unwrap_or_else(|_| PowerActionStatus {
                state: "failed".to_owned(),
                action: None,
                execute_at_epoch_ms: None,
                error: Some("power action state is unavailable".to_owned()),
            })
    }

    pub fn arm(
        self: &Arc<Self>,
        task_id: &str,
        action: String,
    ) -> Result<PowerActionStatus, HostError> {
        self.ensure_supported(&action)?;
        let start_countdown = {
            let mut inner = self
                .inner
                .lock()
                .map_err(|_| HostError::new("host.internal", "power state lock was poisoned"))?;
            let terminal = inner.recent_terminal.get(task_id).cloned();
            if terminal
                .as_deref()
                .is_some_and(|state| state != "completed")
            {
                return Err(HostError::new(
                    "host.power_not_armed",
                    "the accepted task did not complete successfully",
                ));
            }
            if terminal.is_none() && !inner.active_tasks.contains(task_id) {
                return Err(HostError::new(
                    "host.power_not_armed",
                    "the accepted task is not tracked by the desktop host",
                ));
            }
            inner.generation = inner.generation.wrapping_add(1);
            inner.status = PowerActionStatus {
                state: "armed".to_owned(),
                action: Some(action.clone()),
                execute_at_epoch_ms: None,
                error: None,
            };
            terminal.as_deref() == Some("completed") && inner.active_tasks.is_empty()
        };
        if start_countdown {
            self.schedule(action, 60)
        } else {
            self.emit_status();
            Ok(self.status())
        }
    }

    pub fn observe_worker_message(self: &Arc<Self>, message: &serde_json::Value) {
        let event = message.get("event").and_then(serde_json::Value::as_str);
        let task_id = message
            .get("task_id")
            .and_then(serde_json::Value::as_str)
            .map(str::to_owned);
        let mut start_countdown = None;
        let mut emit_status = false;
        if let Ok(mut inner) = self.inner.lock() {
            if message.get("type").and_then(serde_json::Value::as_str) == Some("error")
                && matches!(inner.status.state.as_str(), "armed" | "countdown")
            {
                inner.generation = inner.generation.wrapping_add(1);
                inner.status = PowerActionStatus::idle();
                emit_status = true;
            }
            match (event, task_id.as_deref()) {
                (Some("task.queued"), Some(task_id)) => {
                    inner.active_tasks.insert(task_id.to_owned());
                    inner.recent_terminal.remove(task_id);
                    if inner.status.state == "countdown" {
                        inner.generation = inner.generation.wrapping_add(1);
                        inner.status = PowerActionStatus::idle();
                        emit_status = true;
                    }
                }
                (Some("task.completed"), Some(task_id))
                    if message
                        .get("data")
                        .and_then(|data| data.get("failure_count"))
                        .and_then(serde_json::Value::as_u64)
                        .unwrap_or(0)
                        == 0 =>
                {
                    inner.active_tasks.remove(task_id);
                    remember_terminal(&mut inner, task_id, "completed");
                    if inner.status.state == "armed" && inner.active_tasks.is_empty() {
                        start_countdown = inner.status.action.clone();
                    }
                }
                (Some("task.failed" | "task.cancelled" | "task.completed"), Some(task_id)) => {
                    inner.active_tasks.remove(task_id);
                    remember_terminal(
                        &mut inner,
                        task_id,
                        event.unwrap_or("task.failed").trim_start_matches("task."),
                    );
                    if matches!(inner.status.state.as_str(), "armed" | "countdown") {
                        inner.generation = inner.generation.wrapping_add(1);
                        inner.status = PowerActionStatus::idle();
                        emit_status = true;
                    }
                }
                _ => {}
            }
        }
        if let Some(action) = start_countdown {
            let _ = self.schedule(action, 60);
        } else if emit_status {
            self.emit_status();
        }
    }

    pub fn schedule(
        self: &Arc<Self>,
        action: String,
        delay_seconds: u64,
    ) -> Result<PowerActionStatus, HostError> {
        self.ensure_supported(&action)?;
        if !(1..=300).contains(&delay_seconds) {
            return Err(HostError::new(
                "request.invalid",
                "power countdown must be between 1 and 300 seconds",
            ));
        }

        let execute_at_epoch_ms = epoch_ms().saturating_add(delay_seconds.saturating_mul(1000));
        let generation = {
            let mut inner = self
                .inner
                .lock()
                .map_err(|_| HostError::new("host.internal", "power state lock was poisoned"))?;
            inner.generation = inner.generation.wrapping_add(1);
            inner.status = PowerActionStatus {
                state: "countdown".to_owned(),
                action: Some(action.clone()),
                execute_at_epoch_ms: Some(execute_at_epoch_ms),
                error: None,
            };
            inner.generation
        };
        self.emit_status();

        let manager = Arc::clone(self);
        thread::spawn(move || {
            let deadline = std::time::Instant::now() + Duration::from_secs(delay_seconds);
            let mut previous_remaining = delay_seconds;
            let mut sent_milestones = HashSet::new();
            loop {
                thread::sleep(Duration::from_millis(200));
                let now = std::time::Instant::now();
                let remaining = deadline
                    .checked_duration_since(now)
                    .map(duration_seconds_ceil)
                    .unwrap_or(0);
                if !manager.emit_due_milestones(
                    generation,
                    previous_remaining,
                    remaining,
                    &mut sent_milestones,
                ) {
                    return;
                }
                previous_remaining = remaining;
                if now >= deadline {
                    break;
                }
            }
            if !manager.mark_executing(generation) {
                return;
            }
            manager.emit_status();
            if let Err(error) = manager.executor.execute(&action) {
                manager.mark_failed(generation, error);
                manager.emit_status();
            }
        });
        Ok(self.status())
    }

    fn ensure_supported(&self, action: &str) -> Result<(), HostError> {
        let capabilities = self.capabilities();
        let supported = action == "shutdown" && capabilities.shutdown;
        if supported {
            Ok(())
        } else {
            Err(HostError::new(
                "host.power_unsupported",
                "the requested Windows power action is unavailable",
            ))
        }
    }

    pub fn cancel(&self) -> PowerActionStatus {
        if let Ok(mut inner) = self.inner.lock() {
            inner.generation = inner.generation.wrapping_add(1);
            inner.status = PowerActionStatus::idle();
        }
        self.emit_status();
        self.status()
    }

    fn is_current_countdown(&self, generation: u64) -> bool {
        self.inner
            .lock()
            .is_ok_and(|inner| inner.generation == generation && inner.status.state == "countdown")
    }

    fn emit_due_milestones(
        &self,
        generation: u64,
        previous_remaining: u64,
        remaining: u64,
        sent: &mut HashSet<u64>,
    ) -> bool {
        if !self.is_current_countdown(generation) {
            return false;
        }
        for milestone in [30, 15, 5] {
            if previous_remaining > milestone && remaining <= milestone && sent.insert(milestone) {
                (self.notice_sink)(milestone);
            }
        }
        true
    }

    fn mark_executing(&self, generation: u64) -> bool {
        let Ok(mut inner) = self.inner.lock() else {
            return false;
        };
        if inner.generation != generation || inner.status.state != "countdown" {
            return false;
        }
        inner.status.state = "executing".to_owned();
        true
    }

    fn mark_failed(&self, generation: u64, error: String) {
        if let Ok(mut inner) = self.inner.lock()
            && inner.generation == generation
        {
            inner.status.state = "failed".to_owned();
            inner.status.error = Some(error);
        }
    }

    fn emit_status(&self) {
        (self.sink)(
            POWER_EVENT,
            serde_json::to_value(self.status()).unwrap_or_default(),
        );
    }
}

fn remember_terminal(inner: &mut PowerInner, task_id: &str, state: &str) {
    if inner.recent_terminal.len() >= 128
        && let Some(oldest) = inner.recent_terminal.keys().next().cloned()
    {
        inner.recent_terminal.remove(&oldest);
    }
    inner
        .recent_terminal
        .insert(task_id.to_owned(), state.to_owned());
}

fn epoch_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(u64::MAX)
}

fn duration_seconds_ceil(duration: Duration) -> u64 {
    duration
        .as_secs()
        .saturating_add(u64::from(duration.subsec_nanos() > 0))
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};

    use super::*;

    struct FakeExecutor {
        calls: AtomicUsize,
    }

    impl PowerExecutor for FakeExecutor {
        fn capabilities(&self) -> PowerCapabilities {
            PowerCapabilities { shutdown: true }
        }

        fn execute(&self, _action: &str) -> Result<(), String> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            Ok(())
        }
    }

    #[test]
    fn cancellation_prevents_the_armed_action() {
        let executor = Arc::new(FakeExecutor {
            calls: AtomicUsize::new(0),
        });
        let manager =
            PowerManager::with_executor(Arc::new(|_, _| {}), Arc::new(|_| {}), executor.clone());
        manager
            .schedule("shutdown".to_owned(), 1)
            .expect("schedule");
        assert_eq!(manager.status().state, "countdown");
        manager.cancel();
        thread::sleep(Duration::from_millis(1200));
        assert_eq!(executor.calls.load(Ordering::SeqCst), 0);
        assert_eq!(manager.status().state, "idle");
    }

    #[test]
    fn completed_queue_starts_countdown_and_failure_cancels_arming() {
        let executor = Arc::new(FakeExecutor {
            calls: AtomicUsize::new(0),
        });
        let manager = PowerManager::with_executor(Arc::new(|_, _| {}), Arc::new(|_| {}), executor);
        manager.observe_worker_message(&serde_json::json!({
            "event": "task.queued",
            "task_id": "task-1"
        }));
        manager
            .arm("task-1", "shutdown".to_owned())
            .expect("arm tracked task");
        assert_eq!(manager.status().state, "armed");
        manager.observe_worker_message(&serde_json::json!({
            "event": "task.completed",
            "task_id": "task-1"
        }));
        assert_eq!(manager.status().state, "countdown");
        manager.observe_worker_message(&serde_json::json!({
            "event": "task.queued",
            "task_id": "task-2"
        }));
        assert_eq!(manager.status().state, "idle");

        manager
            .arm("task-2", "shutdown".to_owned())
            .expect("arm second task");
        manager.observe_worker_message(&serde_json::json!({
            "event": "task.failed",
            "task_id": "task-2"
        }));
        assert_eq!(manager.status().state, "idle");
    }

    #[test]
    fn rejects_removed_hibernate_action() {
        let executor = Arc::new(FakeExecutor {
            calls: AtomicUsize::new(0),
        });
        let manager = PowerManager::with_executor(Arc::new(|_, _| {}), Arc::new(|_| {}), executor);
        let error = manager
            .schedule("hibernate".to_owned(), 60)
            .expect_err("hibernate must be unavailable");
        assert_eq!(error.code, "host.power_unsupported");
    }

    #[test]
    fn emits_each_crossed_shutdown_milestone_once() {
        let executor = Arc::new(FakeExecutor {
            calls: AtomicUsize::new(0),
        });
        let notices = Arc::new(Mutex::new(Vec::new()));
        let notice_capture = Arc::clone(&notices);
        let manager = PowerManager::with_executor(
            Arc::new(|_, _| {}),
            Arc::new(move |seconds| notice_capture.lock().unwrap().push(seconds)),
            executor,
        );
        manager
            .schedule("shutdown".to_owned(), 60)
            .expect("schedule");
        let generation = manager.inner.lock().unwrap().generation;
        let mut sent = HashSet::new();
        assert!(manager.emit_due_milestones(generation, 60, 29, &mut sent));
        assert!(manager.emit_due_milestones(generation, 29, 14, &mut sent));
        assert!(manager.emit_due_milestones(generation, 14, 4, &mut sent));
        assert!(manager.emit_due_milestones(generation, 4, 0, &mut sent));
        assert_eq!(*notices.lock().unwrap(), vec![30, 15, 5]);
        manager.cancel();
    }
}
