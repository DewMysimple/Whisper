# 固定音频夹具

## `english_short.wav`

- 文本：`Hello, this is a whisper transcription regression test. The quick brown fox jumps over the lazy dog.`
- 来源：既有英文 benchmark 音频的逐字节副本；从归档材料复制到正式测试夹具目录，原档保留只读。
- SHA256：`AAC601EEE806B2981CD4EE61EC8F6CCB520DCACE422E6ADFDFE60C05E765CB4E`。
- 用途：四 preset 的冷进程／暖系统缓存 benchmark；新参数必须仍匹配既有四份文本 golden。

## `chinese_short.wav`

- 文本：`今天天气很好，我们一起测试中文语音转录。`
- 语音：Windows SAPI `Microsoft Huihui Desktop - Chinese (Simplified)`
- 格式：22.05 kHz、16-bit、单声道 PCM WAV
- 用途：为 cn/cn2 提供不依赖网络、可随仓库保留的真实中文音频回归输入。

该文件属于固定测试输入。若需替换，必须同时说明原因并显式更新中文回归元数据；不得因测试失败静默重生成。
