# 任务监控与记录维护入口

`TasksView.tsx` 是唯一页面入口。`App.tsx` 只挂载它；任务页不区分 Mock 与原生两套 JSX。

监控／历史导航由页面提供，融入监控主卡或历史管理卡；两项导航与四项筛选共用上级目录的 `SegmentedCard`。`CardButton` 统一执行前清单、媒体卡、历史主卡和 Worker 状态卡的原生键盘激活、焦点与按下反馈。动作卡不设置选中状态，选择卡显式传入 `selected`；业务动作仍归各组件或 workspace store。

| 修改内容                       | 组件                    | 样式                   |
| ------------------------------ | ----------------------- | ---------------------- |
| 监控／历史切换、页面宽度       | `TasksView.tsx`         | `task-workspace.css`   |
| 主监控、双进度、来源与输出     | `TaskMonitor.tsx`       | `task-monitor.css`     |
| 逐媒体列表、自动跟随           | `TaskMediaList.tsx`     | `task-monitor.css`     |
| 处理链路                       | `TaskProcessChain.tsx`  | `task-monitor.css`     |
| 搜索、筛选、历史操作和归档网格 | `TaskHistory.tsx`       | `task-history.css`     |
| 单张历史卡片、事实区、操作按钮 | `TaskHistoryCard.tsx`   | `task-history.css`     |
| 日期日历                       | `TaskDateFilter.tsx`    | `task-date-filter.css` |
| 载入历史配置确认               | `TaskRestoreDialog.tsx` | 共用 `ConfirmDialog`   |

## 状态与展示

- Host/Worker → typed bridge → `state/workspaceEvents.ts` → workspace store 是任务事实来源。
- `state/taskMonitor.ts` 负责当前媒体、历史回退与处理阶段；`state/taskHistory.ts` 负责筛选、计数、日期与卡片展示规则。组件不根据中文标签或百分比推测执行阶段。
- `state/workspaceTaskState.ts` 的 `taskOutputPaths` 合并任务与逐媒体输出；监控、历史、详情都使用它。
- `state/taskFiles.ts` 依据成功媒体实际记录的输出路径选择定位目标，TXT 优先、MD 次之、SRT 回退；无输出关联的旧批量任务只定位源媒体。不能通过截取／拼接标题猜测输出文件名。
- 输入预览来自 `state/inputTaskPreview.ts`，不持久化、不伪造目录子文件。
- 搜索、日期和筛选存在 workspace store 中，切换页面后保留；删除待确认、恢复配置确认等短期交互留在所属组件中。
- `TaskHistoryCard` 仅接收快照与回调。`TaskDetail` 按任务 ID 挂载详情内容，防止上个任务的确认状态泄漏。
- 自动跟随只滚动媒体列表；鼠标、触摸或键盘手动浏览会暂停跟随，沿用共用 `useAutoFollow` 的恢复时间。
- 历史删除与日志清空的四秒确认、Esc 和外部点击取消统一使用 `useTimedConfirmation`，按钮通过 `data-confirm-action` 标明归属。

历史卡标题与状态图标在首行居中对齐，标题使用正文字阶，长文件名保留后缀；时间独占下一行并与内容左边缘对齐，使用时钟图标及较弱字阶。六格事实区拥有独立内缩圆角边框，进度位于标题／时间区域下方。底部只显示模型名称，不重复“模型”标签；模型与动作在宽卡中同排居中，卡片本身不超过 270px 时通过容器查询切换为模型行与操作行，避免字号和侧栏尺寸变化时挤压。图标动作使用公共 `IconButton`，统一 32px 点击区域、16px 图标与无独立浮起边框的视觉；业务回调保持在卡片外，二次删除确认不变。修改布局时直接修改对应原规则，禁止恢复旧的负边距／卡片边缘贯通线覆盖。

公共按钮、图标按钮、卡片的交互维护规则见上级目录 `README.md`。卡片按下与悬停不改变命中区域；不得通过全局按钮缩放让相接边框露出空隙。

监控底部“输入来源／输出结果”统一使用 `SummaryText`，读取工作台字号、使用界面字体与 600 字重；`task-monitor.css` 只负责容器、图标和布局，不另定义摘要文字外观。清除、终止与打开目录都复用公共 `Button`，保留 disabled、确认和原业务回调，页面只设局部尺寸。

## 样式修改方式

在表中对应文件找到原规则直接修改。每个选择器在同一媒体条件下只定义一次；基础规则在前，断点规则按宽到窄放在后面。状态变体紧靠基础规则。组件不得重新引入 `.is-expanded`、`.view-content` 祖先依赖或 `!important`，也不得把任务样式追加到全局文件末尾。共享主题变量来自全局 CSS，页面宽度继承外层工作台宽度偏好。

`corepack pnpm check:styles` 会验证样式归属、重复选择器与覆盖优先级；`e2e/task-workspace.spec.ts` 会直接修改浏览器中原规则，确认样式确实作用到对应元素，并检查日历实际命中、页面宽度和 4／3／2／1 列布局。

开发态由 Vite 提供源码更新，正式 EXE 嵌入构建后的前端。检查修改不生效时，先确认正在查看开发窗口还是已构建 EXE，然后定位 DOM 对应组件和负责的规则；不要编辑 `dist` 或用新增高优先级覆盖掩盖来源问题。

交互修改运行 `corepack pnpm check` 与 `corepack pnpm e2e`。测试预览默认端口 4173，可通过 `WHISPER_E2E_PORT` 切换到其他空闲端口。正式 UI 验收还需 `corepack pnpm desktop:build` 和 EXE/Worker 握手烟测；用户明确仅要求开发态整改时，记录本次未构建正式产物。
