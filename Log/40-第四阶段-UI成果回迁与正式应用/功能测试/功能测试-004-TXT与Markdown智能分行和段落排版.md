# 功能测试 004：TXT 与 Markdown 智能分行和段落排版

测试日期：2026-07-22。  
状态：自动化、最终冻结 Worker、原 P17 真实 CUDA 和正式 EXE 启动验收全部通过。

## 1. 测试目标

验证长视频的 TXT 不再因模型缺少句末标点而成为万字单行，同时保证 Markdown 使用可读短段落，并且不修改识别词、Preset 推理语义、SRT 时间轴或旧输出文件。

原正式输出事实：

- 文件：`Text\P17-核心语法-11-计算机的存储规则.txt`；
- 字符数：10,943；
- 非空逻辑行：1；
- 根因：旧逻辑只在 segment 末尾强标点处结束句子。

## 2. 判定标准

- 强标点可以在同一个 segment 内结束句子；
- `1.5` 等小数和 `Dr.`、`e.g.` 等常见缩写不误断；
- 0.8 秒真实停顿产生新行，1.8 秒真实停顿产生 Markdown 段落；
- 80 单位后在弱标点、空格或 segment 边界优先换行；
- 最终行宽不超过 120 单位，单个不可拆英文 token 除外；
- TXT 一句一行，Markdown 每 3 句/240 单位或长停顿形成短段落；
- 忽略空白后 TXT 与 Markdown 内容一致；
- 防幻觉清理继续生效，删除重复后保留正确时间和段落边界；
- SRT-only 不调用文本排版层；
- 旧输出不自动扫描、不自动重写。

## 3. 自动化结果

- 新增 `tests\test_transcript_layout.py`：6/6；
- 文本排版、输出写入、SRT 隔离、应用层和 Worker 针对性测试：50/50；
- Python 全量：262/262；
- Rust：15 项通过，2 项按设计忽略；
- Prettier、ESLint、TypeScript、Vitest 27/27、Vite production build：通过；
- Playwright：8/8；
- Tauri `--no-bundle` Release：通过。

SRT 隔离测试把 `build_transcript_document()` 替换为主动失败桩，SRT-only 仍成功生成既有预期字幕，证明字幕任务没有依赖本次文本排版代码。

## 4. 原 P17 真实 CUDA 验收

最终验收使用：

- 媒体：原 `P17-核心语法-11-计算机的存储规则.mp4`；
- Worker：最终 PyInstaller 精简候选，829 文件；
- 模型：正式目录中的真实 `large-v3-turbo`；
- 设备：CUDA / float16；
- Preset：`cn2`；
- 输出目录：`build\batch18-p17-smart-layout-verified`。

生命周期：

1. `worker.ready`；
2. `model.load(large-v3-turbo)` → `model.ready`，设备为 `cuda`、精度为 `float16`；
3. `transcription.start` → `task.queued`，真实冻结模型为 `large-v3-turbo`；
4. `task.completed`，成功 1、失败 0；
5. `worker.shutdown`，退出码 0。

输出统计：

| 项目 | 结果 |
| --- | --- |
| TXT 非空逻辑行 | 228 |
| Markdown 段落 | 76 |
| TXT 最长行 | 118 显示单位 |
| 硬上限 | 120 显示单位 |
| 两格式忽略空白后内容 | 完全一致 |
| 原用户 TXT | 未修改 |

开头输出已经从单行恢复为自然句行，例如“哈喽，各位同学，接下来给大家讲点好玩的东西。”、“咱哥们来聊一下计算机的存储规则。”分别占行；Markdown 将连续三个句行组合为短段落。

## 5. 输出路径与正式产物

- 自定义根目录下 TXT/Markdown 继续直接写入根目录；
- 媒体旁 TXT 与 Markdown 副本分别使用对应排版；
- 单格式目录覆盖、冲突失败、自动重命名和 UTF-8 原子写入回归通过；
- 最终正式 Worker 与验收候选 SHA-256 一致：`257776FDFC4D2D02AEE6DE3C624470584DCE94E5AE104A8783D49811D61193FA`；
- 正式 Desktop 启动后正确拉起相邻 Worker，关闭后无残留进程；
- 没有生成安装程序或发布包。

## 6. 结论

本次功能质量问题已修复。新任务可以利用真实标点、segment 停顿和长度兜底生成稳定句行；Markdown 进一步形成短段落。转录推理、四个 Preset、防幻觉规则和 SRT 时间轴未改变。已存在的万字单行文件仍保持原样，用户需要重新转录才能获得基于真实 segment 时间信息的最佳排版。
