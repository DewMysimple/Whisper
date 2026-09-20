# 公共交互组件

公共组件负责原生按钮语义、视觉反馈和焦点；业务状态、确认时机与 bridge 调用留在使用方。

| 入口            | 适用场景                                             | 样式入口             |
| --------------- | ---------------------------------------------------- | -------------------- |
| `Button`        | 主要／次要文字动作，支持危险操作配色                 | `button.css`         |
| `IconButton`    | 只有图标的动作，必须传入 `label`，统一 32px 点击区域 | `button.css`         |
| `CardButton`    | 整张卡片可点击；仅实际选择控件传入 `selected`        | `card-button.css`    |
| `SegmentedCard` | 连续分段的导航／筛选，显式传入选择状态               | `segmented-card.css` |

- `Button`、`IconButton` 保留原生 `disabled`、`ref`、事件和表单属性，默认 `type="button"`。目前启动、确认弹窗、任务详情、历史操作和日志工具栏共用这些入口；已有原生 `.primary-button` / `.secondary-button` 也使用同一份样式。
- 动作按钮和公共卡片在 hover / active 时不平移或缩放命中区域。`Button` 可通过 `motion` 启用内部内容的轻抬／按压过渡和表面渐亮，目前用于桌面外观预览入口；系统减弱动画时关闭内容位移和过渡，保留颜色／阴影反馈。连续卡片的边框和底线必须保持相接。不得重新添加全局 `button:active` 变换或用 `!important` 覆盖组件交互。
- 图标动作默认无独立边框和外阴影，悬停／聚焦才强调。危险按钮的 `tone="danger"` 与 `aria-pressed` 显示已进入二次确认；确认对象与四秒有效期仍由业务组件及 `useTimedConfirmation` 管理。
- `selection-card` 是已有的独立选择控件样式，保留选中语义与其自身缩放反馈；不要用它实现只导航或触发动作的卡片。
- 页面只管理布局、间距和容器响应式规则。共享颜色使用主题变量；尺寸可读取继承的内容字号变量，不依赖 `.view-content` 祖先覆盖。
- `check:styles` 检查公共样式归属、重复选择器／属性、优先级覆盖及全局按钮变换。`e2e/interaction-contracts.spec.ts` 检查实际 hover / pointer / keyboard 命中区域、主题、减弱动画偏好和卡片尺寸变化。

任务页的组件职责与样式入口见 `tasks/README.md`。
