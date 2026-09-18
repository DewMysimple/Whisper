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
  - "[[日志/2026-09-18-统一诊断历史与状态标识细节]]"
  - "[[日志/2026-09-18-恢复状态徽标原始配色与图标]]"
  - "[[日志/2026-09-18-统一待补充配色与数值输入]]"
  - "[[日志/2026-09-18-放大并校准偏好数值]]"
  - "[[日志/2026-09-18-统一任务清单监控历史与调色板]]"
  - "[[日志/2026-09-18-联结Worker状态并拆分历史区块]]"
supersedes: null
---

# Tauri 与 React 桌面层

- `apps/web/src/` 提供页面组件、任务工作区、历史、设置、性能和 bridge；模型切换与硬件优化没有独立页面。
- `apps/web/src/bridge/mockDesktopBridge.ts` 只用于浏览器测试；`tauriDesktopBridge.ts` 是正式本地 bridge。
- `apps/desktop/src-tauri/` 负责窗口、原生对话框、拖放、系统通知、Worker Host、权限和受限输出预览。
- UI 状态通过版本化 localStorage 保存设置和最多 100 条任务，不依赖服务端数据库。
- 外观配置在同一版本 1 payload 中保存主题、强调色、字体家族、框架/工作台/日志三组字号，以及展开导航、工作台最大宽度和顶栏高度；`appearancePreferences.ts` 负责校验后的 CSS 变量投影。顶栏高度默认 116px，合法范围为 96–168px，缺失字段按默认值迁移。设置页提供八组经浅色／深色界面校准的工作台强调色；自定义取色器把二维 HSV 面板、色相轨道和 RGB 输入换算为现有 `#RRGGBB` 事实源。强调色不透明度固定为 100%，成功、警告、错误等语义色不随强调色改变。日志字号在字段缺失时默认 13px，已有合法显式值保持不变。设置页的三组尺寸和三组字号共用受范围约束的纯数字文本输入：允许直接键入、加减按钮与方向键调节，失焦时收敛范围；两类数值使用一致的等宽字体参数，并以说明字阶加 2px 显示。工作区尺寸值按 `px` 前的白色数值区居中，三组字号按各自数值框居中；单位固定在右侧独立单元，且只有外层控件绘制焦点。`Sidebar.tsx` 的拖拽分隔条也只通过 `setSidebarWidth` 更新同一事实源，组件不另存布局宽度。
- `state/workspaceEvents.ts` 集中 Worker/Host 事件归并，`state/workspaceTaskState.ts` 保存任务状态派生和质量诊断纯函数；`workspaceDraft.ts`、`workspacePersistence.ts` 和 `appearancePreferences.ts` 分别保存草稿、持久化和外观规则；`workspace.ts` 负责 store 组合和公开动作。
- `state/inputTaskPreview.ts` 把当前文件／目录选择投影为非持久化待执行媒体列表，供执行前清单和任务监控共同读取；两个界面都通过 store 的 `clearInputs` 清空选择，不直接处理源文件。正式任务启动后仍以 Worker 事件为进度事实源。
- `bridge/tauriWorkerDecoder.ts` 保存 Worker 消息解码、错误归一化和展示标签；`tauriWorkerEvents.ts` 负责消息到桌面任务事件的归并；`tauriDesktopBridge.ts` 负责 Tauri invoke、事件订阅、轮询和 DesktopBridge 生命周期。
- `WorkerLogsView.tsx` 只把 Host 已生成的日志行解析为时间、来源和正文视觉列；复制、导出、清空及 store 缓冲区继续处理原始字符串，展示解析不构成新的日志协议。
- 工作台状态徽标共享高度、弹性布局和图文中心线，但继续保留各自图标：文本与 SRT 未启用态分别使用文件、字幕图标，执行前待补充态仍使用警告图标。待补充徽标、需要关注的媒体清单卡片及 SRT“选择以启用”共用柔和强调色通道；当前输出保留绿色，不用统一的新增图标替换原图标。
- 原生窗口提醒与电源倒计时通知同样由 `DesktopBridge` 暴露；eslint 禁止 bridge 之外直接导入 `@tauri-apps/*`。
- `contracts/modelCatalog.generated.ts` 由 Python 模型注册表生成，Web 不手工维护模型能力列表。

组件不直接导入 Python、执行 shell 或解析中文展示字符串判断状态。开发期由 Tauri 自动启动仅监听 `127.0.0.1:1420` 的 Vite/HMR；正式运行加载本地静态 WebView，不启动 localhost 服务。
