# 批次 09：依赖与启动性能瘦身

## 目标

在不破坏当前 `whisper_env` 的前提下，通过全新隔离环境验证可删除依赖，并比较 Torch、NVML 与 CTranslate2 探测方案的正确性和性能。

## 边界

- 不在现有 `whisper_env` 中卸载任何包。
- 不以静态“无 import”替代真实 CUDA 转写验证。
- 不重写引擎或 GUI，只调整硬件探测、Windows CUDA 运行时适配和依赖声明。
- 只有全新候选环境完整回归通过，才能落盘删除项。
- 不暂存或提交 Git，不修改 `.workbuddy`。

## 阶段

- [complete] 1. 记录当前环境包、磁盘体积、启动/探测基线与静态依赖证据。
- [complete] 2. 比较 Torch、NVML、CTranslate2 三种硬件探测来源。
- [complete] 3. 验证移除 torchaudio/torchvision 的候选方案。
- [complete] 4. 从零建立无 torch/torchaudio/torchvision 的候选环境，并补齐最小 CUDA 运行时。
- [complete] 5. 验证四 preset、真实中英文音频、pytest、benchmark、入口与 GUI。
- [complete] 6. 比较环境体积、安装、探测、模型加载、转写、显存与输出哈希。
- [complete] 7. 更新依赖声明，完成最终回归、清理候选环境并输出报告。

## 验收结果

- torchaudio、torchvision、torch 均有静态证据和全新环境真实 CUDA 证据。
- 最终候选环境与当前环境隔离，未在 `whisper_env` 内卸载包。
- 最终候选：`246 passed`、环境自检、24/24 benchmark、中文 cn/cn2、GUI 存活全部通过。
- 环境由 4.566 GiB 降到 1.318 GiB，减少 71.1%。
- 四 preset 输出哈希不变，总耗时中位数为旧基线的 55.5%–58.0%。

## 遇到的错误

| 错误 | 尝试次数 | 处理 |
| --- | ---: | --- |
| 复制虚拟环境后入口脚本仍可能指向原环境，造成“无 Torch 候选通过”的假象 | 1 | 废弃复制候选的结论，改用 `venv` 从零建立候选环境 |
| 全新无 Torch 环境在首次 CUDA 计算时报 `cublas64_12.dll` 缺失 | 1 | 增加 `nvidia-cublas-cu12`，不再把驱动探测成功误判为运行时完整 |
| NVIDIA Windows wheel 的 `bin` 目录不会自动进入 DLL 搜索路径 | 1 | 新增运行时适配器，注册目录并按绝对路径预加载 cuBLAS DLL |
| `find_spec("nvidia.cublas")` 在父命名空间不存在时抛出异常 | 1 | 捕获 `ImportError/ModuleNotFoundError`，保证无 wheel 的旧环境仍可运行 |
| PowerShell 向 Python 标准输入传递中文路径时发生编码替换 | 1 | 通过环境变量传递已解析的绝对路径 |
