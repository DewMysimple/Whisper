# 批次 07 进度日志

## 2026-07-13

- 已读取文件规划与 Git worktree 技能说明。
- 已确认当前是普通 `master` 检出；因批次 0–6 未提交且是本批次依赖，沿用此前选择在原工作区实施。
- 已读取批次 7 的目标、禁止事项和验收标准。
- 已确认不自动提交 Git、不修改 `.workbuddy`。
- 正在固化测试基线并梳理 GUI/CLI 结构。
- 全量基线通过：`217 passed in 0.56s`。
- 已确认旧 GUI 为 1205 行，`_build_ui()` 约 509 行，且 `_start()` 根据 preset Core 模块启动 QProcess。
- 已确定先固化 JSONL 协议与统一 CLI 命令，再拆 ProcessRunner/Controller/Settings/MainWindow/widgets。
- 已实现 JSONL renderer 与统一 CLI 直连应用服务的第一版，并迁移 CLI 合同测试。
- 首次定向测试有 1 个测试收集后失败：迁移时误删仍被 GUI/check 测试使用的 `sys` 导入；已恢复。
- 新增 GUI 分层合同测试，首次按预期因模块尚未实现而收集失败；现已加入 ProcessRunner、TranscriptionController 与 SettingsRepository 第一版。
- GUI 协议合同通过：`5 passed`。
- 将历史 GUI 模块迁为兼容门面，实际窗口移入 `presentation/gui/main_window.py`。
- 将 509 行 `_build_ui()` 拆为三面板 builder 方法；性能图表移入独立 widget。
- 机械迁移时曾因工具截断导致主窗口中段不完整；已从 Git 基线重建 UI 段、恢复 typed preset 差异并通过编译检查。
- 新增无头窗口交互测试，`5 passed`，覆盖启动、文件选择、preset、统一 CLI、停止、kill 和关闭等待。
- 正在执行全量回归与入口验证。
- 首轮全量回归通过：`229 passed in 0.53s`；41 个源码文件编译通过。
- presentation GUI 静态审计无 Core script/module 分派引用。
- 真实 JSONL/text CLI、QProcess 与两个 GUI 启动入口验证通过。
- 24 次基准全部成功，静态输出/参数字段与基线相同，最大中位数耗时比例为 `1.003`。
- 已补充静态架构合同，锁定兼容门面薄度、`_build_ui()` 委派和 GUI 无 Core 分派。
- 已清理 `tests/benchmark/runs`、pytest 缓存和 `src/tests` 下 Python 字节码缓存。
- 最终无缓存回归：`230 passed in 0.62s`；`git diff --check` 通过。
- 最终暂存文件 0、`.workbuddy` 变化 0、目标 GUI/转录/benchmark Python 进程 0。
- 批次 7 全部阶段完成，未执行 Git 暂存或提交。
