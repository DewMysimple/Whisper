mod protocol;
mod worker_host;

use std::path::PathBuf;
use std::process::Command;
use std::sync::Arc;
use std::time::Duration;

use serde::Serialize;
use serde_json::Value;
use tauri::{Emitter, Manager, State};

#[cfg(windows)]
use std::os::windows::process::CommandExt;
use worker_host::{
    EventSink, HostError, HostStatus, InspectedInput, StartDraft, StartResult, WorkerManager,
    inspect_input_paths,
};

struct HostState(Arc<WorkerManager>);

const OUTPUT_PREVIEW_LIMIT: usize = 128 * 1024;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct OutputPreview {
    path: String,
    content: String,
    truncated: bool,
}

#[tauri::command]
fn get_host_status(state: State<'_, HostState>) -> HostStatus {
    state.0.status()
}

#[tauri::command]
fn get_worker_logs(state: State<'_, HostState>) -> Vec<String> {
    state.0.logs()
}

#[tauri::command]
fn inspect_inputs(paths: Vec<String>, origin: String) -> Vec<InspectedInput> {
    inspect_input_paths(paths, origin)
}

#[tauri::command]
fn reveal_output(path: String) -> Result<(), HostError> {
    let canonical = std::fs::canonicalize(&path).map_err(|error| {
        HostError::new(
            "host.output_not_found",
            format!("output path cannot be opened: {error}"),
        )
    })?;
    if !canonical.is_file() && !canonical.is_dir() {
        return Err(HostError::new(
            "host.output_not_found",
            "output path is not a file or directory",
        ));
    }

    let mut command = Command::new("explorer.exe");
    if canonical.is_file() {
        command.arg("/select,");
    }
    command.arg(canonical);
    #[cfg(windows)]
    command.creation_flags(0x0800_0000);
    command
        .spawn()
        .map(|_| ())
        .map_err(|error| HostError::new("host.output_open_failed", error.to_string()))
}

#[tauri::command]
fn read_output_preview(path: String) -> Result<OutputPreview, HostError> {
    let canonical = std::fs::canonicalize(&path).map_err(|error| {
        HostError::new(
            "host.output_not_found",
            format!("output path cannot be previewed: {error}"),
        )
    })?;
    if !canonical.is_file() {
        return Err(HostError::new(
            "host.output_not_found",
            "output preview requires an existing file",
        ));
    }
    let supported = canonical
        .extension()
        .and_then(|value| value.to_str())
        .is_some_and(|value| matches!(value.to_ascii_lowercase().as_str(), "txt" | "md"));
    if !supported {
        return Err(HostError::new(
            "host.output_preview_unsupported",
            "only TXT and Markdown outputs can be previewed",
        ));
    }
    let bytes = std::fs::read(&canonical)
        .map_err(|error| HostError::new("host.output_read_failed", error.to_string()))?;
    let truncated = bytes.len() > OUTPUT_PREVIEW_LIMIT;
    let visible = &bytes[..bytes.len().min(OUTPUT_PREVIEW_LIMIT)];
    Ok(OutputPreview {
        path: canonical.to_string_lossy().into_owned(),
        content: String::from_utf8_lossy(visible).into_owned(),
        truncated,
    })
}

#[tauri::command]
async fn restart_worker(state: State<'_, HostState>) -> Result<HostStatus, HostError> {
    let manager = Arc::clone(&state.0);
    tauri::async_runtime::spawn_blocking(move || manager.restart())
        .await
        .map_err(|error| HostError::new("host.task_failed", error.to_string()))?
}

#[tauri::command]
async fn worker_environment(state: State<'_, HostState>) -> Result<Value, HostError> {
    let manager = Arc::clone(&state.0);
    tauri::async_runtime::spawn_blocking(move || manager.environment())
        .await
        .map_err(|error| HostError::new("host.task_failed", error.to_string()))?
}

#[tauri::command]
async fn worker_health(state: State<'_, HostState>) -> Result<Value, HostError> {
    let manager = Arc::clone(&state.0);
    tauri::async_runtime::spawn_blocking(move || manager.health())
        .await
        .map_err(|error| HostError::new("host.task_failed", error.to_string()))?
}

#[tauri::command]
async fn worker_metrics(state: State<'_, HostState>) -> Result<Value, HostError> {
    let manager = Arc::clone(&state.0);
    tauri::async_runtime::spawn_blocking(move || manager.metrics())
        .await
        .map_err(|error| HostError::new("host.task_failed", error.to_string()))?
}

#[tauri::command]
async fn start_transcription(
    state: State<'_, HostState>,
    draft: StartDraft,
) -> Result<StartResult, HostError> {
    let manager = Arc::clone(&state.0);
    tauri::async_runtime::spawn_blocking(move || manager.start_transcription(draft))
        .await
        .map_err(|error| HostError::new("host.task_failed", error.to_string()))?
}

#[tauri::command]
async fn cancel_transcription(
    state: State<'_, HostState>,
    task_id: String,
) -> Result<(), HostError> {
    let manager = Arc::clone(&state.0);
    tauri::async_runtime::spawn_blocking(move || manager.cancel_transcription(&task_id))
        .await
        .map_err(|error| HostError::new("host.task_failed", error.to_string()))?
}

fn repository_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(3)
        .map(PathBuf::from)
        .expect("desktop crate must live at apps/desktop/src-tauri")
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            get_host_status,
            get_worker_logs,
            inspect_inputs,
            reveal_output,
            read_output_preview,
            restart_worker,
            worker_environment,
            worker_health,
            worker_metrics,
            start_transcription,
            cancel_transcription,
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            let sink: EventSink = Arc::new(move |channel, payload| {
                let _ = handle.emit(channel, payload);
            });
            let manager = WorkerManager::new(repository_root(), sink);
            app.manage(HostState(Arc::clone(&manager)));
            tauri::async_runtime::spawn_blocking(move || {
                let _ = manager.start();
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building WhisperSubtitle desktop host");

    app.run(|handle, event| {
        if matches!(event, tauri::RunEvent::ExitRequested { .. })
            && let Some(state) = handle.try_state::<HostState>()
        {
            state.0.shutdown(Duration::from_secs(15));
        }
    });
}

#[cfg(test)]
mod tests {
    use super::{read_output_preview, repository_root};

    #[test]
    fn previews_only_bounded_text_outputs() {
        let path = repository_root()
            .join("tests")
            .join("golden")
            .join("cn_real_output.txt");
        let preview = read_output_preview(path.to_string_lossy().into_owned()).expect("preview");
        assert!(!preview.content.is_empty());
        assert!(!preview.truncated);
    }

    #[test]
    fn rejects_non_text_output_preview() {
        let path = repository_root()
            .join("tests")
            .join("fixtures")
            .join("chinese_short.wav");
        let error = read_output_preview(path.to_string_lossy().into_owned()).unwrap_err();
        assert_eq!(error.code, "host.output_preview_unsupported");
    }
}
