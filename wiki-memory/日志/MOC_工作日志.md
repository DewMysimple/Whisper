---
type: moc
status: active
kind: process
importance: high
updated: 2026-08-24
topic: work-log-index
source_logs: []
supersedes: null
---

# 工作日志 MOC

> 单一工作日志索引，按更新时间倒序。任务类型通过 `kind` 元数据区分。

| 时间 | 类型 | 目标 | 状态 | 主题 | 日志 |
| --- | --- | --- | --- | --- | --- |
| 2026-08-24 | maintenance | - | archived | git-remote-configuration | [[日志/2026-08-24-配置GitHub远程仓库.md|配置 GitHub 远程仓库]] |
| 2026-08-24 | discussion | - | archived | architecture-maintainability-review | [[日志/2026-08-24-架构维护性评估.md|WhisperSubtitle 架构维护性评估]] |
| 2026-08-24 | maintenance | - | archived | git-remote-migration-and-snapshot | [[日志/2026-08-24-更换GitHub远程仓库并提交当前状态.md|更换 GitHub 远程仓库并提交当前状态]] |
| 2026-08-23 | maintenance | - | archived | project-memory-rebuild | [[日志/2026-08-23-项目记忆重建.md|WhisperSubtitle 项目记忆重建]] |

## 使用方式

- 由 `python 工具/memory_lint.py index` 生成或刷新。
- 查询时先阅读当前状态，再按关键词定位日志。
- 历史日志是审计记录，不应直接覆盖当前状态。

## 入口

- [[README|工程 Agent 记忆系统]]
- [[AGENTS|记忆维护协议]]
- [[日志/README|工作日志说明]]
- [[当前状态/项目概览|当前项目概览]]
- [[当前状态/系统架构|当前系统架构]]
