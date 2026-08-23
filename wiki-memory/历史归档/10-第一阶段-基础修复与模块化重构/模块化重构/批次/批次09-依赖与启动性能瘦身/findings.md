# 批次 09 发现记录

## 静态与运行时结论

- 生产代码没有 torchaudio 或 torchvision 调用。
- 实际推理由 faster-whisper/CTranslate2 执行，不使用 PyTorch 模型。
- CTranslate2 的 Python 规格模块会可选导入 Torch；Torch 存在时会顺带加载其自带 cuBLAS/cuDNN DLL。这解释了旧环境为什么能运行，也说明简单卸载 Torch 不足以证明 CUDA 运行时完整。
- CTranslate2 负责判断 CUDA 设备和计算类型；NVML 只补充 GPU 名称、驱动版本及显存数据。NVML 失败不会把可用 CUDA 错判为 CPU。
- Windows 下 `nvidia-cublas-cu12` 的原生库位于命名空间包的 `bin` 目录，需要在进程内注册并预加载。

## 原环境基线

- 环境体积：4,902,960,251 字节，4.566 GiB。
- Torch：约 4.083 GiB；torchaudio：约 0.009 GiB；torchvision：约 0.024 GiB。
- Torch 冷探测约 1.070–1.120 秒；批次 9 最终代码下旧环境完整冷探测 5 次为 1.369–1.448 秒。
- NVML 冷探测约 0.044–0.051 秒，但不能证明 CTranslate2 CUDA 计算可执行。
- CTranslate2 能报告实际 CUDA 设备数和 float16 支持，但仅探测设备仍不能证明 cuBLAS 已齐全。

## 候选验证纠错

- 最初通过复制 `whisper_env` 建立候选并卸载包。复制后的 Windows 虚拟环境入口/运行时可继续借用原环境，因此相关“无 Torch 全通过”数据不能作为删除证据。
- 随后使用 `venv` 从零建立 `F:\WhisperSubtitle_batch09_fresh`。该环境无 Torch 时，环境自检和 GPU 探测通过，但首次真实转写失败：`Library cublas64_12.dll is not found or cannot be loaded`。
- 安装 `nvidia-cublas-cu12` 及其传递依赖 `nvidia-cuda-nvrtc-cu12`，再由应用注册/预加载 DLL 后，真实 CUDA 转写成功。

## 最终全新候选

- 不包含：torch、torchaudio、torchvision。
- 包含：`nvidia-cublas-cu12 12.9.2.10`、`nvidia-cuda-nvrtc-cu12 12.9.86`、`ctranslate2 4.8.1`、`faster-whisper 1.2.1`。
- 分阶段从零安装耗时合计约 55.3 秒。
- 环境体积：1,414,860,906 字节，1.318 GiB；较原环境减少 71.1%。
- 冷硬件探测 5 次：0.294–0.312 秒。
- `pip check` 无损坏依赖；`246 passed`；`whisper-subtitle check` 通过。
- 中文 cn/cn2 均与 real golden 规范化文本完全一致；实际输出 SHA256 均为 `AB9BFF2E61B06DF8E49C20D483BE49A284C39D1E18089D1192F885C7634498FF`。
- GUI 使用 offscreen 平台启动后存活 3 秒。

## Benchmark 对比

每个 preset 分冷进程/暖系统缓存各 3 次，共 24 次。详细原始数据见 `candidate-runtime.json`。

| preset | 冷总耗时 | 冷/旧基线 | 暖总耗时 | 暖/旧基线 |
| --- | ---: | ---: | ---: | ---: |
| cn | 2.0756 s | 0.580 | 2.0819 s | 0.579 |
| cn2 | 1.9995 s | 0.555 | 2.0208 s | 0.564 |
| en | 2.0116 s | 0.558 | 2.0439 s | 0.571 |
| en2 | 2.0235 s | 0.564 | 2.0263 s | 0.563 |

- 模型加载中位数：1.1780–1.2069 秒。
- 转写至输出中位数：0.4524–0.5077 秒。
- 峰值进程内存：1800.14–1844.85 MiB。
- 峰值 GPU 显存：2318.20–2320.32 MiB，与旧方案同量级。
- cn/cn2 输出 SHA256：`69D77F85DDD53B7F98F9A0E63F3639D6F8D194F33430278B96CBAAE798E2CD3D`。
- en/en2 输出 SHA256：`D6AD4418CE220D3981878CB84FB903B6E483FF2497FCBD6A9D5C65C15463DE78`。

## 依赖决策

- 删除 torchaudio、torchvision：生产无调用，全新候选完整回归通过。
- 删除 torch：推理不使用 PyTorch；以更小的 NVIDIA cuBLAS Windows wheel 补齐实际 CUDA 运行时后，全新候选完整回归通过。
- 保留 `nvidia-cublas-cu12`：Windows 下 CTranslate2 CUDA 计算所需，版本限制为 CUDA 12 主版本。
- 保留 nvidia-ml-py：用于 GPU 元数据和显存监控，不作为 CUDA 能力权威。
- 保留 faster-whisper/CTranslate2：实际转写引擎及 CUDA 能力权威。
