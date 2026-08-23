---
type: knowledge
status: active
kind: ui
importance: high
updated: 2026-08-23
topic: ui-change-acceptance
source_logs:
  - "[[日志/2026-08-23-项目记忆重建]]"
supersedes: null
---

# UI 修改与验收

1. 取得用户明确授权并记录采用的第三阶段源码快照。
2. 冻结工作树，审计页面结构、CSS 级联、状态映射和正式组件边界。
3. 只修改授权范围，保护 Python、IPC、Preset、输出和任务契约。
4. 运行组件/状态测试、Playwright、完整前端检查、Tauri 构建和正式 EXE 启动烟测。
5. 记录真实修改文件、未回迁演示内容、Git 差异、验收结果和下一次进入条件。

浏览器原型验收不等于正式 EXE 验收；一次正式 UI 修改默认对应一篇修改日志。
