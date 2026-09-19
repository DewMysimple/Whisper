---
type: knowledge
status: active
kind: module
importance: high
updated: 2026-09-19
topic: tauri-react-desktop
source_logs:
  - "[[日志/2026-09-19-任务监控与记录深度维护]]"
  - "[[日志/2026-09-19-开发态功能与UI可维护性整改]]"
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
  - "[[日志/2026-09-18-清理历史伪区域并启用顶栏拖拽]]"
  - "[[日志/2026-09-18-重排历史归档与任务监控信息]]"
  - "[[日志/2026-09-18-校准任务网格分隔与顶部标签]]"
  - "[[日志/2026-09-18-补齐历史分隔与对齐双进度]]"
  - "[[日志/2026-09-18-重排历史格式与参数列]]"
  - "[[日志/2026-09-19-收紧历史卡片标题与分隔线]]"
  - "[[日志/2026-09-19-对齐历史事实区文字]]"
  - "[[日志/2026-09-19-统一历史配置字段结构]]"
supersedes: null
---

# Tauri 与 React 桌面层

- `apps/web/src/` 提供页面组件、任务工作区、历史、设置、性能和 bridge；模型切换与硬件优化没有独立页面。
- `apps/web/src/bridge/mockDesktopBridge.ts` 只用于浏览器测试；`tauriDesktopBridge.ts` 是正式本地 bridge。
- `apps/desktop/src-tauri/` 负责窗口、原生对话框、拖放、系统通知、Worker Host、权限和受限输出预览。
- UI 状态通过版本化 localStorage 保存设置和最多 100 条任务，不依赖服务端数据库。
- 外观配置在同一版本 1 payload 中保存主题、强调色、字体家族、框架/工作台/日志三组字号，以及展开导航、工作台最大宽度和顶栏高度；`appearancePreferences.ts` 负责校验后的 CSS 变量投影。顶栏高度默认 116px，合法范围为 96–168px，缺失字段按默认值迁移。设置页提供八组经浅色／深色界面校准的工作台强调色；自定义取色器把二维 HSV 面板、色相轨道和 RGB 输入换算为现有 `#RRGGBB` 事实源。强调色不透明度固定为 100%，成功、警告、错误等语义色不随强调色改变。日志字号在字段缺失时默认 13px，已有合法显式值保持不变。设置页的三组尺寸和三组字号共用受范围约束的纯数字文本输入：允许直接键入、加减按钮与方向键调节，失焦时收敛范围；两类数值使用一致的等宽字体参数，并以说明字阶加 2px 显示。工作区尺寸值按 `px` 前的白色数值区居中，三组字号按各自数值框居中；单位固定在右侧独立单元，且只有外层控件绘制焦点。`Sidebar.tsx` 的导航拖拽分隔条只通过 `setSidebarWidth` 更新事实源，`App.tsx` 的顶栏拖拽分隔条同样只通过 `setTopbarHeight` 更新事实源；两者都支持指针捕获、键盘调节与双击复位，组件不另存布局尺寸。
- `state/workspaceEvents.ts` 集中 Worker/Host 事件归并，`state/workspaceTaskState.ts` 保存任务状态派生和质量诊断纯函数；`workspaceDraft.ts`、`workspacePersistence.ts` 和 `appearancePreferences.ts` 分别保存草稿、持久化和外观规则；`workspace.ts` 负责 store 组合和公开动作。
- `state/inputTaskPreview.ts` 把当前文件／目录选择投影为非持久化待执行输入列表；目录仅保留路径、媒体数、汇总时长与未知数，不推导子路径或逐文件时长，供执行前清单和任务监控共同读取；两个界面都通过 store 的 `clearInputs` 清空选择，不直接处理源文件。正式任务启动后仍以 Worker 事件为进度事实源。
- `components/tasks/TasksView.tsx` 是任务工作台唯一入口；`TaskHistory` 管理搜索、筛选与动作，`TaskHistoryCard` 只接收快照和回调，`TaskMonitor` 组合主监控、`TaskMediaList` 和 `TaskProcessChain`。旧 compact／expanded 双分支已移除。组件与四个责任 CSS 的修改定位见 `apps/web/src/components/tasks/README.md`；当前视觉约定见 [[当前状态/项目概览]]。
- `bridge/tauriWorkerDecoder.ts` 保存 Worker 消息解码、错误归一化和展示标签；`tauriWorkerEvents.ts` 负责消息到桌面任务事件的归并；`tauriDesktopBridge.ts` 负责 Tauri invoke、事件订阅、轮询和 DesktopBridge 生命周期。
- `WorkerLogsView.tsx` 只把 Host 已生成的日志行解析为时间、来源和正文视觉列；复制、导出、清空及 store 缓冲区继续处理原始字符串，展示解析不构成新的日志协议。
- 工作台状态徽标共享高度、弹性布局和图文中心线，但继续保留各自图标：文本与 SRT 未启用态分别使用文件、字幕图标，执行前待补充态仍使用警告图标。待补充徽标、需要关注的媒体清单卡片及 SRT“选择以启用”共用柔和强调色通道；当前输出保留绿色，不用统一的新增图标替换原图标。
- 原生窗口提醒与电源倒计时通知同样由 `DesktopBridge` 暴露；eslint 禁止 bridge 之外直接导入 `@tauri-apps/*`。
- `contracts/modelCatalog.generated.ts` 由 Python 模型注册表生成，Web 不手工维护模型能力列表。

组件不直接导入 Python、执行 shell 或解析中文展示字符串判断状态。开发期由 Tauri 自动启动仅监听 `127.0.0.1:1420` 的 Vite/HMR；正式运行加载本地静态 WebView，不启动 localhost 服务。

## 任务与交互维护约束

- `workspace.ts` 在首个异步模型检查前锁定提交；提交后只移除本次草稿的输入，保留等待期间新增的输入。重试、续接与待确认草稿共享提交锁。
- `workspaceEvents.ts` 按任务 ID 幂等入队；未知或终态任务的迟到进度不能改变监控选中项。Host failed/stopped 会终止未结束的本地记录；部分失败不能把未确认完成的媒体标成成功。
- 输出审计只更新发起检查时的任务与路径集合；预览/打开失败需实际检查路径存在性，不能把任意异常当作文件丢失。预览响应使用请求序号防止关闭再打开同一任务后的旧响应覆盖。
- `workspacePersistence.ts` 对连续进度做节流落盘，退出和 effect 清理时 flush；存储失败由现有错误通道提示。持久化仅在 store 首次连接时恢复，React StrictMode/Fast Refresh 的 effect 重挂载不重写活任务。
- Tauri bridge 按已成功注册的监听器逐项清理，初始化失败可重试；销毁后的迟到注册不能泄漏，旧 Host/模型轮询响应不能覆盖较新的生命周期事件。
- `taskMonitor.ts`、`taskTiming.ts` 分别负责监控数据派生和耗时转换；当前媒体匹配统一容忍 Windows 大小写和斜杠差异。处理链路读取原始阶段码，失败／取消时已知阶段以前显示完成、当前阶段显示已中断、之后显示未执行；阶段未知时明确显示未记录。不得按总百分比推断当前媒体阶段，不得将运行中或跳过媒体计入处理完成数，排队等待不计入执行耗时。`TaskMediaList` 自动跟随只滚动自身列表，手动浏览后沿用 `useAutoFollow` 的暂停周期。
- `useDialogFocus.ts` 统一弹窗焦点、Tab、Escape 与背景滚动控制；回调变化不会重新抢焦点，子弹窗外层点击不会冒泡关闭任务详情。确认终止时保留打开弹窗时的任务快照。
- `TaskRestoreDialog` 共享历史／详情的配置恢复确认；`TaskDetail` 按任务 ID 隔离临时确认状态。`taskHistory.ts` 让筛选卡计数与任务列表共用判断规则；监控、历史、详情统一使用 `taskOutputPaths` 合并任务级和逐媒体输出。
- `workspaceDraft.ts` 统一输入去重与自定义参数判定；启用 SRT 时，其参数偏离预设也属于自定义。
- 浏览器 Mock 对新提交任务串行模拟逐媒体完成，按实际选中的 TXT/MD/SRT 组合产生模拟输出事件；原生正式页面仍只接收 Host/Worker 数据。
- `check:styles` 检查任务样式归属、同条件重复选择器／属性、旧祖先变体和 `!important`；新增样式直接修改原责任规则。检查器与视觉验证说明见 [[知识/流程/开发与验证]]。
