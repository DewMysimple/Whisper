# 任务监控与记录维护入口

`TasksView.tsx` 是唯一页面入口。`App.tsx` 只挂载它；任务页不区分 Mock 与原生两套 JSX。

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
- 输入预览来自 `state/inputTaskPreview.ts`，不持久化、不伪造目录子文件。
- 搜索、日期和筛选存在 workspace store 中，切换页面后保留；删除待确认、恢复配置确认等短期交互留在所属组件中。
- `TaskHistoryCard` 仅接收快照与回调。`TaskDetail` 按任务 ID 挂载详情内容，防止上个任务的确认状态泄漏。
- 自动跟随只滚动媒体列表；鼠标、触摸或键盘手动浏览会暂停跟随，沿用共用 `useAutoFollow` 的恢复时间。

## 样式修改方式

在表中对应文件找到原规则直接修改。每个选择器在同一媒体条件下只定义一次；基础规则在前，断点规则按宽到窄放在后面。状态变体紧靠基础规则。组件不得重新引入 `.is-expanded`、`.view-content` 祖先依赖或 `!important`，也不得把任务样式追加到全局文件末尾。共享主题变量来自全局 CSS，页面宽度继承外层工作台宽度偏好。

`corepack pnpm check:styles` 会验证样式归属、重复选择器与覆盖优先级；`e2e/task-workspace.spec.ts` 会直接修改浏览器中原规则，确认样式确实作用到对应元素，并检查日历实际命中、页面宽度和 4／3／2／1 列布局。

开发态由 Vite 提供源码更新，正式 EXE 嵌入构建后的前端。检查修改不生效时，先确认正在查看开发窗口还是已构建 EXE，然后定位 DOM 对应组件和负责的规则；不要编辑 `dist` 或用新增高优先级覆盖掩盖来源问题。

交互修改运行 `corepack pnpm check` 与 `corepack pnpm e2e`。正式 UI 验收还需 `corepack pnpm desktop:build` 和 EXE/Worker 握手烟测。
