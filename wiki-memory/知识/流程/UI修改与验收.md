---
type: knowledge
status: active
kind: ui
importance: high
updated: 2026-09-19
topic: ui-change-acceptance
source_logs:
  - "[[日志/2026-09-19-任务监控与记录深度维护]]"
  - "[[日志/2026-09-19-开发态功能与UI可维护性整改]]"
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

修复现有 UI Bug 可使用用户明确授权的当前工程源码作为基线。回归应覆盖异步竞态、effect 重挂载、键盘焦点与取消操作；样式维护运行 `corepack pnpm check:styles`，涉及大批级联清理时补充同 DOM 计算样式比较。

任务工作台先查 `apps/web/src/components/tasks/README.md` 的组件／样式归属表，直接修改原责任规则。`e2e/task-workspace.spec.ts` 会修改浏览器中的原 CSS 规则并断言计算样式随之变化，防止被祖先选择器或末尾补丁遮蔽；同时验证日历底部实际命中、外层宽度偏好和 4／3／2／1 列布局。判断“修改不生效”时先确认运行的是 Vite 开发窗口还是嵌入旧前端的 Release EXE。
