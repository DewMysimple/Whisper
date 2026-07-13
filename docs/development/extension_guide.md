# 扩展开发指南

## 新增 preset

1. 在 `domain/presets.py` 的 `PRESETS` 中增加一个 `Preset`。
2. 为它设置唯一 `id`、CLI `cli_alias`、显示信息、推理参数和 `postprocess_strategy`。
3. 若现有后处理链可复用，直接选择已有策略；无需创建脚本、应用服务或 GUI 分支。
4. 在 `tests/test_registry.py`、`tests/test_presets.py` 增加注册表与参数差异断言。
5. 增加固定输出并运行 benchmark/golden 门禁。

CLI choices、GUI 列表、设置恢复和进程参数都从同一注册表派生。新增 preset 不应修改 `TranscriptionService` 主流程。

## 新增后处理策略

1. 将纯函数放入 `domain/postprocess/` 对应模块。
2. 在 `strategies.py` 注册组合链和显示标签。
3. 输入输出保持推理库无关；不要在纯函数中访问磁盘、Qt 或 CTranslate2。
4. 为边界文本、空输入、重复内容和片段时间戳增加单元测试。

## 新增转录引擎

1. 实现 `domain.transcription.TranscriptionEngine` 协议的 `transcribe()`。
2. 将具体实现放在 `infrastructure/`，不要让 domain 导入第三方推理库。
3. 通过 `TranscriptionService(engine_loader=...)` 或 `run(..., engine=...)` 注入。
4. 验证返回片段具有 `text/start/end`，信息对象具有语言字段。
5. 增加适配器单元测试和真实端到端回归。

## 新增 UI 或自动化入口

1. 将用户输入转换为 `TranscriptionRequest`。
2. 进程内入口调用 application service；独立进程入口调用统一 CLI 的 JSONL 协议。
3. 只消费 `ProgressEvent` 和 `BatchResult`，不要解析 Core 脚本 stdout 或复制转录逻辑。
4. GUI 状态、窗口组件和进程控制放在 `presentation/`。

## 验证清单

```powershell
python -m pytest -q
python -m whisper_subtitle check
python -m tests.benchmark.run_benchmark --output final-benchmark.json
```

涉及 GPU 或依赖调整时，还必须在从零安装的隔离环境中验证真实中英文音频、四 preset、CLI、GUI 和显存。
