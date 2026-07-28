use std::ffi::OsStr;
use std::os::windows::ffi::OsStrExt;
use std::path::PathBuf;

use tauri::{AppHandle, Manager};
use tauri_winrt_notification::{Duration as ToastDuration, IconCrop, Toast};
use windows_sys::Win32::UI::Shell::SetCurrentProcessExplicitAppUserModelID;
use winreg::RegKey;
use winreg::enums::HKEY_CURRENT_USER;

pub const APP_USER_MODEL_ID: &str = "local.whispersubtitle.desktop";
const APP_DISPLAY_NAME: &str = "WhisperSubtitle";
const NOTIFICATION_ICON: &[u8] = include_bytes!("../../../web/src/assets/mysimple-logo.png");

fn notification_icon_path() -> Result<PathBuf, String> {
    let local_app_data = std::env::var_os("LOCALAPPDATA")
        .ok_or_else(|| "Windows LOCALAPPDATA is unavailable".to_owned())?;
    let app_data = PathBuf::from(local_app_data).join(APP_DISPLAY_NAME);
    std::fs::create_dir_all(&app_data)
        .map_err(|error| format!("notification icon directory could not be created: {error}"))?;
    let icon_path = app_data.join("notification-logo.png");
    let needs_update = std::fs::read(&icon_path)
        .map(|existing| existing != NOTIFICATION_ICON)
        .unwrap_or(true);
    if needs_update {
        std::fs::write(&icon_path, NOTIFICATION_ICON)
            .map_err(|error| format!("notification icon could not be written: {error}"))?;
    }
    Ok(icon_path)
}

fn set_process_app_id() -> Result<(), String> {
    let wide: Vec<u16> = OsStr::new(APP_USER_MODEL_ID)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let result = unsafe { SetCurrentProcessExplicitAppUserModelID(wide.as_ptr()) };
    if result < 0 {
        return Err(format!(
            "Windows AppUserModelID could not be applied (HRESULT 0x{:08X})",
            result as u32
        ));
    }
    Ok(())
}

pub fn ensure_app_identity() -> Result<PathBuf, String> {
    let icon_path = notification_icon_path()?;
    let current_user = RegKey::predef(HKEY_CURRENT_USER);
    let (app_key, _) = current_user
        .create_subkey(format!(
            r"Software\Classes\AppUserModelId\{APP_USER_MODEL_ID}"
        ))
        .map_err(|error| format!("notification app identity could not be registered: {error}"))?;
    app_key
        .set_value("DisplayName", &APP_DISPLAY_NAME)
        .and_then(|_| app_key.set_value("IconBackgroundColor", &"0"))
        .and_then(|_| app_key.set_value("IconUri", &icon_path.to_string_lossy().into_owned()))
        .map_err(|error| format!("notification app identity could not be configured: {error}"))?;
    set_process_app_id()?;
    Ok(icon_path)
}

fn heading(status: &str) -> Result<&'static str, String> {
    match status {
        "completed" => Ok("转录任务已完成"),
        "failed" => Ok("转录任务需要处理"),
        "cancelled" => Ok("转录任务已取消"),
        "power" => Ok("WhisperSubtitle 电源操作"),
        _ => Err(format!("unsupported task notification status: {status}")),
    }
}

fn focus_main_window(app: &AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "WhisperSubtitle main window is unavailable".to_owned())?;
    window
        .show()
        .map_err(|error| format!("main window could not be shown: {error}"))?;
    window
        .unminimize()
        .map_err(|error| format!("main window could not be restored: {error}"))?;
    window
        .set_focus()
        .map_err(|error| format!("main window could not be focused: {error}"))
}

pub fn show_task_notification(
    app: &AppHandle,
    status: &str,
    task_title: &str,
    detail: &str,
) -> Result<(), String> {
    let icon_path = ensure_app_identity()?;
    let activation_handle = app.clone();
    Toast::new(APP_USER_MODEL_ID)
        .title(heading(status)?)
        .text1(task_title)
        .text2(detail)
        .icon(&icon_path, IconCrop::Circular, APP_DISPLAY_NAME)
        .duration(ToastDuration::Long)
        .add_button("返回 WhisperSubtitle", "open-app")
        .on_activated(move |_| {
            let _ = focus_main_window(&activation_handle);
            Ok(())
        })
        .sound(None)
        .show()
        .map_err(|error| format!("WhisperSubtitle notification could not be shown: {error}"))
}

#[cfg(test)]
mod tests {
    use super::heading;

    #[test]
    fn maps_only_supported_terminal_states() {
        assert_eq!(heading("completed").unwrap(), "转录任务已完成");
        assert_eq!(heading("failed").unwrap(), "转录任务需要处理");
        assert_eq!(heading("cancelled").unwrap(), "转录任务已取消");
        assert_eq!(heading("power").unwrap(), "WhisperSubtitle 电源操作");
        assert!(heading("running").is_err());
    }
}
