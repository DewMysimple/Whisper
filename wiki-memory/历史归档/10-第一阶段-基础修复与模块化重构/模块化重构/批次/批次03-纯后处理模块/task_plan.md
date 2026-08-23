# 批次 3：抽取纯后处理模块计划

## 目标

建立无 GPU、无文件系统副作用的 `domain/postprocess/`，消除四个 Core 中重复的英文/中文规范化、句子合并和重复清理实现；由 preset 的 `postprocess_strategy` 选择可组合策略链，同时保留全部旧函数导入和逐字节输出。

## 阶段

- [complete] 0. 记录工作区、源码、154 条测试与 golden 基线，盘点四 Core 算法差异
- [complete] 1. 建立纯后处理模块与可组合策略链，补齐独立纯函数测试
- [complete] 2. 将 preset 策略 ID 绑定到策略链并增加 registry 校验
- [complete] 3. 将四 Core 改为兼容导入/包装器，删除重复实现但保留旧函数名
- [complete] 4. 运行完整测试、旧导入兼容、真实四 preset/中文回归与性能门禁
- [complete] 5. 清理生成物、复核 Git 边界并生成执行报告

## 约束

- 不修改任何后处理算法输出。
- 不删除旧 Core 函数入口。
- 不修改模型加载、媒体发现、输出路径或写盘行为。
- 不覆盖 golden 来修复失败。
- 不执行 `git add`、commit、tag 或 push。
- 不覆盖 `.claude/settings.local.json` 与 `Requirement/isolate.md`，不删除 `.workbuddy`。
- 当前工作区包含批次 0–2 未提交前置成果，沿用用户既有选择原地执行，不创建 worktree。

## 错误记录

| 错误 | 次数 | 处理 |
|---|---:|---|
| 首次组装 `postprocess/__init__.py` 导入列表时误写条件表达式，形成无效语法 | 1 | 在运行测试前发现并改为正常导入 `PostprocessStrategy` |
| 中文单引号等价用例失败，发现旧源码三引号误解析形成异常多行替换文本 | 1 | 按“算法输出不变”约束精确保留历史替换值，记录为未来独立修复候选 |
| 首次检查单引号常量的 PowerShell 内联命令因引号终止符冲突解析失败 | 1 | 改用 here-string 通过标准输入传给 Python，成功读取函数常量与真实输出 |
| 首次测试落到系统 Python，未安装 pytest | 1 | 切换到项目 `whisper_env`，聚焦与完整测试均通过 |
| 两次静态搜索使用 Windows 不接受的路径通配符 | 2 | 改用 `rg -g 'WhisperProject*.py'`，审计通过 |
