# 批次 07 发现记录

## 初始事实

- 批次 7 范围来自 `Log/模块化重构规划/分阶段执行计划.md` 第 260–290 行。
- 当前为 `master` 普通检出，`.git` 与 common dir 相同；批次 0–6 均为累积未提交前置变更，因此继续原地工作。
- 当前 Git 暂存区为空；已有工作树变化必须保留，尤其 `.claude/settings.local.json` 与 `Requirement/isolate.md`。
- `.workbuddy` 不在当前变更列表中，必须保持不变。

## 待梳理

- GUI 当前职责边界、QProcess 启动协议、设置键和关闭时序。
- CLI 当前参数入口与 ProgressEvent 渲染机制。
- 可在无显示器环境稳定覆盖的 GUI 测试方式。

## 基线与结构

- 批次开始全量测试：`217 passed in 0.56s`。
- `WhisperPyQtGUI.py` 当前 1205 行，`_build_ui()` 位于 288–798 行。
- 当前窗口同时承担 UI 构建、QSettings、文件对话框、性能采样、QProcess 生命周期、日志着色和运行状态切换。
- `_start()` 使用 `preset.module` 直接执行四个 Core 之一；这正是批次 7 要消除的旁路。
- 批次 6 已提供 transport-neutral `ProgressEvent`，适合在 presentation 层增加 JSON Lines 渲染，不必修改 application 服务。
- 普通 Core 入口仍需使用文本 renderer；统一 CLI 可新增 `--progress jsonl` 并直接调用同一 `TranscriptionService`。

## 实施后的职责边界

- `presentation/console.py`：文本与 JSONL renderer，统一 CLI 请求适配。
- `presentation/gui/process_runner.py`：统一 CLI 参数、QProcess 环境、分块行缓冲、JSONL 解码、terminate/5 秒 kill。
- `presentation/gui/controller.py`：运行态、用户停止语义、进度日志与完成结果；不持有 widget。
- `presentation/gui/settings.py`：集中管理四个 QSettings 键及旧 preset 值归一化。
- `presentation/gui/main_window.py`：窗口生命周期和交互协调。
- `presentation/gui/widgets/panels.py`：保持原视觉样式的设置、参数/监控、日志三面板构建。
- `presentation/gui/widgets/performance.py`：性能折线图。
- 历史 `gui/WhisperPyQtGUI.py` 仅保留兼容导入与启动门面；Core script helper 也仅存在于该门面，不参与 GUI 启动。

## 定向验证

- JSONL/CLI/registry/GUI 协议合同：`36 passed`。
- 无头主窗口交互：`5 passed`，覆盖面板启动、文件选择、参数切换、统一 CLI 请求、停止、kill 和关闭等待。
- GUI 协议合同：`5 passed`。
- 真实 QProcess：统一 CLI 对不存在输入发出 `input_invalid` JSONL 事件并以 1 退出，未产生无法解析的杂项输出。
- 模块 GUI 与历史兼容 GUI 在 `QT_QPA_PLATFORM=offscreen` 下均稳定存活 3 秒。
- 六个 CLI/Core help 入口全部返回 0；普通文本与 JSONL 的无效输入均保持退出码 1。

## 性能与黄金基线

- 24/24 基准运行成功，静态字段 `preset_id/script/model/params/postprocess/output` 与基线逐项相同。
- `total_process_seconds` 中位数比例：cn cold 1.003 / warm 0.989；cn2 cold 0.985 / warm 0.996；en cold 0.983 / warm 0.997；en2 cold 0.983 / warm 0.993。
- 最大比例 `1.003`，低于 `1.20` 阈值。
- 英文输出 SHA256 仍为 `D6AD4418CE220D3981878CB84FB903B6E483FF2497FCBD6A9D5C65C15463DE78`；中文仍为 `69D77F85DDD53B7F98F9A0E63F3639D6F8D194F33430278B96CBAAE798E2CD3D`。
