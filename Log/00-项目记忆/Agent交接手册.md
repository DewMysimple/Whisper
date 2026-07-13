# Agent 交接手册

## 一句话说明

WhisperSubtitle 是面向 Windows 与 NVIDIA GPU 的本地离线字幕转录桌面应用，核心使用 faster-whisper/CTranslate2，提供中英文四种 preset、CLI、GUI、批量转录、后处理、原子输出和性能监控。

## 接手后先做什么

1. 阅读本文件、[当前工程状态](当前工程状态.md) 和[关键决策与用户约束](关键决策与用户约束.md)。
2. 执行 `git status --short`，区分用户本地文件与待实施变更。
3. 执行快速验证：

   ```powershell
   .\whisper_env\Scripts\python.exe -m pytest -q
   .\whisper_env\Scripts\python.exe -m whisper_subtitle check
   .\whisper_env\Scripts\python.exe -m pip check
   ```

4. 若准备实施下一代架构，先阅读[新架构愿景与技术选型](../10-未来架构/新架构愿景与技术选型.md)和[分阶段迁移路线](../10-未来架构/分阶段迁移路线.md)。
5. 一次只执行一个被用户确认的批次，不跨批次顺手改造。

## 已完成工作

### 三轮前置修复

- 解决原项目的环境、依赖、路径、CLI、GUI 设置和文件选择等基础问题。
- 建立标准 `src` 包布局与统一入口。
- 使用 RTX 5070 Ti 完成真实中英文音频回归。
- 建立 golden、benchmark 和第一批自动化测试。

### 模块化重构批次 00–10

- 将四套重复转录脚本收敛为唯一 `TranscriptionService`。
- 建立 `domain/application/infrastructure/presentation` 分层。
- 将 preset 收敛为类型化单一注册表。
- 将中英文后处理抽取为纯函数和策略链。
- 将媒体发现、原子输出、硬件探测、CUDA 运行时和 faster-whisper 封装为基础设施模块。
- GUI 统一通过 canonical CLI 和 JSONL 进度协议启动任务。
- 支持安装模式与便携模式，不再依赖固定源码层级。
- 发布依赖移除 torch/torchaudio/torchvision，环境体积下降约 71%。
- 经用户确认，旧 Core 和大写 GUI 兼容入口已发送到 Windows 回收站。
- 最终成果已提交为 `0b3a289`，未推送。

完整历史见[历史执行索引](../20-历史执行/README.md)。

## 当前实现与未来提案的边界

当前存在且可运行的是：

- Python 业务核心。
- PyQt5 GUI。
- CLI 与 JSONL 进度输出。
- GUI 通过 QProcess 启动短生命周期 Python 转录进程。

当前尚不存在的是：

- Tauri 2 工程。
- React/TypeScript 前端。
- Rust 桌面宿主。
- 常驻 Python Worker。
- JSON-RPC 双向 IPC。
- 新版 WebView 桌面表现层、任务历史、波形编辑和自动更新。

后续 Agent 必须把上述内容当作“待批准和分批实施的架构提案”，不能假设已经搭好骨架。

## 推荐的下一步

如果用户继续推进新架构，推荐从“新架构批次 0：架构决策与功能基线”开始，而不是直接删除 PyQt5 或创建完整前端。

第一批应只完成：

- 固化当前功能清单和截图基线。
- 编写 ADR，确认 Tauri 2 + React/TypeScript + Python Worker。
- 定义 monorepo 目录和责任边界。
- 定义 IPC schema 初稿。
- 明确 Node、Rust、WebView2、Python 和 CUDA 的版本策略。
- 不修改转录算法，不删除现有 GUI，不自动提交 Git。

## 当前待用户补回的本地文件

- `Log/40-原始需求/执行1.md`、`执行2.md`、`执行3.md` 已从 Git 原始 blob 恢复，哈希与 `HEAD` 完全一致。
- 原先未跟踪的 `Requirement/isolate.md` 在 2026-07-13 的目录整理期间随原 `Requirement` 进入 Windows 回收站，随后回收站对象被清除。
- 该文件从未进入 Git，工作区、F 盘、`.workbuddy` 和回收站均无可用副本，因此不能推测或伪造其内容。
- 用户重新提供 `isolate.md` 后，应原样放入 `F:\WhisperSubtitle\Log\40-原始需求\isolate.md`，不要改写。

## 容易误判的地方

- PyQt5 仍是当前正式 GUI；批次 10 删除的是旧大写兼容入口，不是整个 PyQt5 表现层。
- 当前 application 层仍为默认组合直接导入部分 infrastructure；它是实用型分层，不是完全端口适配器架构。
- `ProgressEvent` 虽然结构化，但 message 仍包含中文展示文本；下一代 IPC 需要稳定事件码和数据字段。
- GUI 已从 1189 行单体拆开，但 `main_window.py` 和 `widgets/panels.py` 仍各约 550 行。
- 当前环境测试通过不等于新打包形态通过；涉及依赖、CUDA 或桌面壳时必须重新做从零安装和真实 GPU 验证。
- 历史报告中的 Git 状态只代表报告生成时刻。

## 完成标准

任何架构迁移批次至少应验证：

- Python 全量测试。
- IPC/前端新增测试。
- 环境自检与 `pip check`。
- CLI 继续可用。
- 现有 golden 输出不被静默改变。
- 涉及推理或打包时执行真实 CUDA 音频回归。
- `.workbuddy` 未修改、未删除。
- 未经用户要求不自动提交或推送。
