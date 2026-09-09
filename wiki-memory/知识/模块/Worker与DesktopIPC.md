---
type: knowledge
status: active
kind: module
importance: high
updated: 2026-09-09
topic: worker-desktop-ipc
source_logs:
  - "[[日志/2026-08-23-项目记忆重建]]"
  - "[[日志/2026-08-24-架构瘦身实施]]"
  - "[[日志/2026-08-24-架构瘦身收口]]"
  - "[[日志/2026-09-09-工程定期维护]]"
supersedes: null
---

# Worker 与 Desktop IPC

- `worker/runtime.py` 管理命令、单 dispatcher、任务取消、生命周期和事件；`worker/media.py` 负责输入路径归一化、展开和时长探测；`worker/task_execution.py` 负责单任务执行与输出适配；`worker/runtime_types.py` 保存共享类型和稳定错误；`worker/model_cache.py` 管理模型复用/释放，`worker/task.py` 定义队列任务数据。
- `worker/stdio.py` 负责 UTF-8 JSON-lines 输入输出；stdout 只能发送协议消息。
- `protocol/desktop_ipc.py` 保留 v1 command/event/error 对象与生命周期；`desktop_ipc_validation.py` 负责公共字段和事件结构，`desktop_ipc_quality.py` 负责质量诊断结构；它们与 `contracts/desktop_ipc/v1/desktop_ipc.schema.json` 一起构成协议校验面。
- Rust `worker_host.rs` 启动和监管 Worker、发送命令；`worker_host/model_catalog.rs` 是生成的模型能力投影，`models.rs`、`media.rs`、`logs.rs` 和 `validation.rs` 分别负责模型、媒体、日志诊断和启动 draft 校验；`protocol_quality.rs` 负责 Rust 侧质量诊断校验；React 通过 typed `DesktopBridge` 消费结果。

任务输入会冻结模型、Preset、硬件、输出计划和参数；模型可连续复用，空闲后释放。改变字段、错误码、事件顺序或生命周期必须同步更新跨语言测试。
