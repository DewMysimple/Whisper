# 执行3 任务计划

## 目标

按 `Requirement/执行3.md` 生成四个 preset 的 golden output 与性能基线，新增后处理和 presets 的 pytest 测试，并完成集成验证与执行报告；不修改任何业务代码。

## 阶段

- [complete] 0. 确认工作区隔离选择、业务源码哈希和现有功能基线
- [complete] 1. 运行四个 preset，生成 golden output、参数清单和性能基线
- [complete] 2. 新增后处理函数与 presets 结构单元测试
- [complete] 3. 集成验证、业务源码无改动校验和执行报告

## 约束与决策

- 延续用户此前明确选择：直接在当前工作区修改，不创建 worktree。
- 仅新增 `tests/` 与 `Log/执行3/` 内容；不得修改 `src/whisper_subtitle` 业务代码。
- 使用 `Log/执行2/baseline/regression_input.wav` 作为固定回归音频。
- 四个 preset 都必须实际运行；性能数据来自真实进程与 GPU 采样，不使用估算值。
- 保留并忽略用户已有的 `.claude/settings.local.json` 等无关状态；`.workbuddy` 不删除。

## 错误记录

| 错误 | 次数 | 处理 |
|---|---:|---|
| 基线 `pytest -q` 返回退出码 5：未收集到测试 | 1 | 属于第三阶段开始前的预期空测试状态；新增测试后要求返回 0 |
| Windows 下将 `WhisperProject*.py` 作为 rg 路径参数触发文件名语法错误 | 1 | 改用 rg 的 `-g 'WhisperProject*.py'` 文件过滤参数 |
| 首轮 NVML 采样在未发现匹配 compute-process 时将空列表误算为 0 MiB | 1 | 无匹配进程时返回不可用，回退为“设备峰值已用显存减启动前基线”，并重跑四个 preset |
