# 批次 4：Tauri Worker 真实链路

状态：`Complete / Accepted`（2026-07-16）。用户随后明确提示进入批次 5，视为本批次验收通过。

本批次把批次 3 的 Tauri/React 桌面骨架接到批次 2 的 Python 常驻 Worker，形成不依赖 localhost、HTTP 或 WebSocket 的真实本地桌面链路。现有 PyQt5 GUI 继续作为回退入口。

- [执行报告](执行报告.md)
- [验收证据](validation.json)

本批次没有制作安装器或发布用 Python sidecar；开发态 Host 以固定参数直接启动工程 Python。发布态独立 Worker 产物及安装布局属于批次 6。
