# 执行1 修改计划

## 目标

严格按照 `Requirement/执行1.md` 修改四个 Core 脚本、环境自检和 GUI 进程生命周期，并完成无真实模型加载的回归验证。

## 阶段

- [complete] 1. 建立基线，确认四个 Core 与 GUI 生命周期实现差异
- [complete] 2. 修改并逐个验证四个 Core 脚本
- [complete] 3. 修复 `test_env.py` 漏检并验证
- [complete] 4. 修改 GUI 异步停止与关闭清理逻辑
- [complete] 5. 执行综合测试与差异审查

## 约束

- 直接在当前工作区修改，不创建 worktree。
- 不修改 UI 布局或要求范围外的业务行为。
- 不触碰用户已有 `.claude`、`.obsidian`、`requirements.txt` 和 `.workbuddy` 状态。
- 不加载真实 Whisper 模型；用帮助命令、AST/编译、离屏 GUI 和替身模型测试。

## 错误记录

| 错误 | 次数 | 处理 |
|---|---:|---|
| GUI 关闭测试的 5 秒测试截止 timer 与产品 5 秒 kill timer 同时到期，断言先执行导致状态仍为 Running | 1 | 将测试截止延长到 7 秒，避免同一时刻的事件队列竞争 |
| PowerShell 捕获 Core `--help` 时按控制台编码解码，导致中文“输入媒体文件”字符串断言为 false | 1 | 保留已通过的退出码测试；改用显式 `PYTHONIOENCODING=utf-8` 的 Python subprocess 验证帮助文本 |
| UTF-8 subprocess 下帮助文字断言仍为 false | 2 | 实际 stdout 正确；测试脚本经 PowerShell stdin 传入的中文字面量编码异常，改用 Unicode escape 后四个脚本全部通过 |
