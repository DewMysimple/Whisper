# 功能测试 012：V3 与 Turbo 参数校准及多语言原声保留

日期：2026-07-26  
状态：自动化、真实 CUDA、冻结 Worker 与正式 Desktop 验收通过；窗口内密集 code-switch 保留仍有模型边界

## 测试目标

验证 Large‑V3 与 Large‑V3‑Turbo 在四个 Preset 下：

1. 不调用翻译任务；
2. Preset 语言只负责排版；
3. 异常阈值能触发真实温度回退；
4. 输出无繁体、乱码、错误标点组合和精确长循环；
5. tiny/base/small/medium 仍使用旧参数。

## 测试素材

- 完整媒体：  
  `C:\Users\Administrator\Desktop\Obsidian仓库\DeepLearning\DataBase\凯尔特柚\Vedio\2022-03-18 18.42.39-视频-凯尔特柚-图书馆求婚后续想跟你们聊聊社交媒体焦虑.mp4`
- 时长：约 429.034 秒。
- 90 秒独立 WAV：`build\batch26-validation\mixed-language-first-90s.wav`。
- 人工标准文本及两份旧模型输出：`C:\Users\Administrator\Desktop\实战测试`。
- 所有新输出均写入 `build\batch26-validation`，未覆盖取证文件。

## 参数候选的真实淘汰过程

### 失败候选 1：语言提示词 + 逐窗多语言

- V3 中文标准 90 秒仅留下 458 字符，并出现韩语。
- V3 英文标准把中文内容改成英文。
- 结论：提示词仍会把格式选择重新变成语言偏置，淘汰。

### 失败候选 2：无提示词 + `multilingual=True`

- 输出长度恢复，但 30 秒混合窗口仍会整体选择英文或韩语。
- 根因：faster-whisper 1.2.1 的 `multilingual=True` 是逐 30 秒窗口选择一个语言令牌，并非句子级 code-switch。
- 结论：不能把该参数宣传为完整的中英混合保留，淘汰。

### 最终方案

- `language=None`
- `task=transcribe`
- `multilingual=False`
- `language_detection_segments=5`
- `language_detection_threshold=1.0`，强制完成多窗口投票
- Large‑V3 温度阶梯：`0.0, 0.2, 0.4, 0.6, 0.8, 1.0`
- Turbo 温度阶梯：`0.0, 0.2, 0.4, 0.6`
- 防幻觉阈值：compression `2.0`、log probability `-1.0`、no speech `0.6`

## 完整媒体结果

| 模型 | Preset | CUDA/精度 | 推理耗时 | 字符/行 | 乱码/繁体 | 长循环签名 |
| --- | --- | --- | ---: | ---: | --- | --- |
| Large‑V3 | cn2 | CUDA FP16 | 68.332s | 2064 / 42 | 0 / 0 | 未发现 |
| Large‑V3‑Turbo | cn2 | CUDA FP16 | 16.668s | 2141 / 46 | 0 / 0 | 未发现 |

共同结果：

- `求婚` 在 V3 中正确，Turbo 仍为 `结婚`，属于声学识别差异。
- 原报告中的 `�`、繁体 `錄/謝`、`，。` 已消失。
- 原报告的八连“工作要做”和“我认为”循环签名未出现。
- Turbo 保留 `Are you busy?` 与 `I'm free`，撇号完整。
- V3 对该短英语对白仍倾向中文改写；后处理中不再主动把已识别英文改成中文，但不能恢复模型未输出的英文。

## 自动化与正式产物

- Python：315 passed。
- Rust：28 passed，2 ignored。
- Vitest：77 passed。
- Playwright：10 passed。
- Prettier、ESLint、TypeScript、Vite build：通过。
- 冻结 Worker 环境检查返回 `available=true`，OpenCC 数据与 DLL 正常装载。
- 正式 Desktop/Worker 启动烟测通过，退出后无残留进程。

正式文件：

- Desktop：`apps\desktop\src-tauri\target\release\whisper-subtitle-desktop.exe`
- Worker：`apps\desktop\src-tauri\target\release\worker\whisper-subtitle-worker.exe`

## 验收边界

本次完成的是“参数误配、错误后处理和错误承诺”的整改，不宣称解决 Whisper 的所有复杂声学错误。密集 code-switch 若发生在同一 30 秒解码窗口，仍可能按主语言改写；进一步改善需要语音段级检测与时间轴重组，属于新的推理链路设计，必须另开样本和授权。

