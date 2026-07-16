# 批次 2：统一数据契约与 Preset 注册表计划

## 目标

新增稳定的类型化数据契约和唯一 preset registry，使 CLI、GUI 与兼容 Core 从同一数据源解析 preset，同时保留全部旧入口、旧 preset ID、QSettings 恢复和现有转录行为。

## 阶段

- [complete] 0. 记录工作区、源码、126 条测试与四 golden 基线
- [complete] 1. 设计并新增类型化契约及契约单元测试
- [complete] 2. 建立唯一 preset registry、别名解析和启动时校验
- [complete] 3. 迁移 CLI、GUI 与兼容 Core 到统一 registry，保留旧导入和 QSettings 兼容
- [complete] 4. 运行完整测试、真实四 preset/中文回归、CLI/GUI 冒烟与 benchmark 门禁
- [complete] 5. 清理生成物、复核 Git 边界并生成执行报告

## 约束

- 不合并四个转录流程，不移动后处理或文件输出逻辑。
- 不删除旧 preset ID、旧 Core 文件、旧导入路径或旧 CLI 别名。
- 不覆盖 golden 来修复失败。
- 不执行 `git add`、commit、tag 或 push。
- 不覆盖 `.claude/settings.local.json` 与 `Requirement/isolate.md`，不删除 `.workbuddy`。
- 当前工作区包含未提交的批次 0/1 前置成果，因此沿用用户此前选择原地执行，不创建 worktree。

## 错误记录

| 错误 | 次数 | 处理 |
|---|---:|---|
| PowerShell 双引号内的 `rg` 正则含引号与管道，被 shell 误解析为命令 | 1 | 改用单引号包裹简化正则后成功查询 |
| 真实 benchmark 覆盖了输入旁已跟踪的 `Text/regression_input.txt` 备份 | 1 | 恢复原始内容；runner 增加文件快照/原样恢复并补单元测试，成功或失败均不污染基线备份 |
| 终端将备份中的中文标点显示为 mojibake，首次恢复造成二次编码 | 1 | 读取 HEAD 原始十六进制确认实际为 UTF-8 `，/。`，再按真实文本恢复 |
