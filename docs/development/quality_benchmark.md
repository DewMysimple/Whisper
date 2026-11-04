# 固定音频质量回归

保留原 `tests/benchmark/run_benchmark.py` 的四预设 golden 门禁。新增语料模式位于同目录，复用既有固定夹具、Worker 命令编码、进程树 RSS／NVML 采样和 Windows HANDLE 退出检查，不改变预设或识别逻辑。

在已安装项目的 Python 环境从仓库根运行（以下用该环境的 `python`）：

```powershell
python -m tests.benchmark.run_quality_benchmark --model-dir models/huggingface --output-dir tests/benchmark/runs/quality-before
python -m tests.benchmark.run_quality_benchmark --model-dir models/huggingface --output-dir tests/benchmark/runs/quality-after --baseline tests/benchmark/runs/quality-before/quality.json
```

每次使用新的输出目录，拒绝覆盖旧结果。可用 `--models large-v3-turbo qwen3-asr-1.7b` 限定模型，`--worker-executable` 验收冻结 Worker。运行全程离线，所有输出写入显式目录，原媒体和旧 golden 只读。

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

`python -m tests.benchmark.run_decode_benchmark --output-dir tests/benchmark/runs/<new-decode-run>`
生成30／60／180分钟零PCM，在独立进程测生产解码的数组大小和峰值RSS；不加载识别模型，不能代替真实长语音、VAD或时间轴验收。

先 `corepack pnpm build`，再 `node tests/benchmark/run_persistence_benchmark.mjs tests/benchmark/runs/<new-storage-run>`，
用隔离Edge和临时loopback预览测100条任务的同步序列化／存储，包含常规模板与合成诊断上界。运行器关闭自己启动的服务和浏览器，不改变正式应用入口。结果不能外推为日常帧延时或优化收益。
