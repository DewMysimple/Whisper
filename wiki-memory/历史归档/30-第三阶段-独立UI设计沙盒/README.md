# 第三阶段：独立 UI 设计沙盒

更新时间：2026-07-17。

## 阶段定义

第三阶段不在 `F:\WhisperSubtitle` 正式工程内部实施产品功能或界面代码整改。

本阶段将第二阶段形成的桌面 UI 视觉结构抽出为一个独立、无后端功能的 HTML/CSS/JavaScript 原型，并在以下外部目录中继续工作：

```text
C:\Users\Administrator\Desktop\WhisperUI
```

后续以该目录为工作区开启的 ChatGPT 对话，属于 WhisperSubtitle 工程演进的第三阶段，但其文件修改、工作日志和验收证据均记录在 `WhisperUI` 目录，不继续写入正式工程代码区。

## 为什么采用外置 UI 阶段

正式桌面程序需要经过 Tauri 构建后以 EXE 运行，不适合在 ChatGPT 应用内快速预览和反复指导视觉调整。第三阶段把界面抽成轻量静态原型，使布局、颜色、间距、文字、组件状态和演示交互可以先在浏览器中快速确认。

这一安排解决的是“设计评审和沟通成本”，不是改变正式软件架构。正式软件仍然保持 Tauri 2 + React/TypeScript + Python 常驻推理 Worker 的第二阶段架构成果。

## 本阶段允许修改的范围

仅允许在 `C:\Users\Administrator\Desktop\WhisperUI` 中修改：

- 静态 HTML 页面结构。
- 设计 Token、颜色、字体、间距、圆角、阴影和响应式规则。
- 侧栏、顶栏、输入区、Preset 区、输出区、任务区、性能区和设置区的视觉表达。
- 用于展示状态的模拟数据和轻量 JavaScript 交互。
- `WhisperUI\Log` 下的第三阶段交接资料和工作日志。
- 由无依赖构建脚本生成的单文件 HTML 预览。

## 本阶段禁止事项

第三阶段不得在 `F:\WhisperSubtitle` 中：

- 修改 React/Tauri/Python 正式实现。
- 修改 Worker、Desktop IPC、协议、模型加载或 CUDA 行为。
- 修改 Preset、转录参数、后处理规则、文件命名或输出内容。
- 修改依赖、打包、安装器、便携目录或 EXE。
- 把原型的模拟数据误认为真实性能采样或功能验收结果。
- 因为原型视觉已经验收，就宣称正式软件已经完成相同整改。

本次在正式工程 `Log` 中添加第三阶段边界说明，是建立阶段索引的一次性文档动作，不代表第三阶段后续工作继续修改正式工程。

## 正式工程与原型的关系

| 项目 | 正式工程 | 第三阶段原型 |
| --- | --- | --- |
| 位置 | `F:\WhisperSubtitle` | `C:\Users\Administrator\Desktop\WhisperUI` |
| 桌面技术 | Tauri 2 + React/TypeScript | 静态 HTML/CSS/JavaScript |
| 后端 | Python 常驻 Worker | 无后端，仅模拟状态 |
| IPC | Desktop IPC v1 | 不连接 IPC |
| 数据 | 真实媒体、任务、模型和性能事件 | 固定演示数据 |
| 主要目的 | 交付和运行本地 Windows EXE | 快速评审与确定 UI 方案 |
| 日志位置 | `F:\WhisperSubtitle\Log` | `C:\Users\Administrator\Desktop\WhisperUI\Log` |

## 原型验收含义

第三阶段验收只表示以下内容已经在纯 UI 原型中确认：

- 信息架构和页面层级。
- 组件布局与视觉样式。
- 页面文字与空状态、运行状态、错误状态的表达。
- 演示级导航、主题切换和指标切换。

它不验证真实文件选择、转录任务、Worker 生命周期、GPU 性能、输出文件、安装器或 EXE 行为。

## 回迁边界

将第三阶段成果应用回 `F:\WhisperSubtitle` 不属于第三阶段的默认工作内容。只有用户明确提出“把已经确认的 WhisperUI 方案回迁正式工程”后，才可以另行规划回迁范围、对应组件、测试和真实桌面验收。

在获得该明确指令前，所有第三阶段 Agent 都应把正式工程视为只读参照，不得顺手同步或提前应用原型变化。

## 第三阶段日志入口

第三阶段的事实来源和持续工作日志位于：

```text
C:\Users\Administrator\Desktop\WhisperUI\Log\README.md
```

新的第三阶段对话应以 `C:\Users\Administrator\Desktop\WhisperUI` 为工作目录，并首先阅读该日志入口。
