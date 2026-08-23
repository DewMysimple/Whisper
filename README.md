# WhisperSubtitle

WhisperSubtitle 是一个面向 Windows 11 x64 和 NVIDIA GPU 的本地离线字幕转录工具，使用 Tauri 2 + React/TypeScript WebView2 桌面表现层与 faster-whisper/CTranslate2 Python Worker，提供统一 CLI、四种中英文推理 preset，以及 TXT、Markdown 和基于真实片段时间戳的 SRT 输出。

## 常用命令

```powershell
# 环境检查
python -m whisper_subtitle check

# 图形界面（当前唯一开发/验收入口）
.\apps\desktop\src-tauri\target\release\whisper-subtitle-desktop.exe

# 转录
whisper-subtitle transcribe "input.wav" --preset cn
whisper-subtitle transcribe "input.mp4" --preset en2 -o "output"
```

可用 preset：`cn`、`cn2`、`en`、`en2`。模型默认从便携目录 `models/huggingface`、`WHISPER_SUBTITLE_MODEL_DIR`、`HF_HOME` 或用户缓存中解析。

当前工作区唯一用于桌面验收的入口是 `apps/desktop/src-tauri/target/release/whisper-subtitle-desktop.exe`，每轮正式 UI 更新后都必须重新构建该文件。`dist/release` 只在明确执行完整发布流程时重新生成；发布目录中的 EXE 必须与当时的验收版本哈希一致，不得作为独立的旧版本长期保留。安装版使用开始菜单/桌面快捷方式，便携版在完整发布后运行其目录中的同版 EXE。程序不打开浏览器，也不启动 localhost 服务。Python CLI 保留 `transcribe`、`check` 和 `worker`；原 PyQt5 `gui` 子命令与 VBS 启动器已在新架构批次 7 退役。

## 开发验证

```powershell
python -m pytest -q
python -m whisper_subtitle check
```

架构、扩展方法和资料保留规则见 [docs/README.md](docs/README.md)。项目 Agent 记忆从 [wiki-memory](wiki-memory/README.md) 开始；历史执行档案位于其 `历史归档/` 子目录。
