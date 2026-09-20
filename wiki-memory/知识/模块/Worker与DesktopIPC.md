---
type: knowledge
status: active
kind: module
importance: high
updated: 2026-09-20
topic: worker-desktop-ipc
source_logs:
  - "[[日志/2026-09-20-硬件优化与工作台统一及便携版更新]]"
  - "[[日志/2026-08-23-项目记忆重建]]"
  - "[[日志/2026-08-24-架构瘦身实施]]"
  - "[[日志/2026-08-24-架构瘦身收口]]"
  - "[[日志/2026-09-09-工程定期维护]]"
  - "[[日志/2026-09-17-删除硬件优化工作台]]"
  - "[[日志/2026-09-17-修复桌面IPC启动失败]]"
supersedes: null
---

# Worker 与 Desktop IPC

- `worker/runtime.py` 管理命令、单 dispatcher、任务取消、生命周期和事件；`worker/media.py` 负责输入路径归一化、展开和时长探测；`worker/task_execution.py` 负责单任务执行与输出适配；`worker/runtime_types.py` 保存共享类型和稳定错误；`worker/model_cache.py` 管理模型复用/释放，`worker/task.py` 定义队列任务数据。
- `worker/stdio.py` 负责 UTF-8 JSON-lines 输入输出；stdout 只能发送协议消息。
- `protocol/desktop_ipc.py` 保留 v1 command/event/error 对象与生命周期；`desktop_ipc_validation.py` 负责公共字段和事件结构，`desktop_ipc_quality.py` 负责质量诊断结构；它们与 `contracts/desktop_ipc/v1/desktop_ipc.schema.json` 一起构成协议校验面。
- Rust `worker_host.rs` 启动和监管 Worker、发送命令；`worker_host/model_catalog.rs` 是生成的模型能力投影，`models.rs`、`media.rs`、`logs.rs` 和 `validation.rs` 分别负责模型、媒体、日志诊断和启动 draft 校验；`protocol_quality.rs` 负责 Rust 侧质量诊断校验；React 通过 typed `DesktopBridge` 消费结果。

任务输入会冻结模型、Preset、输出计划和参数；Worker 在提交时解析可选 execution，再把实际 HardwareInfo 冻结并回传到 task.queued。省略执行设置保持历史自动设备／线程默认；显式设备或精度不支持时明确失败。相同模型和实际硬件配置才能连续复用缓存，空闲后释放。新执行设置见 [[决策/ADR-005-硬件执行设置与工作台]]，旧硬件偏好字段继续拒绝。`model.load`、`model.unload` 是冻结 Worker 仍会在握手中声明的 v1 兼容命令，不由当前 UI 调用，也不能附带硬件偏好。改变字段、错误码、事件顺序或生命周期必须同步更新跨语言测试和现有冻结 Worker 握手用例。

`system.environment` 保持空参数，在原环境结果上增加可选 hardware_capabilities；读取 CTranslate2 支持精度，NVML 只补充设备名称。能力探测失败返回 hardware_error，不改变原 available/errors。Rust `worker_host/option_validation.rs` 复用内嵌 schema 校验推理与执行设置，Python execution 校验与硬件解析分属 domain／infrastructure。
