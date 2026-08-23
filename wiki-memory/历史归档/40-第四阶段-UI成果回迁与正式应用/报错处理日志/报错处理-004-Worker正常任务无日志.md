# 报错处理 004：Worker 正常任务无日志

日期：2026-07-22。  
状态：已修复，已完成 Rust/前端/E2E 回归、正式 Worker 替换与 Tauri Release 构建；等待用户用可见正式任务核对日志可读性。

## 1. 用户可见现象

独立 Worker 日志工作台已经存在，但正常转录任务期间没有可见日志；任务正常结束后仍看不到任务生命周期。只有 Python 进程真实写入 `stderr` 时才可能出现内容。

该问题是 Rust Host 对 Worker 协议输出的展示缺口，不是 Worker 没有运行，也不是 Python 转录、CUDA、模型或 Preset 出错。

## 2. 根因

Rust Host 原本只把 Python Worker 的 `stderr` 行追加到日志缓冲。正常任务的权威状态全部通过 Worker `stdout` 上的 Desktop IPC v1 JSON 事件传递，并被 Host 解析、校验和转发给 React，但解析成功后没有生成供人阅读的日志行。

因此：

- 正常任务通常只发结构化协议事件，不写 stderr；
- UI 的 200 行缓冲自然为空；
- 直接显示原始 JSON 会泄漏实现细节且被高频性能轮询淹没，也不是合适修复。

## 3. 修复

Host 在协议消息完成真实解析和校验后，按事件生成带本地时间戳的摘要：

- Worker ready 与 PID；
- 模型 loading / ready、设备与 compute type；
- task queued 与真实媒体数量；
- 每一条 task progress 的阶段、current/total、媒体文件名和消息；
- task completed 的成功/失败/输出数；
- task failed 的错误码与消息；
- task cancelled 的原因；
- Worker error 与原始 stderr。

明确排除 `command.completed`。性能工作台会持续调用 `system.metrics`，这些完成事件没有任务诊断价值；若写入日志会很快挤掉真正的任务生命周期。

日志仍由 Host 保留当前会话最近 200 行，通过现有日志事件与获取命令提供给 UI。任务终态不会清空缓冲。不添加模拟事件，不修改 Desktop IPC v1。

## 4. UI 与辅助能力

- 默认滚动到底部跟随最新内容；
- 用户向上滚动时暂停跟随，回到底部后恢复；
- 浅色主题为浅灰底深色字，深色主题为近黑底浅色字；
- 日志框圆角，正文和操作区相对全局字号档增加约 3px；
- “复制全部”使用 Tauri Clipboard Manager；
- “导出 TXT”调用系统另存为对话框并由 Rust Host 以 UTF-8 写入；
- 空日志时两个操作禁用，完成或失败都有 UI 反馈。

## 5. 回归与正式产物

Rust 测试确认：

- 生命周期摘要包含任务短 ID、进度 `2/8` 和输入文件名；
- `command.completed` 返回 `None`，不会写入缓冲；
- 缓冲裁剪保留最后 200 行；
- `.txt` 导出内容为 UTF-8，非 TXT 路径被拒绝。

前端 Vitest、TypeScript、ESLint、生产构建和 Playwright 全部通过；Playwright 同时覆盖浅/深主题、字号、空日志按钮状态和独立工作台。正式 EXE 启动时成功拉起相邻冻结 Worker，正式冻结 Worker随后连续完成两个真实 CUDA 任务。

- Desktop SHA-256：`F1DCB6C607B1839A008F342D569DFBAEC56B1F64C0EC9C4FCEF527126687F329`
- Worker SHA-256：`476D1BE92E61BEBBCD884CD21F69664F4359CEEE7920A237E79450CC0FDEF028`

## 6. 边界与后续复验

- 没有修改 Python Worker 协议、Desktop IPC v1、转录算法、Preset 或 CUDA 行为；
- 没有把性能轮询或原始 JSON 当作任务日志；
- 没有生成安装程序、暂存或提交；
- 原正式 Desktop 和 Worker 保存在 CP5 可恢复检查点。

用户应在正式窗口启动一个短任务，确认日志在 ready、queued、progress、completed 后仍可见，再测试向上滚动、复制全部和另存为。若实际日志缺少某个真实事件，应保留日志文本和任务状态，新增独立报错记录，不应通过模拟日志补齐。
