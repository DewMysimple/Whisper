---
type: decision
status: active
kind: architecture
importance: high
updated: 2026-08-23
topic: desktop-architecture
source_logs:
  - "[[日志/2026-08-23-项目记忆重建]]"
supersedes: null
---

# ADR-001：Tauri 2 + React/TypeScript + Python Worker

## 决策

正式桌面应用采用 Tauri 2 / React/TypeScript WebView2 + Rust Host + 常驻 Python Worker。既有 Python domain/application/infrastructure 继续作为转录和推理事实来源，不重写为 Rust。

## 原因

- 复用已由 golden、真实 CUDA 和自动化测试保护的 Python 核心。
- 通过常驻 Worker 复用模型，并获得取消、关闭、崩溃和生命周期边界。
- 用 Tauri 的本地窗口、权限和 sidecar 能力提供 Windows EXE，而不引入浏览器服务。

## 影响

- 工程同时维护 Python、Rust 和 TypeScript。
- 跨语言 Desktop IPC 必须版本化并有一致性测试。
- 发布必须同时验证 WebView2、Worker、CUDA 运行时和模型布局。

## 来源

当前详细 ADR：`docs/architecture/adr/0001-tauri-react-python-worker.md`。
