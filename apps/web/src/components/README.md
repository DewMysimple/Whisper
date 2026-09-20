# 公共展示与交互组件

公共组件负责原生按钮语义、视觉反馈和焦点；业务状态、确认时机与 bridge 调用留在使用方。

| 入口               | 适用场景                                             | 样式入口              |
| ------------------ | ---------------------------------------------------- | --------------------- |
| `Button`           | 主要／次要文字动作，支持危险操作配色                 | `button.css`          |
| `IconButton`       | 只有图标的动作，必须传入 `label`，统一 32px 点击区域 | `button.css`          |
| `CardButton`       | 整张卡片可点击；仅实际选择控件传入 `selected`        | `card-button.css`     |
| `SegmentedCard`    | 连续分段的导航／筛选，显式传入选择状态               | `segmented-card.css`  |
| `SummaryText`      | 标签、数值和可选说明；监控摘要与 Worker 状态复用     | `summary-text.css`    |
| `.diagnostic-text` | 日志正文和外观预览的统一排版                         | `diagnostic-text.css` |

- `Button`、`IconButton` 保留原生 `disabled`、`ref`、事件和表单属性，默认 `type="button"`。目前启动、确认弹窗、任务详情、历史操作和日志工具栏共用这些入口；已有原生 `.primary-button` / `.secondary-button` 也使用同一份样式。
- 动作按钮和公共卡片在 hover / active 时不平移或缩放命中区域。`Button` 可通过 `motion` 启用内部内容的轻抬／按压过渡和表面渐亮，目前用于桌面外观预览入口；系统减弱动画时关闭内容位移和过渡，保留颜色／阴影反馈。连续卡片的边框和底线必须保持相接。不得重新添加全局 `button:active` 变换或用 `!important` 覆盖组件交互。
- 图标动作默认无独立边框和外阴影，悬停／聚焦才强调。危险按钮的 `tone="danger"` 与 `aria-pressed` 显示已进入二次确认；确认对象与四秒有效期仍由业务组件及 `useTimedConfirmation` 管理。
- `selection-card` 是已有的独立选择控件样式，保留选中语义与其自身缩放反馈；不要用它实现只导航或触发动作的卡片。
- 页面只管理布局、间距和容器响应式规则。共享颜色使用主题变量；尺寸可读取继承的内容字号变量，不依赖 `.view-content` 祖先覆盖。
- `check:styles` 检查公共样式归属、重复选择器／属性、优先级覆盖及全局按钮变换。`e2e/interaction-contracts.spec.ts` 检查实际 hover / pointer / keyboard 命中区域、主题、减弱动画偏好和卡片尺寸变化。

`SummaryText` 只接收 `label`、`value` 和可选 `description`；图标、按钮、数据格式化和业务操作仍归使用方。它统一界面字体、600 字重和换行，字号在组件内根据 `--workspace-font-size` 计算，不继承已在根节点计算的字号值，也不读取日志字号。状态卡可通过 `--summary-value-size` 指定自己的数值层级。

日志正文与设置预览共用 `.diagnostic-text`，使用界面字体和独立的 `--log-font-size`，保留换行、缩进与文本选取。时间、来源、数字和路径继续使用 `--mono`，其回退链包含当前界面字体以支持中文；不另装字体、不依赖在线字体。样式在 `main.tsx` 加载。

`WorkerLogsView.tsx` 的布局、浅深主题变量、空状态与响应式规则只在 `worker-logs.css` 维护；已删除旧 `.log-view` 和全局诊断覆盖。新规则应直接修改原责任选择器，不能在 `styles.css` 末尾追加同名覆盖。`check:styles` 对日志与两个公共文字入口执行归属、重复选择器、重复属性和优先级检查。日志展示不改写 store 缓冲区，复制／导出始终使用原始字符串。

任务页的组件职责与样式入口见 `tasks/README.md`。

`WorkspaceEntryCard` 共用路径读取与参数跳转的标签／主文案／说明结构，底层使用 `CardButton`，外观只在 `workspace-entry-card.css` 维护。

`ConfigurationView` 负责本地模型清单和参数分组，`ParameterField` 负责编辑缓冲、校验反馈与逐项复位；配置事实由 workspace 保存。`data/parameterPresentation.ts` 只保存文案与分组，字段类型／范围／默认值从 Python 生成，校验入口为 `state/parameterValidation.ts`。样式只放在 `configuration.css`，禁止追加到全局。

`ConfigurationView` 的模型／参数导航复用 `SegmentedCard`，主容器与参数分组沿用任务／性能工作台的面板及紧凑标题层级。模型网格用等宽列和等高行，卡片内容允许长路径换行。`HardwareView` 使用相同公共组件展示快捷方案、真实能力摘要和四项执行设置；样式只放在 `hardware-optimization.css`。能力通过 typed bridge 的 `getHardwareCapabilities` 获取，设置规则来自 IPC schema，页面不能自行假定 GPU 或某精度可用。
