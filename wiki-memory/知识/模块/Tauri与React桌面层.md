---
type: knowledge
status: active
kind: module
importance: high
updated: 2026-09-18
topic: tauri-react-desktop
source_logs:
  - "[[日志/2026-08-23-项目记忆重建]]"
  - "[[日志/2026-08-24-架构瘦身实施]]"
  - "[[日志/2026-08-24-架构瘦身收口]]"
  - "[[日志/2026-09-09-工程定期维护]]"
  - "[[日志/2026-09-17-删除硬件优化工作台]]"
  - "[[日志/2026-09-17-启用Vite开发服务器并审计Apps目录]]"
  - "[[日志/2026-09-18-重构Worker日志与桌面个性化设置]]"
  - "[[日志/2026-09-18-修正主题一致性与布局直接调节]]"
supersedes: null
---

# Tauri 与 React 桌面层

- `apps/web/src/` 提供页面组件、任务工作区、历史、设置、性能和 bridge；模型切换与硬件优化没有独立页面。
- `apps/web/src/bridge/mockDesktopBridge.ts` 只用于浏览器测试；`tauriDesktopBridge.ts` 是正式本地 bridge。
- `apps/desktop/src-tauri/` 负责窗口、原生对话框、拖放、系统通知、Worker Host、权限和受限输出预览。
- UI 状态通过版本化 localStorage 保存设置和最多 100 条任务，不依赖服务端数据库。
- 外观配置在同一版本 1 payload 中保存主题、强调色、字体家族、框架/工作台/日志三组字号，以及展开导航和工作台最大宽度；`appearancePreferences.ts` 负责校验后的 CSS 变量投影。设置页用滑杆、加减按钮和整数输入调用 store，`Sidebar.tsx` 的拖拽分隔条也只通过 `setSidebarWidth` 更新同一事实源，组件不另存布局宽度。
- `state/workspaceEvents.ts` 集中 Worker/Host 事件归并，`state/workspaceTaskState.ts` 保存任务状态派生和质量诊断纯函数；`workspaceDraft.ts`、`workspacePersistence.ts` 和 `appearancePreferences.ts` 分别保存草稿、持久化和外观规则；`workspace.ts` 负责 store 组合和公开动作。
- `bridge/tauriWorkerDecoder.ts` 保存 Worker 消息解码、错误归一化和展示标签；`tauriWorkerEvents.ts` 负责消息到桌面任务事件的归并；`tauriDesktopBridge.ts` 负责 Tauri invoke、事件订阅、轮询和 DesktopBridge 生命周期。
- 原生窗口提醒与电源倒计时通知同样由 `DesktopBridge` 暴露；eslint 禁止 bridge 之外直接导入 `@tauri-apps/*`。
- `contracts/modelCatalog.generated.ts` 由 Python 模型注册表生成，Web 不手工维护模型能力列表。

组件不直接导入 Python、执行 shell 或解析中文展示字符串判断状态。开发期由 Tauri 自动启动仅监听 `127.0.0.1:1420` 的 Vite/HMR；正式运行加载本地静态 WebView，不启动 localhost 服务。
