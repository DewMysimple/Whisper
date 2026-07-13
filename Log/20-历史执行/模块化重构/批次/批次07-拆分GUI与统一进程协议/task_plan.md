# 批次 07：拆分 GUI 与统一进程协议

## 目标

在不改变视觉设计和转录业务服务的前提下，拆分 GUI 职责，并让 GUI 子进程通过统一 CLI 与机器可解析的进度协议工作。

## 边界

- 保留 `.workbuddy`，不清理或修改其内容。
- 不自动暂存或提交 Git。
- 不修改转录业务服务的算法和输出规则。
- 保留进程隔离、异步停止、超时强制终止、关闭等待、QSettings 与 QFileDialog 行为。
- 延续批次 0–6 的未提交工作，在当前工作区原地实施。

## 阶段

- [complete] 1. 固化批次基线，梳理 GUI、CLI 与现有测试依赖。
- [complete] 2. 为 JSON Lines 进度协议和 GUI 分层补充失败测试。
- [complete] 3. 实现统一 CLI 的机器可解析进度模式，保持普通文本兼容。
- [complete] 4. 拆分 ProcessRunner、TranscriptionController 与 SettingsRepository。
- [complete] 5. 拆分主窗口和 widgets，保持界面结构与交互不变。
- [complete] 6. 迁移 GUI QProcess 到统一 CLI，完成定向与全量回归。
- [complete] 7. 清理临时产物、核对 Git 边界并输出执行报告。

## 验收

- GUI 不再根据 preset 的 `script` 字段拼接 Core 模块入口。
- 主窗口、控制器、进程、设置与 widgets 依赖方向明确。
- 普通 CLI 文本输出兼容，JSON Lines 模式可机器解析。
- 启动、选择、参数切换、停止、kill、关闭和设置恢复测试通过。
- GUI 与 CLI 对同一请求使用同一 preset 与输出规则。

## 遇到的错误

| 错误 | 尝试次数 | 处理 |
| --- | ---: | --- |
| CLI 测试仍用 `sys.modules`，迁移测试时误删 `import sys` | 1 | 恢复测试模块的 `sys` 导入后重跑定向测试 |
| GUI 分层合同首次收集找不到尚未实现的模块 | 1 | 确认测试先行红灯后实现 process/controller/settings 模块 |
| 大文件机械迁移时读取结果被工具截断，生成的主窗口中段不完整 | 1 | 停止叠加修改；分块读取当前文件，并从 Git 基线重建完整 UI 构建段后再通过 `py_compile` 校验 |
| 一次 PowerShell `rg` 命令因三引号模式转义失败 | 1 | 改用 `Select-String` 定位结构标记 |
