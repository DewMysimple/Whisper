---
type: knowledge
status: active
kind: process
importance: medium
updated: 2026-08-23
topic: conventions
source_logs:
  - "[[日志/2026-08-23-项目记忆重建]]"
supersedes: null
---

# 工程规范

- 当前 Python 模块、测试和仓库脚本使用小写 snake_case；历史 Log 和 archive 名称不因规范化改名。
- `src/` 不保存生成输出；模型、虚拟环境、缓存和 benchmark 临时运行结果不进入版本控制。
- `docs/` 保存当前技术文档；`wiki-memory/` 保存结论、决策和审计入口，不复制完整实现。
- 代码修改必须保留既有用户工作树变化，并在任务日志中记录验证范围。
