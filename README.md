# WhisperSubtitle

WhisperSubtitle 是一个面向 Windows 11 x64 和 NVIDIA GPU 的本地离线字幕转录工具，使用 Tauri 2 + React/TypeScript WebView2 桌面表现层与 faster-whisper/CTranslate2 Python Worker，提供统一 CLI 和四种中英文 preset。

## 常用命令

```powershell
# 环境检查
python -m whisper_subtitle check

# 图形界面（便携版）
.\dist\release\WhisperSubtitle-portable\whisper-subtitle-desktop.exe

# 转录
whisper-subtitle transcribe "input.wav" --preset cn
whisper-subtitle transcribe "input.mp4" --preset en2 -o "output"
```

可用 preset：`cn`、`cn2`、`en`、`en2`。模型默认从便携目录 `models/huggingface`、`WHISPER_SUBTITLE_MODEL_DIR`、`HF_HOME` 或用户缓存中解析。

正式桌面入口是 `whisper-subtitle-desktop.exe`：安装版使用开始菜单/桌面快捷方式，便携版直接运行 `dist/release/WhisperSubtitle-portable/whisper-subtitle-desktop.exe`。程序不打开浏览器，也不启动 localhost 服务。Python CLI 保留 `transcribe`、`check` 和 `worker`；原 PyQt5 `gui` 子命令与 VBS 启动器已在新架构批次 7 退役。

## 开发验证

```powershell
python -m pytest -q
python -m whisper_subtitle check
```

架构、扩展方法和资料保留规则见 [docs/README.md](docs/README.md)。
