# 批次 4：媒体发现与输出存储计划

## 目标

建立 `infrastructure/media_files.py` 与 `infrastructure/output_store.py`，统一媒体发现、输出路径规划、TXT/MD 写入与备份；四个 Core 保留旧入口和相同行为，但不再复制文件系统实现。

## 阶段

- [complete] 0. 记录工作区、178 条测试、golden 与源码基线，盘点四 Core 文件系统差异
- [complete] 1. 建立媒体发现模块与纯路径契约，补充单文件/目录/排序/扩展名测试
- [complete] 2. 建立 `OutputPlan`、原子 TXT/MD 写入与失败清理测试
- [complete] 3. 将四 Core 改为兼容包装器并接入统一媒体发现和输出存储
- [complete] 4. 运行完整测试、真实四 preset/中文回归、性能及 CLI/GUI 门禁
- [complete] 5. 清理生成物、复核 Git 边界并生成执行报告

## 约束

- 不修改模型加载、转录参数或后处理算法。
- 不改变媒体扩展名集合、发现顺序、默认/强制输出目录、备份条件、桌面路径或文件内容。
- 旧 `txt_to_md` 等公开函数保留兼容包装。
- 写入采用同目录临时文件后原子替换；失败不得损坏既有最终文件或遗留临时文件。
- 不覆盖 golden 来修复失败。
- 不执行 `git add`、commit、tag 或 push。
- 不覆盖 `.claude/settings.local.json` 与 `Requirement/isolate.md`，不删除 `.workbuddy`。
- 当前工作区包含批次 0–3 未提交前置成果，沿用用户既有选择原地执行，不创建 worktree。

## 错误记录

| 错误 | 次数 | 处理 |
|---|---:|---|
| 首次盘点 Core 时使用 Windows 不接受的路径通配符 `WhisperProject*.py` | 1 | 改用 `rg -g 'WhisperProject*.py'`，成功取得全部调用点 |
