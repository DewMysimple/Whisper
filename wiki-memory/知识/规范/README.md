---
type: knowledge
status: active
kind: process
importance: medium
updated: 2026-09-09
topic: conventions
source_logs:
  - "[[日志/2026-08-23-项目记忆重建]]"
  - "[[日志/2026-09-09-工程定期维护]]"
supersedes: null
---

# 工程规范

- 当前 Python 模块、测试和仓库脚本使用小写 snake_case；历史 Log 和 archive 名称不因规范化改名。
- `src/` 不保存生成输出；模型、虚拟环境、缓存和 benchmark 临时运行结果不进入版本控制。
- `docs/` 保存当前技术文档；`wiki-memory/` 保存结论、决策和审计入口，不复制完整实现。
- 代码修改必须保留既有用户工作树变化，并在任务日志中记录验证范围。
- `requirements.txt` 只委托到 `pyproject.toml`；模型目录只从 `domain/models.py` 生成到 TypeScript/Rust，避免跨语言手工重复事实源。
- `.lnk` 和生成目录等机器相关产物不进入版本控制；定期维护不自动删除模型、虚拟环境、构建缓存或发布产物。
