# 批次 7：正式切换与 PyQt5 退役

状态：`Implementation Complete / User Acceptance Pending`（2026-07-16）。

用户在批次 6 报告后明确提示“执行批次7”，因此批次 6 记为验收通过，同时构成计划要求的 PyQt5 最终退役单独确认。

本批次将 Tauri/WebView2 `whisper-subtitle-desktop.exe` 设为唯一桌面入口，保留 Python `transcribe/check/worker` CLI，退役 Python `gui` 子命令，并把 `src/whisper_subtitle/presentation/gui/`、两个 PyQt5 专属测试及 VBS 启动器送入 Windows 回收站。PyQt5 与 VBS 已从项目运行和发布入口中移除。

安装版通过 Windows 快捷方式或安装目录 EXE 启动；便携版直接运行同目录 EXE。它不调用外部 Python，不打开浏览器，也不启动 HTTP/WebSocket/localhost 服务。

发布入口：

- `dist/release/WhisperSubtitle-portable/whisper-subtitle-desktop.exe`
- `dist/release/WhisperSubtitle-offline-installer/WhisperSubtitle_0.1.0_x64-setup.exe`

详细证据见[执行报告](执行报告.md)和[结构化验证记录](validation.json)。
