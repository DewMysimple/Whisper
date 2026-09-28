# Qwen3-ASR 本地后端

工程保留 Tiny、Base、Small、Medium、Large V3、Large V3 Turbo，并新增
`qwen3-asr-1.7b`、`qwen3-asr-0.6b`。默认仍为 `large-v3-turbo`；旧模型／preset
覆盖值不会迁移到 Qwen。新前端、Host 和 Worker 必须配套使用。

## 模型与安装

采用官方 **原生 Transformers `-hf` 格式**，不是 `qwen-asr` Python 包的旧格式。
后者配置和权重键不同，不能仅改文件夹名称后使用。

| 工程 ID | 官方仓库 | 本轮验证 revision |
| --- | --- | --- |
| `qwen3-asr-1.7b` | `Qwen/Qwen3-ASR-1.7B-hf` | `bcd2b5b7f32b480ab5790554cfa8347f246a14f3` |
| `qwen3-asr-0.6b` | `Qwen/Qwen3-ASR-0.6B-hf` | `7f1569a48a89f3e3f4dc3a5c9d28bddd903bc76c` |
| `qwen3-forced-aligner-0.6b` | `Qwen/Qwen3-ForcedAligner-0.6B-hf` | `c07281df297b9905d24a508279258cccf987a064` |

开发环境在项目解释器中安装 `pip install -e ".[qwen]"`。Torch 需要支持本机 GPU
的 CUDA 构建；本轮 Windows 验证使用 `torch 2.11.0+cu128`、`transformers 5.17.0`。
普通 `pip install -e .` 的 Whisper 依赖保持原样。所有 Torch／Transformers 导入均在
选择 Qwen 后发生。

开发模型根目录是 `models/huggingface`，便携版是 `_internal/models`。放置方式：

```text
模型根目录/
  large-v3-turbo/             # 原有 CTranslate2 模型，也可保留在 hub 缓存中
  qwen3-asr-1.7b/             # 完整 HF checkpoint
  qwen3-asr-0.6b/             # 可选的另一档 ASR
  qwen3-forced-aligner-0.6b/   # 两档 ASR 共用
```

也支持注册仓库的 Hugging Face `hub/models--*/snapshots/*` 缓存。检查包含配置架构、
processor、tokenizer、聊天模板和全部 safetensors 分片。两个 ASR 都需要完整的共享对齐
模型才显示可用；对齐权重只在任务首次要求时间戳时加载到内存。对齐模型不能作为独立
识别模型选择。

应用只读本地目录，所有 `from_pretrained` 都使用 `local_files_only=True`，没有自动
联网下载或云端回退。下载是部署步骤，可使用 Hugging Face CLI 或 ModelScope 的对应
原生 HF 仓库；必须保持官方文件内容完整。

CLI 示例：

```powershell
.\whisper_env\Scripts\python.exe -m whisper_subtitle transcribe tests/fixtures/chinese_short.wav --preset cn --model qwen3-asr-1.7b --model-dir models/huggingface -o build/qwen-example
```

## 共用边界

- `domain/models.py` 是模型身份、文件要求、后端和共享依赖的唯一来源，生成 Web、Rust
  投影。`domain/backend_parameters.py` 定义 Qwen 支持的参数和语言；同样投影到 Web、
  Rust 和 IPC 的模型条件限制。
- `infrastructure/engines.py` 选择模型适配器及实际硬件探测器。Whisper 继续使用
  CTranslate2；Qwen 使用 PyTorch。Worker 的缓存、队列、冻结快照、原子输出和后处理
  继续共用原流程。
- 两种探测器共用 `domain.execution.HardwareInfo`。Qwen 将单窗识别、强制对齐和
  线程作用域分开维护；成功、推理失败与对齐失败均在交出控制权前恢复 Torch 线程数。
  Windows 下 `load_torch()` 先调用公共 CUDA 初始化，避免先加载 Torch 后再加载
  NVIDIA wheel 时出现 cuBLAS DLL 入口不匹配。
- `audio_chunks.py` 复用已有 PyAV 解码和 Silero VAD，保留原媒体时间偏移，每个识别
  窗口最多 30 秒。关闭 VAD 后仍按窗口处理；不会拼接移除静音后再错误累计时间。
- `domain/transcription.py` 提供后端中立的片段、词和识别信息。Qwen 不伪造 Whisper
  对数概率或语言置信度。需要真实分区语言概率的旧二次识别仍只对原有模型开放。
- `domain/alignment.py` 把 ForcedAligner 的真实时间戳映射回原文，保留标点、空格和
  英文词内符号。对齐缺失／文字不匹配时明确失败，不生成平均分配的虚假时间戳。

## 参数和硬件

Qwen 页面开放 13 项实际生效的设置：语言、背景提示、术语、词级时间戳、token 上限、
窗口长度、VAD 开关及六项 VAD 参数。提示词应用到每个窗口。默认自动识别语言、确定性
解码、每窗口上限 440 token；达到上限且未自然结束时报告截断，缩短窗口后重试。
Whisper 的 36 项参数、温度回退、翻译能力和四 preset 参数保持原有行为。

CPU 使用 FP32；CUDA 自动优先 BF16，其次 FP16／FP32，以 PyTorch 实际能力为准。
Qwen 不支持当前 Whisper 工作台的 INT8 选项。已有显式 INT8 设置不会被静默改写，
需在硬件页选择“自动选择”或受支持精度。`system.environment` 可携带 `model_id`
查询对应后端，省略时保留原行为。CPU 线程设置只在 Qwen 推理范围内生效并恢复；卸载
时释放模型及该 CUDA 设备的缓存。

ASR 支持 30 种语言。SRT 逐词对齐支持中文、英语、粤语、法语、德语、意大利语、日语、
韩语、葡萄牙语、俄语、西班牙语；其他语言可使用 TXT/Markdown。对齐使用官方通用
CJK 字符／空格分词，避免引入平台相关的日／韩分词运行库。中文模式、英文模式继续
决定后处理与排版，不强制把音频翻译成该语言。

## 发布与验收

日常发布只保留最新完整目录和 SHA256；分发时运行 `corepack pnpm release:archive`。
成功构建默认清除发布中间态，需要复用 stage 时传 `-KeepBuild`，验收后再运行
`corepack pnpm workspace:finish`。本地权重和开发环境保留。

默认 `buildStart.cmd`／`tools/release/build.ps1` 构建含两个后端的 Worker，并打包当前
本地已安装的 Qwen ASR 及其共享对齐模型。`-WhisperOnly` 可构建不包含 Torch 的原后端
版本。无本地 Qwen 权重时仍可构建带 Qwen 运行库的便携版，之后手动安装模型。
`stage_models.py` 复用应用注册表校验模型，不凭任意 `model.bin` 猜测 Turbo。

`-OutputRoot <工程 dist 下的子目录>` 可生成独立验收版本。若目标目录中的程序仍运行，
组装过程在替换前报错；先完成构建后再关闭旧版并重新组装。

```powershell
# 单元／架构／旧输出回归
.\whisper_env\Scripts\python.exe -m pytest -q
corepack pnpm check
corepack pnpm e2e

# 明确执行真实离线模型验证；可追加 --worker-executable 指向冻结 Worker
.\whisper_env\Scripts\python.exe tests/benchmark/run_backend_validation.py --model-dir models/huggingface --output-dir build/qwen-validation/worker-source

# 冷进程先加载 Qwen，检查反向初始化与切换
.\whisper_env\Scripts\python.exe tests/benchmark/run_backend_validation.py --model-dir models/huggingface --output-dir build/qwen-validation/qwen-first --qwen-first
```

真实验证包括同一 Worker 的 Whisper → Qwen 1.7B → Qwen 0.6B → Whisper，连续任务缓存
复用、中英文三种输出、超过 30 秒且含长静音的媒体，以及切回后 cn/cn2 原 golden。
这些夹具证明适配和回归边界，不构成真实录音中所有识别质量的排名。

官方资料：[Qwen3-ASR](https://github.com/QwenLM/Qwen3-ASR)、
[原生 Transformers 模型与对齐接口](https://huggingface.co/docs/transformers/v5.17.0/model_doc/qwen3_asr)。
