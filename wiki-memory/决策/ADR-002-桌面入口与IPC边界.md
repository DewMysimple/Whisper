---
type: decision
status: active
kind: architecture
importance: high
updated: 2026-08-23
topic: desktop-entry-and-ipc
source_logs:
  - "[[日志/2026-08-23-项目记忆重建]]"
supersedes: null
---

# ADR-002：桌面入口与 IPC 边界

## 决策

- 当前唯一开发和验收桌面入口为 `apps/desktop/src-tauri/target/release/whisper-subtitle-desktop.exe`。
- Tauri Host 是 WebView 与 Worker 的唯一运行时边界。
- Worker 通过 stdin/stdout 使用 Desktop IPC v1；Rust 先校验，再向 UI 转发。
- UI 不直接启动进程、不执行任意 shell、不访问 localhost；Rust 只开放精确 command 和受限输出预览。
- Python CLI 继续保留，正式桌面不再使用 PyQt5 或 VBS 启动层。

## 不得混淆

浏览器测试中的 mock bridge、Playwright 静态服务器和演示状态不等于正式桌面运行时。

## 来源

事实来源为 `contracts/desktop_ipc/v1/desktop_ipc.schema.json`、`apps/desktop/src-tauri/`、`apps/web/src/bridge/`、`docs/architecture/current_architecture.md`。
