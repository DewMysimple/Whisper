# 功能测试 011：媒体时长、SRT 伴随 TXT 与运行交互保护

日期：2026-07-25。  
状态：自动化、正式冻结 Worker、真实 PyAV/CUDA 与正式 Desktop 启动烟测通过。

## 范围

验证媒体真实时长、未知时长降级、SRT/TXT 成组输出、模型硬件忙碌锁定、双层进度、剩余媒体徽标、8 秒自动追踪、无限会话日志、并发清空及 Windows 原生关闭保护。

## 自动化结果

| 层级 | 结果 |
| --- | --- |
| Python | `299 passed` |
| Rust | `28 passed, 2 ignored` |
| Vitest | `74 passed` |
| Playwright | `10 passed` |
| TypeScript / ESLint / Prettier / Vite | 全部通过 |

覆盖重点：

- 文件与递归文件夹时长聚合、缓存命中、未知时长、旧历史兼容；
- SRT/TXT 两文件冲突、自动同后缀重命名、续接和字节一致；
- 忙碌时 UI 与状态层双重拒绝模型/硬件修改；
- `0/N`、当前媒体进度、任务剩余媒体徽标；
- 人工滚动后 8 秒暂停、再次操作重置计时、恢复追踪及减少动态效果；
- 205 行日志不裁剪、Host/前端同步清空和并发事件顺序；
- Host 从 `task.queued` 到三种终态维护活动任务集合，窗口关闭回调不执行阻塞健康查询。

## 真实媒体与 CUDA

正式 Worker：

`F:\WhisperSubtitle\apps\desktop\src-tauri\target\release\worker\whisper-subtitle-worker.exe`

SHA-256：

`99FD1922A7FE5263FDC1C30850690DF5538FC5F54CA51635D980837BCCB48267`

PyAV 实测：

- `tests\fixtures\chinese_short.wav`：`5.32263 s`
- `build\error007-validation\input\programming-thinking-intro-45s.mp4`：`45.1 s`

在 `large-v3-turbo`、CUDA GPU 0、FP16 下逐一执行 `cn`、`cn2`、`en_v1`、`en_v2`。四个任务全部成功，每个任务输出一个 `.srt` 和一个 `.txt`；同组文件大小和 SHA-256 完全相同。

完整记录：

`build\batch25-validation\runs\20260725-030630\validation.json`

## Desktop

正式 Desktop：

`F:\WhisperSubtitle\apps\desktop\src-tauri\target\release\whisper-subtitle-desktop.exe`

SHA-256：

`4131FAD932D10B726E1F316A2778ABE06A41964530D9A82C817C15F8C65A176A`

启动烟测确认 Desktop 与相邻 Worker 同时启动，主窗口正常响应；无活动任务关闭后 Desktop、Worker 均正常退出且无残留进程。

活动任务原生确认中的“否/是”真实鼠标选择未在无人值守自动化中执行，以避免误终止真实任务；默认“否”、原生 MessageBox、活动任务判定及确认后的安全退出链路已通过代码、Rust 测试和 Release 编译。

## 结论

本次功能门禁通过。普通 TXT/Markdown 输出、Preset、模型参数、CUDA 选择和 SRT 时间轴未发生未经授权的语义变化。
