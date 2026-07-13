# 批次 09 进度日志

## 2026-07-13

- 完成生产依赖静态扫描，确认 torchaudio/torchvision 无调用，Torch 不参与模型推理。
- 记录旧环境 4.566 GiB 体积及 Torch/NVML/CTranslate2 探测基线。
- 将硬件检测改为 CTranslate2 能力判断 + NVML 元数据。
- 发现复制虚拟环境会污染候选结论，废弃相关“无 Torch 通过”证据。
- 从零创建隔离候选环境，复现无 Torch 时真实 CUDA 转写缺少 `cublas64_12.dll`。
- 验证 NVIDIA Windows `nvidia-cublas-cu12` wheel，并新增 CUDA DLL 目录注册/预加载适配器。
- 最终全新候选无 torch/torchaudio/torchvision，体积 1.318 GiB。
- 最终候选通过 `pip check`、`246 passed`、环境自检、中文 cn/cn2、24/24 benchmark 和 GUI offscreen 存活测试。
- 现有 `whisper_env` 未卸载任何包，最终代码回归 `246 passed`，环境自检及 wheel 构建通过。
- 更新 requirements/pyproject 及依赖契约测试；未暂存、提交、打标签或推送 Git，未修改 `.workbuddy`。
- 完成报告和临时环境清理。
