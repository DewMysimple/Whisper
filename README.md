# WhisperSubtitle

WhisperSubtitle 是一个面向 Windows 和 NVIDIA GPU 的本地离线字幕转录工具，使用 faster-whisper/CTranslate2，提供统一 CLI、PyQt5 GUI 和四种中英文 preset。

## 常用命令

```powershell
# 环境检查
python -m whisper_subtitle check

# 图形界面
python -m whisper_subtitle gui

# 转录
whisper-subtitle transcribe "input.wav" --preset cn
whisper-subtitle transcribe "input.mp4" --preset en2 -o "output"
```

可用 preset：`cn`、`cn2`、`en`、`en2`。模型默认从便携目录 `models/huggingface`、`WHISPER_SUBTITLE_MODEL_DIR`、`HF_HOME` 或用户缓存中解析。

## 开发验证

```powershell
python -m pytest -q
python -m whisper_subtitle check
```

架构、扩展方法和资料保留规则见 [docs/README.md](docs/README.md)。
