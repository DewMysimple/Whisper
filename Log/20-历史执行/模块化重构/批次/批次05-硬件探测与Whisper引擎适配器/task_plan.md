# 批次 05：硬件探测与 Whisper 引擎适配器

## 目标

隔离 GPU/CPU 探测与 `faster-whisper`，让 Core 不再直接依赖具体推理库，并移除 Core 导入时修改环境变量和全局 warning 策略的副作用。

## 约束

- 保留 torch、torchaudio、torchvision 依赖和 Torch 探测实现。
- 不合并 CLI/GUI，不改变模型、compute type、转录参数、输出路径或输出内容。
- 保留 `.workbuddy` 和用户已有改动。
- 不暂存、不提交 Git。

## 阶段

- [complete] 1. 核对仓库状态、既有边界并建立可复现基线
- [complete] 2. 盘点四套 Core 的硬件探测、模型加载、转录调用和导入副作用
- [complete] 3. 设计并实现协议、硬件探测器、FasterWhisper 适配器与显式 bootstrap
- [complete] 4. 将四套 Core 接入适配层并支持 fake engine 注入
- [complete] 5. 补充单元/契约/失败路径测试
- [complete] 6. 执行全量回归、性能基准、真实输出与入口烟雾验证
- [complete] 7. 清理临时产物、审计 Git 边界并输出执行报告

## 验收标准

- 应用测试可使用 fake engine，不加载真实模型。
- 真实四 preset 输出不变。
- 性能不超过既定回退阈值。
- 导入 Core 不再修改 `HF_HOME` 或全局 warning 策略。
- `.workbuddy` 无改动，Git 暂存区为空。

## 遇到的错误

| 错误 | 尝试次数 | 处理方式 |
|---|---:|---|
| PATH 默认 Python 缺少 pytest | 1 | 改用项目 `whisper_env` 中的 Python 运行时 |
| 当前 .NET 不支持 `Convert.ToHexString` | 1 | 改用 `BitConverter.ToString(...).Replace("-", "")` 计算聚合摘要 |
| Windows `rg` 不接受路径通配符 `core/*.py` | 1 | 改用目录参数与 `-g '*.py'` 过滤 |
| 旧 Core CLI 测试引用已移除的 `WhisperModel` | 1 | 迁移为 `main(engine=...)` fake 注入与适配器加载边界替换 |
| PowerShell 双引号破坏 `rg` 正则分组 | 1 | 改用单引号字面量重跑全局依赖审计 |
| PowerShell 原始文本比较将 CRLF 与 golden LF 判为不同 | 1 | 使用 Python universal-newline 文本比较并核对规范化 SHA256；内容完全一致 |
| 原生 console help 管道被 `Select-Object -First` 提前关闭 | 1 | 先完整捕获帮助输出再截取显示，避免原生进程返回 `-1` |
| 清理脚本对绝对 `__pycache__` 路径再次 `Join-Path` | 1 | 区分绝对/相对路径后重新校验工作区前缀并清理 |
