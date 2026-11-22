# 固定音频质量回归

保留原 `tests/benchmark/run_benchmark.py` 的四预设 golden 门禁。新增语料模式位于同目录，复用既有固定夹具、Worker 命令编码、进程树 RSS／NVML 采样和 Windows HANDLE 退出检查，不改变预设或识别逻辑。

在已安装项目的 Python 环境从仓库根运行（以下用该环境的 `python`）：

```powershell
python -m tests.benchmark.run_quality_benchmark --model-dir models/huggingface --output-dir tests/benchmark/runs/quality-before
python -m tests.benchmark.run_quality_benchmark --model-dir models/huggingface --output-dir tests/benchmark/runs/quality-after --baseline tests/benchmark/runs/quality-before/quality.json
```

每次使用新的输出目录，拒绝覆盖旧结果。可用 `--models large-v3-turbo qwen3-asr-1.7b` 限定模型，`--worker-executable` 验收冻结 Worker。运行全程离线，所有输出写入显式目录，原媒体和旧 golden 只读。

Windows 控制台运行既有后端验收时先设置 `$env:PYTHONIOENCODING='utf-8'`，避免控制台GBK不能输出Worker诊断中的字符。
`python -m tests.benchmark.run_backend_validation --output-dir tests/benchmark/runs/<new-run> --model-dir models/huggingface --worker-executable dist/WhisperSubtitle/_internal/worker/whisper-subtitle-worker.exe --qwen-first --cancel-qwen`
会在原模型切换／golden检查后额外执行三次Qwen取消及下一次正常任务，正常退出必须等待Windows进程HANDLE完成。

## 语料及参考

`tests/benchmark/quality_corpus.json` 提供八类固定清单。现有两段语音夹具及来源见 `tests/fixtures/README.md`；120 秒静音由精确零 PCM 生成。其他五类缺少可提交的授权音频和逐字参考，`path: null` 会产生 blocked 记录，绝不冒充已测试。长媒体、真实音乐和混合语音不能由重复短夹具代替验收。

复制清单到本地后填写相对该清单的 `path`、`reference_text`（缺失写 null，确认无语音写空串），可选 `reference_spans: [{"start":1.0,"end":2.5,"text":"..."}]`。将私人清单和结果放入被忽略的 runs 目录，不提交私人音频或绝对路径。固定输入后通过内容 SHA256 判断是否能比较。

## 指标语义

- CER/WER：NFKC、忽略标点、大小写归一后精确 Levenshtein；WER 使用空白分词，中文主要参考 CER。保留原始转录便于人工复核。
- 静音／音乐：参考为空时统计意外文本字符数量，不将 CER 分母设成假值。此数量是可复现的幻觉代理指标，不代表实际幻觉事件数。
- 漏识别：报告整段空输出和缺失的有时间参考短句；没有逐字对齐时不声称具备完整漏字率。
- 时间偏移：仅对唯一、归一化后完全匹配的字幕与参考短句计算起止边界绝对误差；模糊或多重匹配不伪造对齐。参考覆盖与匹配数同时报告。
- 每例冷 Worker，耗时含启动和模型加载至任务终态，速率为媒体时长／耗时。50ms 采样进程树 RSS，包括 Windows Python launcher；短峰值可能未捕获。NVML 进程显存不可用时为 null；设备显存峰值包含其他程序，单独标注，不冒称 Worker 专属。
- 模型与共享对齐模型记录本地配置和权重 SHA256；同时记录代码版本、dirty 标记、依赖版本、GPU／驱动、实际 SRT 所需字级时间戳参数。
- JSON 和 Markdown 同时生成。对比逐素材逐模型列出候选减基线的指标差值（正误差表示退化），输入／参考／参数改变则不比较；模型权重与环境变化需人工识别，不能将两次单次运行的速度波动称为优化收益。

真实设备缺失、模型缺失或任务失败时保留诊断；失败停止后续推理，避免累积异常 Worker。真实验收与单元测试明确分开。

## 独立性能探测

`python -m tests.benchmark.run_media_inspection_benchmark --baseline-worker <旧Worker.exe> --worker-executable <新Worker.exe>`
交替测量两版 Worker 的 stdio 往返。每版启动 30 个新进程，每次使用 5.32263 秒中文 WAV 及 32 份不同路径的副本。采集 Worker 就绪、首个容器检查、同进程缓存命中、批内首项和整批完成时间。两版共享操作系统文件缓存。记录原始样本，按 30 次门槛报告 P95。省略候选 EXE 参数可测源码，结果需注明物料类型。指令也测量探测子进程已启动时一个与两个并发槽的耗时。该基准的时钟从发出 Worker 命令起算，窗口反馈与 Host 路径发现需要分别测量。

桌面日志以导入 ID 关联 Host 和 Worker。Host 的 `path_check_ms` 累计顶层路径元数据检查，`directory_walk_ms` 累计递归遍历，`directory_sort_ms` 累计各目录的排序。`discovery_ms` 还包括准备来源数据和发出进度事件。`worker_elapsed_ms` 记录 Worker 批次检查时钟，`max_probe_ms` 记录最慢单项，两者与 Host 的 `ipc_ms` 所覆盖的时间重叠。

使用相同中文夹具测相邻任务的准备、首段进度和完整交付。每轮运行会启动一个新 Worker，默认由首任务加载模型，随后任务验证驻留复用及相同 golden。可加 `--preload` 单独计时预先加载同一模型的成本。支持启动取消的 Worker 可用 `--cancel-first-start` 核对取消确认、加载安全边界和后续模型复用。使用 `--worker-executable` 指定保留的基线 Worker，在同一台机器上交替测量基线和候选，每次使用新的输出目录。

```powershell
python -m tests.benchmark.run_worker_gpu_validation --model-dir models/huggingface --model-id qwen3-asr-1.7b --repeat-cn 2 --output-dir tests/benchmark/runs/task-timing-after
```

`request_to_observed_event_seconds` 从发送启动命令算起，包含调用方至 Worker 的传输时间。`task.queued` 表示真实受理，`first_segment_progress` 是首次收到非零媒体片段进度。新 Worker 另在 stderr 中记录每个成功文件的 `transcription.file`，以请求和任务 ID 关联。`first_nonempty_segment_seconds` 从调用推理引擎到第一段非空文本交给应用层，`inference_seconds` 包含解码、VAD、推理、对齐和实际执行的二次识别。`inference_rtf` 用该值除以已知媒体时长。`retry_attempts` 与生成、对齐耗时重叠，`audio_decode` 和 `alignment` 分别含调用内触发的依赖或对齐模型首次加载。Qwen 的 `first_generate_host` 和 `later_generate_host` 是生成调用的主机墙钟时间，生成结果的解析与剩余回读计入 `decode_generated`。`selected_window_seconds` 含 VAD 留白，关闭 VAD 时覆盖整个媒体。

小批量试验以同一个驻留 Qwen 实例交替运行 1／2／4，在每次完整文件测量的两端同步 CUDA，记录显存峰值、文本参考误差和输出哈希。生成语料来自仓库原有 WAV 的重复组合，`--srt` 打开真实对齐并汇总字幕结构。桌面和 CLI 使用串行窗。

```powershell
python -m tests.benchmark.run_qwen_window_benchmark --model-dir models/huggingface --output-dir tests/benchmark/runs/qwen-windows-txt
python -m tests.benchmark.run_qwen_window_benchmark --model-dir models/huggingface --fixture mandarin --repeat-fixture 8 --runs-per-batch 1 --srt --output-dir tests/benchmark/runs/qwen-windows-srt
```

`python -m tests.benchmark.run_decode_benchmark --output-dir tests/benchmark/runs/<new-decode-run>`
生成30／60／180分钟零PCM，在独立进程测生产解码的数组大小和峰值RSS；不加载识别模型，不能代替真实长语音、VAD或时间轴验收。

先 `corepack pnpm build`，再 `node tests/benchmark/run_persistence_benchmark.mjs tests/benchmark/runs/<new-storage-run>`，
用隔离Edge和临时loopback预览测100条任务的同步序列化／存储，包含常规模板与合成诊断上界。运行器关闭自己启动的服务和浏览器，不改变正式应用入口。结果不能外推为日常帧延时或优化收益。
