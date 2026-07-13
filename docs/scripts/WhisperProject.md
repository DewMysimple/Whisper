# WhisperProject.py — 英文标准版

> **版本**：英文标准版（Standard English）  
> **文件路径**：`src/core/WhisperProject.py`  
> **用途**：适合清晰、标准的英文发音，追求连贯性和流畅度  
> **对应 GUI**：英文标准版（`英文标准版` 模式）

---

## 使用场景

当你需要处理以下类型的英文视频时，选择此版本：

- **清晰、标准的英文发音**（美式、英式等标准口音）
- **背景噪音较小** 的音频环境
- **没有结尾重复幻觉** 问题的视频
- **追求连贯性** —— 希望上下文衔接自然，段落间逻辑连贯
- **英文课程、讲座、播客、采访** 等标准语音内容

**不适用场景**：
- 视频结尾有重复句子的幻觉问题
- 背景噪音极大（如户外嘈杂环境）
- 口音过重或发音不清的内容

---

## 版本说明书

### 核心设计目标

标准版的核心目标是**最大化转录连贯性**。它通过启用上下文依赖（`condition_on_previous_text=True`），让 Whisper 的解码器在生成后续文本时"回顾"前文，从而保持段落间的逻辑衔接和流畅度。

### 后处理流程

```
视频输入 → Faster-Whisper 转录 → 句子合并 → 英文标点补全 → 首字母大写修正 → 输出 TXT
```

1. **转录**：使用 `large-v3-turbo` 模型，强制英文语言检测
2. **句子合并**：按 `.` `!` `?` 标点合并片段为完整句子
3. **标点补全**：确保每句以英文标点结尾
4. **大小写修正**：句子首字母大写，专有名词修正（如 iPhone、YouTube、Monday 等）
5. **输出**：每行一句，纯文本 TXT，无时间戳、无文件头

### 输出位置

- 默认：视频所在目录的 `Text` 子文件夹
- 用户指定目录：使用 `-o` 参数指定
- 桌面保存（可选）：勾选"自动保存到桌面并转 Markdown"后，额外保存到 `C:\Users\Administrator\Desktop\Whisper语音列表\Text`

---

## 核心参数

### 转录参数（AI 模型推理层面）

| 参数 | 数值 | 作用说明 |
|------|------|----------|
| `language` | `"en"` | 强制识别英文，不自动检测语言 |
| `task` | `"transcribe"` | 仅转录，不翻译 |
| `beam_size` | `5` | 束搜索宽度，5 条路径并行解码 |
| `best_of` | `5` | 从 5 个候选中选最优 |
| `patience` | `1.5` | 束搜索耐心值，控制搜索时间 |
| `length_penalty` | `1.0` | 长度惩罚系数，平衡输出长度 |
| `temperature` | `0.0` | 采样温度为 0，确定性输出，降低随机性 |
| `compression_ratio_threshold` | `2.4` | 压缩比阈值，检测重复文本（较宽松） |
| `log_prob_threshold` | `-1.0` | 对数概率阈值，过滤低置信度内容（较宽松） |
| `no_speech_threshold` | `0.6` | 无语音阈值，低于此值视为静音（较敏感） |
| `condition_on_previous_text` | `True` | **启用上下文依赖**，利用前文提升连贯性 |
| `word_timestamps` | `False` | 不输出词级时间戳 |
| `vad_filter` | `True` | 启用语音活动检测，过滤空白静音 |
| `min_silence_duration_ms` | `300` | 300ms 静音视为断句点 |

### 初始提示（Initial Prompt）

```
"Please transcribe the following English audio accurately. 
Use proper punctuation, capitalization, and grammar. 
Ensure each sentence is complete and ends with a period, exclamation mark, or question mark."
```

这段提示告诉模型：
- 准确转录英文音频
- 使用正确的标点、大小写和语法
- 确保每个句子完整，以句号、感叹号或问号结尾

---

## 与其他版本的对比

| 特性 | 标准版 | 防幻觉版 | 中文版 |
|------|--------|----------|--------|
| 语言 | 英文 | 英文 | 中文 |
| 上下文依赖 | ✅ 开启 | ❌ 关闭 | ✅ 开启 |
| 重复检测 | 宽松（2.4） | 严格（2.0） | 宽松（2.4） |
| 后处理去重 | ❌ 无 | ✅ 有 `clean_repetition` | ❌ 无 |
| 连贯性 | ⭐⭐⭐ 最佳 | ⭐⭐ 良好 | ⭐⭐⭐ 最佳 |
| 抗幻觉能力 | ⭐⭐ 一般 | ⭐⭐⭐ 最强 | ⭐⭐ 一般 |
| 适合场景 | 清晰标准语音 | 有重复问题的视频 | 中文语音 |

---

## 使用命令

```bash
# 单文件（自动创建 Text 目录）
python src/core/WhisperProject.py "D:\视频\课程1.mp4"

# 文件夹（递归扫描）
python src/core/WhisperProject.py "D:\视频\课程文件夹"

# 强制指定输出目录
python src/core/WhisperProject.py "D:\视频\课程1.mp4" -o "D:\字幕"

# 同时保存到桌面
python src/core/WhisperProject.py "D:\视频\课程1.mp4" --desktop
```

---

*文档版本：2025-06-16*  
*对应代码版本：WhisperProject.py*
