# 报错处理 005：任务通知显示为 Windows PowerShell

日期：2026-07-22。

状态：已修复；自动化回归、Windows 原生通知身份测试、正式 EXE 更新及启动烟测均已通过。

## 1. 用户可见现象

真实任务完成后，Windows 通知横幅虽然显示正确的任务标题和输出数量，但发送者名称及图标为 `Windows PowerShell`，不是 WhisperSubtitle 和软件使用的蜘蛛侠图标。

本问题只影响 Windows 系统通知的来源身份与图标，不影响任务终态、转录内容、模型、Preset、输出文件或 Worker。

## 2. 根因

前端原先通过 `@tauri-apps/plugin-notification` 发送通知。该插件在 Windows Release EXE 位于 Cargo `target\release` 目录时，会把它视为未安装开发产物，不设置正式 AppUserModelID；底层 `notify-rust` 随后回退到 `Toast::POWERSHELL_APP_ID`。

因此截图显示 PowerShell 并不是启动命令或用户操作造成的，而是免安装 EXE 在插件兼容路径上的明确回退行为。只更换标题、正文或前端图标无法改变发送者身份。

## 3. 修复

### 3.1 注册 WhisperSubtitle 自有 Windows 身份

新增 Windows 专用通知模块，使用稳定标识：

```text
local.whispersubtitle.desktop
```

软件启动时在当前用户下登记 `Software\Classes\AppUserModelId\local.whispersubtitle.desktop`：

- `DisplayName = WhisperSubtitle`；
- `IconUri = %LOCALAPPDATA%\WhisperSubtitle\notification-logo.png`；
- `IconBackgroundColor = 0`；
- 同时调用 `SetCurrentProcessExplicitAppUserModelID`，使进程和通知使用同一身份。

蜘蛛侠 PNG 直接编译进 Desktop EXE，首次运行或资源变化时写入上述本地应用数据路径，不依赖 PowerShell、浏览器、网络、安装包或源码目录。

### 3.2 由 Rust 直接发送原生通知

前端终态通知不再调用 Tauri Notification 插件，而是调用本地命令 `show_app_notification`。Rust 使用 `tauri-winrt-notification` 和 WhisperSubtitle 自有 AppUserModelID 发送 Toast，并显式传入圆形蜘蛛侠图标。

通知结构保持：

- 标题：完成、失败或取消；
- 第一行：真实任务名称；
- 第二行：真实终态详情；
- 声音：继续调用一次现有 Windows `MessageBeep`，Toast 本身设为静音，避免双重播放。

任务栏注意提示和通知失败隔离保持不变；通知失败不会反向改变已经落地的任务终态。

### 3.3 终态次数保护保持不变

本轮没有改动 `workspace.ts` 已有的终态幂等门禁：

- `task.progress` 不触发完成通知；
- 同一任务第一个终态生效；
- 取消后晚到完成、重复取消或重复完成不会再次通知。

## 4. 测试与验收

- 前端 Vitest：12 个文件、40 项全部通过；
- 通知与终态定向测试：2 个文件、8 项全部通过；
- TypeScript：通过；
- ESLint：通过，0 warning；
- Vite production build：通过；
- Playwright：9/9 通过；
- Rust：18 项通过，3 项按设计忽略；
- Rust 格式检查：通过；
- Windows 原生品牌通知测试：显式执行 1 项并通过；
- 注册表实测：`DisplayName` 为 `WhisperSubtitle`，`IconUri` 指向本地蜘蛛侠 PNG；
- 本地图标 SHA-256：`1AD04589B6072733667BFB0A1D8C6B0B4DCF45236B92373E9CFFF4666B319D15`；
- 隔离 Release 候选构建：通过，未生成安装程序；
- 候选启动烟测：进程响应正常，窗口标题为 `WhisperSubtitle`；
- 正式入口启动烟测：Desktop PID `38604`、Worker PID `28640` 均从正式目录启动，窗口正常响应并通过 `CloseMainWindow` 干净退出；
- 正式入口读取到的通知身份：`WhisperSubtitle`，图标为本地蜘蛛侠 PNG。

第一次隔离 Release 构建在并行编译依赖时无代码诊断退出；限制 `CARGO_BUILD_JOBS=2` 后完整构建通过，未改动实现代码。

## 5. 产物与当前门禁

- 旧正式 Desktop SHA-256：`7EFC97A7C54D3F4B5B4452DBDCFA2AF3A872EAF9FF4DDD736A87290893B08878`；
- 最终正式 Desktop SHA-256：`CCC2B3C97B31E9C2DC738B24C4BCE13095E1AAEE3CBA45744A99DA2FF287FAC7`；
- Worker SHA-256：`A7244BFFF309D2FB458B1B410F7B2008BC59DD5BA543EDA48F3674012738AA49`，本轮未修改；
- 可恢复旧 EXE 检查点：`F:\WhisperSubtitle\build\internal-checkpoints\error005-notification-20260722-2210`。

首次准备替换时，正式 Desktop PID `37132` 和 Worker PID `32336` 仍在运行。为避免中断可能存在的真实任务，没有强制结束进程或覆盖正在使用的 EXE。用户确认正常关闭后，旧正式 EXE 与恢复检查点哈希一致，随后才用已验收候选替换唯一正式 Desktop EXE。替换后正式文件与候选哈希一致；Worker 保持原文件和哈希。

## 6. 边界与保护

- 未修改 Python Worker、转录算法、faster-whisper、CTranslate2、CUDA、模型或硬件配置；
- 未修改 Desktop IPC v1、Preset、文件命名、输出路径或输出行为；
- 未修改第三阶段 `C:\Users\Administrator\Desktop\WhisperUI`；
- 未生成安装程序或发布包；
- 未修改、暂存或提交 `.claude\settings.local.json`、`.workbuddy` 及其他既有本地修改；
- 未执行 Git 暂存、提交、分支、标签、推送或发布。
