# WhisperSubtitle 中文使用说明

## 启动

双击同目录中的 `WhisperSubtitle.exe` 即可启动。软件是本地离线应用，不会启动浏览器或本地网站。

请保留整个 `WhisperSubtitle` 文件夹，不要只复制 EXE。`_internal` 中包含转录 Worker、CUDA 用户态依赖、离线模型和发布校验资料，缺少任何一部分都可能导致软件无法启动或无法转录。

## 系统要求

- Windows 11 x64
- 兼容的 NVIDIA GPU 与已安装的 NVIDIA 驱动
- Windows WebView2 Evergreen Runtime（Windows 11 通常已安装）
- 足够的磁盘空间用于媒体、离线模型和转录输出

## 基本使用

1. 在“开始任务”中选择一个或多个媒体文件或文件夹。
2. 选择转录预设和需要的 TXT、Markdown、SRT 输出格式。
3. 确认输出位置后开始任务。
4. 默认输出会按格式写入媒体旁的 `Text`、`Markdown`、`SRT` 文件夹。

## 复制与解压

`WhisperSubtitle.zip` 与同名文件夹内容一致，可复制到其他 Windows 11 x64 电脑后完整解压使用。不要直接在压缩包内运行，也不要让解压工具遗漏 `_internal` 目录。

## 数据与更新

媒体、设置和转录结果都保留在本机。当前版本不自动联网更新；替换版本前请退出软件，用户自己的媒体与输出不应放进应用目录的 `_internal` 中。
