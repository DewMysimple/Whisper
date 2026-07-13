# WhisperProject2.py — 英文防幻觉版

> **版本**：英文防幻觉版（Anti-Hallucination English）  
> **文件路径**：`src/core/WhisperProject2.py`  
> **用途**：重点修复视频结尾的重复幻觉问题，适合有重复问题的英文视频  
> **对应 GUI**：英文防幻觉（`英文防幻觉` 模式）

---

## 使用场景

当你需要处理以下类型的英文视频时，选择此版本：

- **视频结尾有重复句子**（如结尾静音段 Whisper 幻觉出同一句话重复多次）
- **背景噪音较大**（如户外、会议、嘈杂环境）
- **存在低置信度幻觉内容**（如模型"听不清"时编造的文本）
- **对重复容忍度极低**（需要严格干净的输出）
- **直播录屏、Zoom 会议、讲座录像** 等可能有静音尾段的视频

**不适用场景**：
- 要求极高连贯性的诗歌朗读或戏剧表演（上下文关闭可能降低连贯性）
- 极其清晰、标准发音的音频（标准版即可胜任）

---

## 版本说明书

### 核心设计目标

防幻觉版的核心目标是**最大化过滤重复和幻觉内容**。它通过调整 AI 模型参数（更严格的阈值、关闭上下文依赖）以及增加 Python 后处理函数，构建双重防线：

1. **第一道防线**：AI 模型参数收紧（更严格检测重复、低置信度内容）
2. **第二道防线**：Python 后处理 `clean_repetition()` 检测并删除重复行

### 后处理流程

```
视频输入 → Faster-Whisper 转录 → 句子合并 → 英文标点补全 → 首字母大写修正 → clean_repetition 去重 → 输出 TXT
```

与标准版相比，**多了一道 `clean_repetition` 步骤**。

### `clean_repetition` 函数详解

该函数有两道保险，都是**纯 Python 字符串比较**（`==`）：

**保险 1：截断尾部极端重复**
- 如果末尾有连续 4 句+完全相同，只保留第一句
- 场景：视频结尾有静音或背景音乐，Whisper 幻觉出同一句话重复 5~10 次

**保险 2：全文连续去重**
- 遍历所有句子，如果当前句与上一句完全相同，则跳过
- 场景：转录过程中某一句话被重复识别了两次

**注意**：只检测**完全相同的字符串**，不是语义相似度。如果两句话意思一样但用词不同，不会被视为重复。

### 输出位置

- 默认：视频所在目录的 `Text` 子文件夹
- 用户指定目录：使用 `-o` 参数指定
- 桌面保存（可选）：勾选"自动保存到桌面并转 Markdown"后，额外保存到 `C:\Users\Administrator\Desktop\Whisper语音列表\Text`

---

## 核心参数

### 转录参数（AI 模型推理层面）

| 参数 | 数值 | 作用说明 | 与标准版对比 |
|------|------|----------|-------------|
| `language` | `"en"` | 强制识别英文 | 相同 |
| `task` | `"transcribe"` | 仅转录，不翻译 | 相同 |
| `beam_size` | `5` | 束搜索宽度 | 相同 |
| `best_of` | `5` | 候选数量 | 相同 |
| `patience` | `1.5` | 搜索耐心值 | 相同 |
| `length_penalty` | `1.0` | 长度惩罚系数 | 相同 |
| `temperature` | `0.0` | 采样温度 | 相同 |
| `compression_ratio_threshold` | `2.0` | 压缩比阈值 | **更严格（2.4→2.0）** |
| `log_prob_threshold` | `-1.5` | 对数概率阈值 | **更严格（-1.0→-1.5）** |
| `no_speech_threshold` | `0.8` | 无语音阈值 | **更高（0.6→0.8）** |
| `condition_on_previous_text` | `False` | 上下文依赖 | **关闭（True→False）** |
| `word_timestamps` | `False` | 不输出词级时间戳 | 相同 |
| `vad_filter` | `True` | 启用语音活动检测 | 相同 |
| `min_silence_duration_ms` | `500` | 静音断句点 | **更长（300→500）** |

### 参数差异详解

| 参数 | 标准版 | 防幻觉版 | 效果 |
|------|--------|----------|------|
| `compression_ratio_threshold` | 2.4 | **2.0** | 更容易检测重复文本，更早触发重复过滤 |
| `log_prob_threshold` | -1.0 | **-1.5** | 更严格过滤低置信度内容，减少"听不清编造的"幻觉 |
| `no_speech_threshold` | 0.6 | **0.8** | 静音和噪声更不容易被当作语音，减少静音段的幻觉 |
| `condition_on_previous_text` | True | **False** | 关闭上下文依赖，每段独立解码，防止前文错误传染到后续 |
| `min_silence_duration_ms` | 300 | **500** | 更长静音才切割，确保句子完整，避免把结尾的幻觉截断到下一个片段 |

### 初始提示（Initial Prompt）

与标准版相同：

```
"Please transcribe the following English audio accurately. 
Use proper punctuation, capitalization, and grammar. 
Ensure each sentence is complete and ends with a period, exclamation mark, or question mark."
```

---

## 与其他版本的对比

| 特性 | 标准版 | 防幻觉版 | 中文版 |
|------|--------|----------|--------|
| 语言 | 英文 | 英文 | 中文 |
| 上下文依赖 | ✅ 开启 | ❌ **关闭** | ✅ 开启 |
| 重复检测 | 宽松（2.4） | **严格（2.0）** | 宽松（2.4） |
| 后处理去重 | ❌ 无 | ✅ **有 `clean_repetition`** | ❌ 无 |
| 连贯性 | ⭐⭐⭐ 最佳 | ⭐⭐ 良好 | ⭐⭐⭐ 最佳 |
| 抗幻觉能力 | ⭐⭐ 一般 | ⭐⭐⭐ **最强** | ⭐⭐ 一般 |
| 适合场景 | 清晰标准语音 | **有重复问题的视频** | 中文语音 |

---

## 使用命令

```bash
# 单文件（自动创建 Text 目录）
python src/core/WhisperProject2.py "D:\视频\课程1.mp4"

# 文件夹（递归扫描）
python src/core/WhisperProject2.py "D:\视频\课程文件夹"

# 强制指定输出目录
python src/core/WhisperProject2.py "D:\视频\课程1.mp4" -o "D:\字幕"

# 同时保存到桌面
python src/core/WhisperProject2.py "D:\视频\课程1.mp4" --desktop
```

---

*文档版本：2025-06-16*  
*对应代码版本：WhisperProject2.py*
