# 持续集成与真实发布验收

`.github/workflows/ci.yml` 在 push、pull request 和手动 `workflow_dispatch` 时运行。所有任务使用 GitHub 托管的 `windows-2025` x64 runner；这属于 Windows Server 自动化检查，不代表 Windows 11 上的真实桌面、GPU 或便携版验收。

## 普通 CI

| 任务 | 检查内容 | 版本与依赖 |
| --- | --- | --- |
| Repository, Web and browser E2E | `corepack pnpm check`；`corepack pnpm e2e` 内部先构建 Web，再运行 Playwright | Node 读取 `.nvmrc`，pnpm 读取 `package.json#packageManager`，`--frozen-lockfile` 安装；使用既有 Edge 通道 |
| Python 3.10 / 3.14 without models | `python -m pip install -e ".[dev]"`、`python -m pip check`、完整 `python -m pytest -q` | 验证最低支持版本与当前开发版本；只安装基础 Whisper 开发依赖，不安装 Qwen extra |
| Windows Rust Host | 先构建 Tauri 所需 Web 静态资源，再运行 `cargo fmt --check`、`cargo test --locked`、`cargo clippy --locked --all-targets -- -D warnings` | Rust、rustfmt 和 Clippy 读取根 `rust-toolchain.toml`；Cargo 使用现有锁文件 |

`pnpm check` 已包括仓库卫生、记忆、模型／预设生成投影、样式归属、Prettier、ESLint、TypeScript 与 Vitest，不再为这些内容另建重复检查。Python 3.10 使用开发依赖的条件 `tomli` backport；生产 Python 支持声明继续是 3.10+。可选 Qwen 后端的运行环境和真实识别由专门验收负责，基础 Python 矩阵不承诺 Qwen 支持每个矩阵版本。

Web 与 Python 的目录一致性检查都会执行真实生成器，因此两类任务均安装锁定的 Node／pnpm 依赖（包括 Prettier），并通过 `rustup show` 准备根 `rust-toolchain.toml` 指定的 Rust／rustfmt。完整 pytest 也需要这些生成工具，不能只安装 Python 依赖。toolchain 的 channel 只写编译器版本，Windows 目标通过 `targets` 单独声明，兼容当前 rustup。

测试不下载真实模型，也不依赖维护者模型目录。安装入口测试使用临时目录中的结构模型夹具，仅验证模型发现和 `check`，从不把夹具传入推理。Qwen 单元测试使用后端假对象。`tests/benchmark/run_*.py` 需要显式执行，不会被普通 pytest 收集。

无模型测试还会用临时 PCM 音频执行真实的共享解码器，检查 faster-whisper 与 PyAV 的调用兼容性。[PyAV 19 移除了 `metadata_errors`](https://github.com/PyAV-Org/PyAV/releases/tag/v19.0.0)，当前解码器仍使用该参数，源码依赖限制为 `<19`；发布固定已验的 PyAV 18.0.0，Python 3.10 使用仍支持该解释器的 17.0.0。该测试不加载识别模型，也不需要 GPU。

工作流设置只读仓库权限、同一分支／PR 新运行取消旧运行、任务超时和 pip／pnpm／Cargo 缓存。第三方 Actions 固定到官方版本的 commit。失败时上传七天诊断资料：Web 日志、Playwright HTML／trace／失败截图、pytest JUnit／日志、Cargo 日志。只上传工作流生成的诊断目录，不上传模型、用户媒体、用户输出或开发环境。CI 不发布公共 Release，也不修改保护规则。

## 本地复现普通检查

在已安装 `.[dev]` 的 Windows x64 Python 环境中，从仓库根目录执行：

```powershell
corepack pnpm install --frozen-lockfile
corepack pnpm check
corepack pnpm --filter @whisper-subtitle/web exec playwright install msedge
corepack pnpm e2e
python -m pytest -q
Push-Location apps/desktop/src-tauri
cargo fmt --check
cargo test --locked
cargo clippy --locked --all-targets -- -D warnings
Pop-Location
```

`e2e` 已生成 `apps/web/dist/`，供后面的 Rust/Tauri 测试使用。只运行 Rust 检查时，先单独执行 `corepack pnpm build`。

## Windows 11／GPU／冻结产物验收

普通 CI 没有默认等待自托管 GPU runner 的任务。发布验收由具备 Windows 11 x64、MSVC Build Tools、WebView2、匹配的 NVIDIA 驱动、完整本地模型和项目 Python 环境的机器运行；包含 Qwen 时，Python 环境还需安装项目 `qwen` extra。先检查前置条件，再构建便携版：

```powershell
.\buildStart.cmd -CheckOnly
corepack pnpm release:build
```

Whisper-only 套餐可通过 `powershell -NoProfile -ExecutionPolicy Bypass -File tools/release/build.ps1 -WhisperOnly` 构建，不据此声称 Qwen 验收通过。

完整 Qwen／Whisper 环境可以直接运行以下已有离线验收入口。每个目录保留该次日志、协议事件及报告；使用新目录避免混合旧证据：

```powershell
# 源码 Worker：真实 GPU、模型缓存复用和 Whisper golden。
$env:PYTHONUTF8 = '1'
python tests/benchmark/run_worker_gpu_validation.py --model-dir models/huggingface --output-dir build/validation/source-whisper

# 源码 Worker：Qwen 首次加载、两档识别、长窗时间偏移、SRT、切回 Whisper golden。
python tests/benchmark/run_backend_validation.py --qwen-first --model-dir models/huggingface --output-dir build/validation/source-backends

# 冻结 Worker：实际交付依赖、握手、真实识别、正常退出；使用交付内的模型。
python tests/benchmark/run_backend_validation.py --qwen-first --worker-executable dist/WhisperSubtitle/_internal/worker/whisper-subtitle-worker.exe --model-dir dist/WhisperSubtitle/_internal/models --output-dir build/validation/frozen-backends
```

正式桌面从 `dist/WhisperSubtitle/WhisperSubtitle.exe` 启动。实际操作验证 Worker 已完成握手并持续运行、普通旧文件覆盖确认及取消、批内／活跃任务撞名无法通过覆盖确认绕过、Whisper 与 Qwen 详情诊断、真实转录产物；关闭窗口后确认 Host 与受控 Worker 已回收。只看到 EXE 进程存活不算烟测通过。

验收记录分别列出源码单测、浏览器模拟、Rust Host、冻结 Worker、真实 GPU／模型、正式 EXE 的结果，并注明 commit／工作树状态、实际命令、报告位置以及通过／失败／未运行。不以历史通过结果替代当前验证；构建成功也不等于上述所有门禁通过。仓库任务日志和交付报告记录实际远程 CI 链接及状态。

## 工具行为参考

- [GitHub Windows runner 软件清单](https://github.com/actions/runner-images/blob/main/images/windows/Windows2025-Readme.md)
- [rustup toolchain 文件与组件](https://rust-lang.github.io/rustup/overrides.html#the-toolchain-file)
- [Playwright 持续集成与报告](https://playwright.dev/docs/ci-intro)
