---
type: knowledge
status: active
kind: module
importance: high
updated: 2026-08-23
topic: tauri-react-desktop
source_logs:
  - "[[日志/2026-08-23-项目记忆重建]]"
supersedes: null
---

# Tauri 与 React 桌面层

- `apps/web/src/` 提供页面组件、任务工作区、历史、设置、性能、模型和 bridge。
- `apps/web/src/bridge/mockDesktopBridge.ts` 只用于浏览器测试；`tauriDesktopBridge.ts` 是正式本地 bridge。
- `apps/desktop/src-tauri/` 负责窗口、原生对话框、拖放、系统通知、Worker Host、权限和受限输出预览。
- UI 状态通过版本化 localStorage 保存设置和最多 100 条任务，不依赖服务端数据库。

组件不直接导入 Python、执行 shell 或解析中文展示字符串判断状态。正式运行加载本地静态 WebView，不启动 localhost 服务。
