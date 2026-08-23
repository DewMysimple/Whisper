---
type: knowledge
status: active
kind: module
importance: high
updated: 2026-08-23
topic: worker-desktop-ipc
source_logs:
  - "[[日志/2026-08-23-项目记忆重建]]"
supersedes: null
---

# Worker 与 Desktop IPC

- `worker/runtime.py` 管理命令、单 dispatcher、模型缓存、任务取消、生命周期和事件。
- `worker/stdio.py` 负责 UTF-8 JSON-lines 输入输出；stdout 只能发送协议消息。
- `protocol/desktop_ipc.py` 与 `contracts/desktop_ipc/v1/desktop_ipc.schema.json` 一起定义 v1 command/event/error 和事件序列校验。
- Rust `worker_host.rs` 启动和监管 Worker，解析并校验消息；React 通过 typed `DesktopBridge` 消费结果。

任务输入会冻结模型、Preset、硬件、输出计划和参数；模型可连续复用，空闲后释放。改变字段、错误码、事件顺序或生命周期必须同步更新跨语言测试。
