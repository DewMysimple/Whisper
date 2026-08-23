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

4. 若准备实施下一代架构或后续桌面阶段，先阅读[第二阶段索引](../20-第二阶段-Tauri桌面架构迁移/README.md)、[新架构愿景与技术选型](../20-第二阶段-Tauri桌面架构迁移/新架构愿景与技术选型.md)和[分阶段迁移路线](../20-第二阶段-Tauri桌面架构迁移/分阶段迁移路线.md)。
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
- 历史 PyQt5 GUI 曾统一通过 canonical CLI 和 JSONL 进度协议启动任务，并已在新架构批次 7 经用户确认退役。
- 新架构批次 1–6 已完成并获验收；批次 7 已切换 Tauri 正式入口、退役 PyQt5，并等待用户最终验收。
- 支持安装模式与便携模式，不再依赖固定源码层级。
- 发布依赖移除 torch/torchaudio/torchvision，环境体积下降约 71%。
- 经用户确认，旧 Core 和大写 GUI 兼容入口已发送到 Windows 回收站。
- 最终成果已提交为 `0b3a289`，未推送。

第一阶段完整历史见[第一阶段索引](../10-第一阶段-基础修复与模块化重构/README.md)。

## 当前实现与未来提案的边界

当前存在且可运行的是：

- Python 业务核心。
- CLI 与 JSONL 进度输出。
- `contracts/desktop_ipc/v1` 与 `whisper_subtitle.protocol` 的版本化桌面协议契约。
- `python -m whisper_subtitle worker` 常驻入口和 Desktop IPC v1 stdin/stdout 循环。
- Worker 单 dispatcher 任务队列、模型缓存、空闲释放、取消和异常隔离。
- `apps/web` React/TypeScript 表现层、typed mock/Tauri bridge、原生路径输入和真实任务状态。
- `apps/web` 的版本化设置、任务历史/重试/详情、真实性能趋势、主题、键盘和无障碍体验。
- `apps/desktop` Tauri 2 / Rust WebView2 Host、Worker 监管、严格协议校验、白名单原生能力和受限文本预览；不监听端口。
- PyInstaller onedir 冻结 Worker、Tauri NSIS 两部分离线安装介质、完整便携目录、发布 manifest、SHA-256 和 CycloneDX Python SBOM。
- 安装快捷方式/安装目录 EXE 与便携 `whisper-subtitle-desktop.exe` 是正式桌面入口；Python CLI 保留 `transcribe/check/worker`，VBS 已退役。

当前尚不存在的是：

- 正式 Authenticode 签名产物和自动更新；签名接线已实现，但没有提供证书，自动更新按 P2 禁用。
- 实时片段、波形、时间轴和字幕编辑。

后续 Agent 必须区分“已经完成并验证的发布 sidecar/安装器”与“尚未完成的正式签名、外部干净机复核和自动更新”。不能把同机新鲜环境验证误称为第二台物理干净机验证，也不能把未签名产物误称为正式签名发布。

## 推荐的下一步

批次 0–6 已完成并获验收；批次 7 已实现并等待用户最终验收。本迁移计划没有批次 8，后续功能必须重新定义独立范围。

批次 7 已完成的范围：

- 安装版与便携版 Tauri EXE 均真实通过；VBS 启动层已按用户最终偏好送入回收站。
- PyQt5 表现层及两个专属测试已送入回收站；项目、构建、wheel、冻结 Worker 与 SBOM 不再依赖 PyQt5。
- Python CLI 保留 `transcribe/check/worker`，`gui` 子命令退役。
- 新鲜发布构建、安装版/便携版 CUDA/float16 cn/cn2 golden、最终安装/卸载和用户数据保留通过。
- Python 235 项、Vitest 8 项、Playwright 3 项、Rust fmt/strict Clippy/9 项测试通过。
- preset、算法、后处理、命名和输出保持不变。

当前产物未签名，自动更新未启用，也未在第二台物理干净 Windows 机器复核。实时片段、波形、时间轴和字幕编辑尚未获独立实施授权。

## 当前待用户补回的本地文件

- `Log/90-原始需求/执行1.md`、`执行2.md`、`执行3.md` 已从 Git 原始 blob 恢复，哈希与 `HEAD` 完全一致。
- 原先未跟踪的 `Requirement/isolate.md` 在 2026-07-13 的目录整理期间随原 `Requirement` 进入 Windows 回收站，随后回收站对象被清除。
- 该文件从未进入 Git，工作区、F 盘、`.workbuddy` 和回收站均无可用副本，因此不能推测或伪造其内容。
- 用户重新提供 `isolate.md` 后，应原样放入 `F:\WhisperSubtitle\Log\90-原始需求\isolate.md`，不要改写。

## 容易误判的地方

- Tauri/React 已是正式 GUI；历史批次 10 只删除旧大写兼容入口，PyQt5 的最终退役发生在新架构批次 7。
- 当前 application 层仍为默认组合直接导入部分 infrastructure；它是实用型分层，不是完全端口适配器架构。
- 旧 `ProgressEvent`/CLI JSONL 的 message 仍包含中文展示文本；Desktop IPC v1 已由 Worker 发出，因此两条通道在迁移期并存。
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
