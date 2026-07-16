# 批次 0：基线与仓库卫生计划

## 目标

在不修改业务代码、不暂存、不提交 Git 的前提下，建立模块化重构前的仓库规则、验证证据和建议提交清单。

## 阶段

- [complete] 0. 记录 Git/工作区、业务源码哈希、golden 和测试基线
- [complete] 1. 更新 `.gitignore`、新增 `.gitattributes`/`.editorconfig`、补 pytest 配置
- [complete] 2. 验证测试、golden、环境、CLI 与 GUI 冒烟，并复核业务源码哈希
- [complete] 3. 生成纳管清单、建议提交信息/标签与执行报告

## 约束

- 不修改 `src/whisper_subtitle` 下任何业务文件。
- 不执行 `git add`、commit、tag 或 push。
- 不覆盖 `.claude/settings.local.json`，不删除 `.workbuddy`。
- 延续用户此前选择，在当前工作区执行，不创建 worktree。

## 错误记录

| 错误 | 次数 | 处理 |
|---|---:|---|
| 首轮属性检查仍提示 `.gitignore` 将由 LF 转 CRLF | 1 | 在 `.gitattributes` 中为三个无扩展名仓库控制文件显式指定 `text eol=lf` |
| 最终状态脚本在 PowerShell 哈希表中内嵌 `git check-ignore` 命令导致解析错误 | 1 | 将命令独立执行并保存布尔变量后再构造状态对象 |
