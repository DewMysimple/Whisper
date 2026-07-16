# 旧入口迁移映射

批次 10 经用户确认后移除了五个大写兼容模块。文件已发送到 Windows 回收站，没有永久删除。

| 旧入口 | 新入口 |
| --- | --- |
| `core.WhisperProject` | `whisper-subtitle transcribe INPUT --preset en` |
| `core.WhisperProject2` | `whisper-subtitle transcribe INPUT --preset en2` |
| `core.WhisperProjectCN` | `whisper-subtitle transcribe INPUT --preset cn` |
| `core.WhisperProjectCN2` | `whisper-subtitle transcribe INPUT --preset cn2` |
| `gui.WhisperPyQtGUI` | 批次 7 后使用安装快捷方式或便携版 `whisper-subtitle-desktop.exe` |
| 旧模块后处理函数 | `whisper_subtitle.domain.postprocess` |
| 旧模块 `process_video/main` | `TranscriptionRequest` + `TranscriptionService` |
| `core.presets` 字典 | `whisper_subtitle.domain.presets` 类型化注册表 |
| `utils.test_env` | `infrastructure.environment_check`；旧路径暂保留转发 |

旧 `Preset.module/script` 元数据已删除。preset 现在只包含业务身份、显示信息、推理参数和后处理策略。

新架构批次 7 已退役 `python -m whisper_subtitle gui` / `whisper-subtitle gui` 和 VBS 启动器。保留的 Python CLI 子命令为 `transcribe`、`check` 和 `worker`；桌面界面只由 Tauri EXE 承担。
