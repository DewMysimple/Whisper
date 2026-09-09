---
type: moc
status: active
kind: process
importance: high
updated: 2026-09-09
topic: work-log-index
source_logs: []
supersedes: null
---

# 工作日志 MOC

> 单一工作日志索引，按更新时间倒序。任务类型通过 `kind` 元数据区分。

| 时间 | 类型 | 目标 | 状态 | 主题 | 日志 |
| --- | --- | --- | --- | --- | --- |
| 2026-09-09 | maintenance | 评估并维护当前工程的架构、工程文件、目录管理、Agent 入口、README 和长期记忆，在不改变产品功能契约的前提下修复本期应处理的问题。 | archived | periodic-engineering-maintenance | [[日志/2026-09-09-工程定期维护.md|工程定期维护]] |
| 2026-09-08 | ui | - | archived | unified-selection-card-interaction | [[日志/2026-09-08-统一卡片点击交互.md|第 34 次修改：统一选择卡片点击交互]] |
| 2026-09-08 | ui | - | archived | output-format-icon-controls | [[日志/2026-09-08-生成文件格式图标化.md|第 33 次修改（第 3 项）：生成文件格式图标化]] |
| 2026-09-08 | ui | - | archived | remove-ui-help-prompts | [[日志/2026-09-08-删除界面问号与提示功能.md|第 33 次修改（第 1 项）：删除界面问号与提示功能]] |
| 2026-09-08 | ui | 按用户授权，从参数配置中删除“复杂中英混合”和“中文细节增强”两个识别策略选项及其说明，不再让新任务从 UI 选择这两个模式。 | archived | retire-recognition-strategy-ui-options | [[日志/2026-09-08-删除参数配置增强模式.md|删除参数配置增强模式]] |
| 2026-09-08 | feature | - | archived | independent-srt-txt-output-selection | [[日志/2026-09-08-SRT输出格式独立选择.md|第 33 次修改（第 4 项）：SRT 输出格式独立选择]] |
| 2026-09-08 | ui | - | archived | srt-parameter-unit-alignment | [[日志/2026-09-08-SRT参数单位右对齐.md|第 33 次修改（第 2 项）：SRT 参数单位右对齐]] |
| 2026-09-07 | maintenance | 用户确认上一轮转录工作台间距修改尚未提交或推送，并要求将“每次修改后都要提交并推送”设为硬性项目约定。 | archived | git-commit-push-convention | [[日志/2026-09-07-建立修改后提交推送约定.md|建立修改后提交推送约定]] |
| 2026-09-07 | ui | 根据用户提供的截图，调整“文本识别模式”中第二行模式卡片与下方模型参数入口之间过近、且与模式卡片行间距不一致的问题。 | archived | transcription-workspace-spacing | [[日志/2026-09-07-修复转录工作台参数区间距.md|修复转录工作台参数区间距]] |
| 2026-09-07 | ui | - | archived | transcription-workspace-srt-switch-and-parameter-entry | [[日志/2026-09-07-修复SRT切换碎片与参数入口.md|第 32 次修改：修复 SRT 切换碎片与参数入口]] |
| 2026-08-24 | maintenance | 将本地 WhisperSubtitle Git 仓库连接到用户提供的 GitHub 远程仓库。 | archived | git-remote-configuration | [[日志/2026-08-24-配置GitHub远程仓库.md|配置 GitHub 远程仓库]] |
| 2026-08-24 | maintenance | 确认并清理仓库根目录中不参与 WhisperSubtitle 运行、构建、测试或打包的 `.agents/`、`.claude/` 和 `.workbuddy/`，并补充面向 GitHub 访客的项目 README。 | archived | repository-agent-state-cleanup | [[日志/2026-08-24-清理本地Agent工具状态.md|清理本地 Agent 工具状态]] |
| 2026-08-24 | discussion | 从维护、功能修改管理和 UI 组织三个角度评估当前架构是否适合继续演进，不执行代码重构。 | archived | architecture-maintainability-review | [[日志/2026-08-24-架构维护性评估.md|WhisperSubtitle 架构维护性评估]] |
| 2026-08-24 | maintenance | 继续完成用户要求的维护性瘦身：把剩余的跨边界大模块拆成职责明确的辅助模块，保持现有 UI、IPC、输出规则和公开入口不变，并补齐当前架构记忆。 | archived | architecture-maintenance-refactor-finalization | [[日志/2026-08-24-架构瘦身收口.md|WhisperSubtitle 架构瘦身收口]] |
| 2026-08-24 | maintenance | 落实维护性评估中确认的低风险重构：减少跨语言重复事实，拆分大模块内部职责，不改变 Python、React、Rust、IPC、输出和测试行为。 | archived | architecture-maintenance-refactor | [[日志/2026-08-24-架构瘦身实施.md|WhisperSubtitle 架构瘦身实施]] |
| 2026-08-24 | maintenance | 将本地仓库的 `origin` 更换为 `https://github.com/DewMysimple/Whisper.git`，审查当前工作树后提交适合进入远程仓库的工程状态并推送。 | archived | git-remote-migration-and-snapshot | [[日志/2026-08-24-更换GitHub远程仓库并提交当前状态.md|更换 GitHub 远程仓库并提交当前状态]] |
| 2026-08-23 | maintenance | 将旧 `Log` 重命名为 `wiki-memory`，保留完整历史，同时建立精简的当前记忆入口，并接入项目根目录 Agent 读取协议。 | archived | project-memory-rebuild | [[日志/2026-08-23-项目记忆重建.md|WhisperSubtitle 项目记忆重建]] |

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
