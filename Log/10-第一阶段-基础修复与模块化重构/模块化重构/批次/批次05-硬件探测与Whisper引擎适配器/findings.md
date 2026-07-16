# 批次 05 发现记录

## 已知上下文

- 当前为 `master` 普通 checkout；批次 0–4 的改动未暂存、未提交，继续原地工作以保持依赖连续性。
- 批次 4 完成后的全量测试为 194 passed，性能最大比值为 1.038，六份黄金输出未变化。
- 批次 5 只隔离硬件探测与推理库，依赖瘦身和统一应用服务属于后续批次。

## 盘点结果

- 四套 Core 都在 import 时设置 `HF_HOME`、导入 `faster_whisper.WhisperModel`、执行 `warnings.filterwarnings("ignore")`。
- 四套设备分支一致：无 CUDA 时为 `cpu/int8/cpu_threads=4`，有 CUDA 时为 `cuda/float16/cpu_threads=0`；模型始终为 `large-v3-turbo`、`num_workers=1`。
- 四套 `transcribe()` 的唯一区别来自既有 preset 参数；Core 均以媒体路径字符串调用并消费 `(segments, info)`。
- 现有 `test_core_cli_paths.py` 通过替换 Core 的 `WhisperModel` 和 `sys.modules["torch"]` 伪造运行时，应迁移为正式 engine 注入。
- GUI 为子进程显式传入 `HF_HOME`，本批不改变 GUI/CLI 组织；Core 直接运行路径改为显式 bootstrap。

## 设计决定

- `domain.transcription.TranscriptionEngine` 只定义库无关的 `transcribe()` 协议。
- `infrastructure.hardware.HardwareDetector` 延迟加载 Torch，并返回不可变 `HardwareInfo`。
- `infrastructure.whisper_engine.FasterWhisperEngine` 延迟加载 faster-whisper，集中模型定位、构造参数和调用委托。
- `bootstrap.configure_runtime()` 只在开始真实转录时显式设置 `HF_HOME` 与 warning 策略；导入 Core 不触发它。
- Core `main(engine=...)` 将允许 fake engine 完全绕过 Torch 与真实模型加载。

## 测试护栏

- CPU 与 CUDA 探测分别固定为既有 `cpu/int8/4 threads` 和 `cuda/float16/0 threads`。
- 适配器固定模型名 `large-v3-turbo`、`num_workers=1`，并原样透传 preset 的 `transcribe()` 参数与返回值。
- 四套 Core 的批处理测试直接注入 fake engine，并断言同一对象传到每个媒体处理调用。
- 独立子进程导入测试断言 Core import 后 `HF_HOME`、warning filters 不变，且 `torch`/`faster_whisper` 均未加载。

## 第一轮回归结果

- 完整测试 `205 passed in 0.35s`，共收集 205 条。
- `compileall` 通过。
- Core 中设置 `HF_HOME`、调用 `warnings.filterwarnings`、导入 Torch/faster-whisper/`WhisperModel` 的实现位置为 0。
- 运行时依赖只存在于显式 bootstrap 与两个 infrastructure 适配器；单独导入 engine 模块时 `torch=False`、`faster_whisper=False`。

## 性能与真实输出

- 24/24 benchmark 运行成功；四套 preset 的 `preset_id/script/model/params/postprocess/output` 与 baseline 完全一致。
- total process 中位数比值：cn cold/warm `1.012/1.003`，cn2 `1.003/1.000`，en `1.006/1.003`，en2 `0.997/0.993`；最大 `1.012 <= 1.20`。
- 固定中文音频的 cn/cn2 实际 GPU 转录文本均与独立 golden 相同，规范化 SHA256 均为 `83C3A8CAB6BDEB88CE0FF0B6C79C3BB73ADD9190E16388D17ECC05A0F4EF7ABD`，无 `.tmp`。
- Windows 输出文件使用 CRLF，而仓库 golden 使用 LF；Python universal-newline 比较完全相等。这是既有原子输出行为，不修改 golden 或输出实现。

## 入口验证

- console script 与 `python -m whisper_subtitle` help 均成功。
- `whisper-subtitle check` 退出码为 0。
- 四套 Core 模块 `--help` 均退出码 0。
- module/console 两种 GUI 在 `QT_QPA_PLATFORM=offscreen` 下均持续存活 3 秒。

## 最终审计

- 最终无缓存全量测试 `205 passed in 0.40s`；`git diff --check` 通过。
- 源码 29 个 Python 文件，内容聚合 SHA256 `A181B138E8317A906351219C9403496A12BAB8D52816C1413D5148D85D54E765`。
- 暂存区、`.workbuddy` 状态、跟踪基线备份差异、requirements 差异、项目 `.tmp`、缓存均为 0。
- Torch 三件套保留；当前工作树仍是批次 0–5 累计未提交状态。
