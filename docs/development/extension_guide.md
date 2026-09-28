# 扩展开发指南

## 新增模型

1. 在 `src/whisper_subtitle/domain/models.py` 更新模型定义、能力和默认值。
2. 如模型身份需要跨进程传输，同步评审 `contracts/desktop_ipc/v1/desktop_ipc.schema.json`。
3. 运行 `python tools/codegen/generate_model_catalog.py`，更新 TypeScript 与 Rust 投影。
4. 运行 `python tools/codegen/generate_model_catalog.py --check` 和跨语言测试，禁止在 Web、Rust 或 Worker 中另建手工模型列表。

## 新增 preset

1. 在 `domain/presets.py` 的 `PRESETS` 中增加一个 `Preset`。
2. 为它设置唯一 `id`、CLI `cli_alias`、显示信息、推理参数和 `postprocess_strategy`。
3. 若现有后处理链可复用，直接选择已有策略；无需创建脚本、应用服务或 GUI 分支。
4. 在 `tests/test_registry.py`、`tests/test_presets.py` 增加注册表与参数差异断言。
5. 运行 `python tools/codegen/generate_preset_catalog.py` 更新 Web 参数投影，并确保 `corepack pnpm check:preset-catalog` 通过。
6. 增加固定输出并运行 benchmark/golden 门禁。

CLI choices、桌面 preset 卡片、设置恢复和进程参数都从同一注册表派生。新增 preset 不应修改 `TranscriptionService` 主流程。

显示标签和摘要可以在 `apps/web/src/data/presets.ts` 维护；推理参数不要在 TypeScript 中手工复制，统一从 Python 注册表生成。

## 新增后处理策略

1. 将纯函数放入 `domain/postprocess/` 对应模块。
2. 在 `strategies.py` 注册组合链和显示标签。
3. 输入输出保持推理库无关；不要在纯函数中访问磁盘、Qt 或 CTranslate2。
4. 为边界文本、空输入、重复内容和片段时间戳增加单元测试。

## 新增转录引擎

1. 实现 `domain.transcription.TranscriptionEngine` 协议的 `transcribe()`。
2. 将具体实现放在 `infrastructure/`，不要让 domain 导入第三方推理库。
3. 在 `infrastructure/engines.py` 注册后端及其硬件探测器；测试仍可通过 `TranscriptionService(engine_loader=...)` 或 `run(..., engine=...)` 注入。
4. 返回后端中立的片段、词与识别信息；没有语言概率时返回 `None`，不可编造概率或对齐时间戳。
5. 在模型注册表和 `domain/backend_parameters.py` 声明能力范围，生成 Web／Rust／schema 投影，避免复制任务、缓存或输出流程。
6. 增加适配器单元测试、真实端到端回归和切回旧后端的验证。Qwen 实例见 [本地后端说明](qwen_asr.md)。

硬件快照统一使用 `domain.execution.HardwareInfo`；硬件探测器实现
`infrastructure.engines.BackendHardwareDetector` 的 `capabilities()` 和 `resolve()`。
设备能力与自动精度选择仍由具体后端负责，共用契约不复制 CTranslate2／Torch 算法。
Windows 上加载推理依赖前先调用 `configure_cuda_runtime()`，并覆盖不同后端的首次加载顺序。
模型缓存统一由 Worker 管理；空闲计时器须校验代次，防止已经取消的旧回调释放新模型。

## 新增 UI 或自动化入口

1. 将用户输入转换为 `TranscriptionRequest`。
2. React 组件只调用 typed `DesktopBridge`；原生 Tauri import、invoke 和事件订阅只放在 `apps/web/src/bridge/`。
3. 只消费 `ProgressEvent` 和 `BatchResult`，不要解析 Core 脚本 stdout 或复制转录逻辑。
4. React 状态和组件留在 `apps/web`；进程、窗口和原生权限留在 Tauri/Rust Host。Python `presentation/` 仅服务 CLI/JSONL 展示。

## UI 开发循环

- `corepack pnpm web:dev` 在 `http://127.0.0.1:1420` 启动 Vite/HMR，适合使用 mock bridge 快速调整纯界面。
- `corepack pnpm desktop:dev` 由 Tauri 自动启动同一个 Vite 服务，适合验证真实文件选择、Worker、通知和其他原生桥接。
- localhost 只属于开发模式；`corepack pnpm build`、桌面 Release 和最终 `dist/WhisperSubtitle/` 始终使用静态 `apps/web/dist/`，不会启动 Vite。
- `apps/web` 与 `apps/desktop` 是有意保留的职责边界；不要为了缩短路径把 React、Rust 或生成目录混在一起。

## 验证清单

```powershell
.\whisper_env\Scripts\python.exe -m pytest -q
corepack pnpm check
python tools/codegen/generate_model_catalog.py --check
python tools/codegen/generate_preset_catalog.py --check
python tools/maintenance/check_repository_hygiene.py
python wiki-memory/工具/memory_lint.py check
python -m tests.benchmark.run_benchmark --output final-benchmark.json
```

涉及 Rust Host 时还需运行 `cargo fmt --check`、`cargo test --locked` 和 clippy。涉及 GPU 或依赖调整时，还必须在从零安装的隔离环境中验证真实中英文音频、四 preset、CLI、桌面应用和显存。
