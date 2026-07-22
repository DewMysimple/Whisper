mod protocol;
#[cfg(windows)]
mod windows_notification;
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
    BridgeHardwarePreference, EventSink, HostError, HostStatus, InspectedInput,
    LocalModelDescriptor, StartDraft, StartResult, WorkerManager, inspect_input_paths,
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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct OutputPathStatus {
    path: String,
    exists: bool,
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
fn write_worker_log_export(path: String, content: String) -> Result<String, HostError> {
    let requested = PathBuf::from(path);
    let is_txt = requested
        .extension()
        .and_then(|value| value.to_str())
        .is_some_and(|value| value.eq_ignore_ascii_case("txt"));
    if !is_txt {
        return Err(HostError::new(
            "host.log_export_invalid",
            "Worker logs must be exported as a .txt file",
        ));
    }
    let file_name = requested.file_name().ok_or_else(|| {
        HostError::new("host.log_export_invalid", "Worker log filename is missing")
    })?;
    let parent = requested.parent().ok_or_else(|| {
        HostError::new("host.log_export_invalid", "Worker log directory is missing")
    })?;
    let canonical_parent = std::fs::canonicalize(parent).map_err(|error| {
        HostError::new(
            "host.log_export_invalid",
            format!("Worker log directory cannot be opened: {error}"),
        )
    })?;
    let destination = canonical_parent.join(file_name);
    std::fs::write(&destination, content.as_bytes()).map_err(|error| {
        HostError::new(
            "host.log_export_failed",
            format!("Worker log could not be written: {error}"),
        )
    })?;
    Ok(destination.to_string_lossy().into_owned())
}

#[cfg(windows)]
#[tauri::command]
fn play_notification_sound(kind: String) -> Result<(), String> {
    use windows_sys::Win32::System::Diagnostics::Debug::MessageBeep;
    use windows_sys::Win32::UI::WindowsAndMessaging::{MB_ICONASTERISK, MB_ICONEXCLAMATION};

    let sound = if kind == "completed" {
        MB_ICONASTERISK
    } else {
        MB_ICONEXCLAMATION
    };
    let succeeded = unsafe { MessageBeep(sound) };
    if succeeded == 0 {
        return Err("Windows system notification sound could not be played".to_owned());
    }
    Ok(())
}

#[cfg(not(windows))]
#[tauri::command]
fn play_notification_sound(_kind: String) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
fn show_app_notification(status: String, title: String, detail: String) -> Result<(), String> {
    let _ = play_notification_sound(status.clone());
    #[cfg(windows)]
    {
        windows_notification::show_task_notification(&status, &title, &detail)
    }
    #[cfg(not(windows))]
    {
        let _ = (status, title, detail);
        Ok(())
    }
}

#[tauri::command]
fn inspect_inputs(paths: Vec<String>, origin: String) -> Vec<InspectedInput> {
    inspect_input_paths(paths, origin)
}

#[tauri::command]
fn inspect_output_paths(paths: Vec<String>) -> Vec<OutputPathStatus> {
    paths
        .into_iter()
        .map(|path| OutputPathStatus {
            exists: PathBuf::from(&path).is_file(),
            path,
        })
        .collect()
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
        .is_some_and(|value| matches!(value.to_ascii_lowercase().as_str(), "txt" | "md" | "srt"));
    if !supported {
        return Err(HostError::new(
            "host.output_preview_unsupported",
            "only TXT, Markdown and SRT outputs can be previewed",
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
fn list_local_models(state: State<'_, HostState>) -> Vec<LocalModelDescriptor> {
    state.0.local_models()
}

#[tauri::command]
fn open_model_directory(state: State<'_, HostState>) -> Result<String, HostError> {
    let root = state.0.model_root();
    std::fs::create_dir_all(&root).map_err(|error| {
        HostError::new(
            "host.model_directory_failed",
            format!("model directory could not be created: {error}"),
        )
    })?;
    let canonical = std::fs::canonicalize(&root).map_err(|error| {
        HostError::new(
            "host.model_directory_failed",
            format!("model directory could not be opened: {error}"),
        )
    })?;
    let mut command = Command::new("explorer.exe");
    command.arg(&canonical);
    #[cfg(windows)]
    command.creation_flags(0x0800_0000);
    command
        .spawn()
        .map_err(|error| HostError::new("host.model_directory_failed", error.to_string()))?;
    Ok(canonical.to_string_lossy().into_owned())
}

#[tauri::command]
async fn load_model(
    state: State<'_, HostState>,
    model_id: String,
    hardware: Option<BridgeHardwarePreference>,
) -> Result<Value, HostError> {
    let manager = Arc::clone(&state.0);
    tauri::async_runtime::spawn_blocking(move || manager.load_model(&model_id, hardware))
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
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            get_host_status,
            get_worker_logs,
            write_worker_log_export,
            play_notification_sound,
            show_app_notification,
            inspect_inputs,
            inspect_output_paths,
            reveal_output,
            read_output_preview,
            restart_worker,
            worker_environment,
            worker_health,
            worker_metrics,
            list_local_models,
            open_model_directory,
            load_model,
            start_transcription,
            cancel_transcription,
        ])
        .setup(|app| {
            #[cfg(windows)]
            {
                let _ = windows_notification::ensure_app_identity();
            }
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
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::{
        inspect_output_paths, read_output_preview, repository_root, write_worker_log_export,
    };

    #[cfg(windows)]
    #[test]
    #[ignore = "plays one audible Windows system sound"]
    fn plays_windows_notification_sound() {
        super::play_notification_sound("completed".to_owned()).expect("system sound");
    }

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

    #[test]
    fn audits_existing_and_missing_output_paths() {
        let existing = repository_root()
            .join("tests")
            .join("golden")
            .join("cn_real_output.txt");
        let missing = repository_root()
            .join("tests")
            .join("golden")
            .join("missing-output.txt");
        let results = inspect_output_paths(vec![
            existing.to_string_lossy().into_owned(),
            missing.to_string_lossy().into_owned(),
        ]);
        assert!(results[0].exists);
        assert!(!results[1].exists);
    }

    #[test]
    fn exports_worker_logs_as_utf8_txt() {
        let root = std::env::temp_dir().join(format!(
            "whisper-subtitle-log-export-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system clock")
                .as_nanos()
        ));
        std::fs::create_dir_all(&root).expect("temporary export directory");
        let destination = root.join("worker-log.txt");
        let content = "[2026-07-22 02:00:00] [WORKER] ready\r\n";
        let written = write_worker_log_export(
            destination.to_string_lossy().into_owned(),
            content.to_owned(),
        )
        .expect("export worker log");
        assert_eq!(
            std::fs::read_to_string(written).expect("read export"),
            content
        );
        assert!(
            write_worker_log_export(
                root.join("worker-log.json").to_string_lossy().into_owned(),
                content.to_owned()
            )
            .is_err()
        );
        std::fs::remove_dir_all(root).expect("remove temporary export directory");
    }
}
