# 第二阶段：Tauri 桌面架构迁移

阶段状态：批次 0–6 `Complete / Accepted`；批次 7 `Implementation Complete / User Acceptance Pending`（2026-07-16）。

第二阶段收尾微调已完成：统一固定 pnpm 工具链、隔离 ESLint 与 Playwright 生成目录、移除发布脚本的用户路径绑定、清理冻结配置中的退役 GUI 残留，并同步当前打包说明与架构职责。该收尾不新增功能，也不改变批次 7 的验收状态。

本目录保存 ChatGPT 协作第二阶段的架构愿景、迁移计划和批次 0–7 执行证据。该阶段把桌面表现层从 PyQt5 迁移到 Tauri 2 + React/TypeScript WebView2，并使用受控 stdin/stdout IPC 管理 Python 常驻推理 Worker。

阶段完成后的正式形态：

- 桌面入口仅为 `whisper-subtitle-desktop.exe` 或安装版 Windows 快捷方式。
- React 只运行于 Tauri 内嵌 WebView2，不打开外部浏览器或 localhost 服务。
- Python 继续负责 faster-whisper/CTranslate2、CUDA、转录、后处理和输出。
- Python CLI 保留 `transcribe`、`check`、`worker`。
- PyQt5 表现层和 VBS 启动器已退役并进入 Windows 回收站。
- 当前发布介质仍未进行 Authenticode 签名，自动更新未启用。

## 阶段设计资料

- [新架构愿景与技术选型](新架构愿景与技术选型.md)
- [新架构推动计划书](新架构推动计划书.md)
- [分阶段迁移路线](分阶段迁移路线.md)

## 批次索引

| 批次 | 主要结果 | 报告 |
| --- | --- | --- |
| 0 | 架构决策、功能基线、Windows 11 x64 支持边界 | [执行报告](批次0-架构决策与产品基线/执行报告.md) |
| 1 | Desktop IPC v1 版本化跨语言契约 | [执行报告](批次1-版本化桌面协议/执行报告.md) |
| 2 | 常驻 Python Worker、队列、模型缓存与取消 | [执行报告](批次2-常驻PythonWorker/执行报告.md) |
| 3 | Tauri 2 + React/TypeScript 工程骨架 | [执行报告](批次3-TauriReact工程骨架/执行报告.md) |
| 4 | Tauri Host、Worker 与 WebView 真实链路 | [执行报告](批次4-TauriWorker真实链路/执行报告.md) |
| 5 | 任务历史、诊断、主题、无障碍与 E2E | [执行报告](批次5-产品体验与诊断/执行报告.md) |
| 6 | 冻结 Worker、便携目录、NSIS 离线安装与升级/卸载 | [执行报告](批次6-Windows打包安装与便携验证/执行报告.md) |
| 7 | Tauri EXE 正式切换、PyQt5 与 VBS 退役 | [执行报告](批次7-正式切换与PyQt5退役/执行报告.md) |

## 后续阶段编号

第二阶段结束后，不在本目录继续追加无关批次。新的大型目标应在 `Log/30-第三阶段-…/` 建立独立阶段目录和 `README.md`；第四阶段使用 `Log/40-第四阶段-…/`，以此类推。
