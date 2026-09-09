# WhisperSubtitle

WhisperSubtitle is a local, offline-first subtitle transcription application for Windows 11 x64. It combines a Tauri 2 desktop shell, a React/TypeScript workbench, and a persistent Python Worker powered by `faster-whisper`/CTranslate2.

It is designed for people who want to transcribe their own audio and video files without uploading media to a web service. The application has no account system, no backend server, and no production localhost service. A compatible local Whisper model and NVIDIA runtime are external prerequisites for the packaged Windows workflow.

> Current status: active development, version `0.1.0`. The repository contains the source and the reproducible Windows packaging pipeline; generated release directories are not committed.

[中文说明](#中文说明) · [Architecture](#architecture) · [Installation](#installation) · [Development](#development) · [Documentation](#documentation)

## What it does

- Transcribes a single media file or a folder from the command line or the desktop application.
- Provides four shared Chinese/English presets, with the Python registry as the single source of truth.
- Produces TXT, Markdown, and timestamp-based SRT output.
- Keeps the inference model warm in a persistent Worker, with task queueing, cancellation, progress events, and idle model release.
- Supports both an interactive Tauri desktop workflow and a headless JSON-lines Worker for controlled integration.
- Performs bounded output previews and keeps the production WebView disconnected from arbitrary network endpoints.

## Presets

| CLI alias | Mode | Intended use |
| --- | --- | --- |
| `cn` | Chinese standard | Chinese speech with the standard context and post-processing strategy |
| `cn2` | Chinese anti-hallucination | Chinese speech with stricter thresholds, disabled previous-text context, and repetition cleanup |
| `en` | English standard | English speech with the standard context and post-processing strategy |
| `en2` | English anti-hallucination | English speech with stricter thresholds and trailing hallucination cleanup |

The default CLI preset is `en`. Desktop controls, generated Web settings, and Worker requests are derived from the same Python registry in `src/whisper_subtitle/domain/presets.py`. Supported model identities are maintained separately in `src/whisper_subtitle/domain/models.py` and projected into TypeScript and Rust by `scripts/generate_model_catalog.py`.

## Architecture

```text
React / TypeScript WebView
          │ typed DesktopBridge
          ▼
Tauri 2 / Rust Host
          │ validated Desktop IPC v1
          ▼
persistent Python Worker
          │
          ▼
TranscriptionService → faster-whisper / CTranslate2 → TXT / Markdown / SRT
```

The runtime boundary is deliberate:

- `apps/web` owns the desktop workbench, settings, task history, metrics, and presentation state.
- `apps/desktop/src-tauri` owns the native window, exact Tauri commands, Worker lifecycle, and protocol validation.
- `src/whisper_subtitle` owns model and preset catalogs, transcription orchestration, media discovery, runtime checks, post-processing, and output storage.
- `contracts/desktop_ipc/v1` defines the cross-language Desktop IPC contract.
- The production desktop loads local compiled assets and starts a controlled Worker process; it does not open a browser or listen on localhost.

## Installation

### Runtime prerequisites

- Windows 11 x64
- Python 3.10 or newer for source development
- Node.js 24.x and Corepack/pnpm for the React/Tauri development toolchain
- A compatible NVIDIA driver/GPU for the intended packaged workflow
- A local Whisper model, normally `large-v3-turbo`

### Set up the source tree

From PowerShell:

```powershell
git clone <repository-url>
cd WhisperSubtitle

py -3.10 -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -e ".[dev]"

corepack enable
corepack pnpm install
```

The model is not stored in Git. For source CLI usage, point the process at a compatible local model snapshot:

```powershell
$env:WHISPER_SUBTITLE_MODEL_DIR = "D:\models\large-v3-turbo"
```

The packaged desktop resolves its model from the packaged resource layout; the environment variable above is primarily for source CLI and Worker development. The environment check reports missing Python packages, GPU/CUDA information, and model path problems before transcription starts:

```powershell
python -m whisper_subtitle check
```

## Usage

### Command line

```powershell
# Transcribe one file using the Chinese anti-hallucination preset
whisper-subtitle transcribe "D:\media\lecture.mp4" --preset cn2

# Transcribe a folder and write results below a chosen output directory
whisper-subtitle transcribe "D:\media\course" --preset en2 --output "D:\transcripts"

# Emit machine-readable JSON-lines progress
whisper-subtitle transcribe "D:\media\interview.wav" --preset en --progress jsonl

# Also create the desktop-oriented Markdown output
whisper-subtitle transcribe "D:\media\interview.wav" --preset en --desktop
```

The same commands can be invoked without installing the console script:

```powershell
python -m whisper_subtitle transcribe "input.mp4" --preset en2
```

By default, results are organized into `Text`, `Markdown`, and `SRT` directories beside the input media. A custom `--output` directory and the optional `--desktop` output are available for workflows that need a separate export location.

### Desktop application

Build the WebView assets and launch the Tauri development application:

```powershell
corepack pnpm desktop:dev
```

To build the local desktop executable without creating an installer:

```powershell
corepack pnpm desktop:build
```

The current desktop acceptance executable is:

```text
apps/desktop/src-tauri/target/release/whisper-subtitle-desktop.exe
```

## Development

Useful commands from the repository root:

```powershell
# Frontend build
corepack pnpm build

# Repository and frontend checks: generated catalogs, hygiene, memory, format,
# lint, types, and browser unit tests
corepack pnpm check

# Python tests (use an interpreter where this project is installed)
.\.venv\Scripts\python.exe -m pytest -q

# Rust host checks
Push-Location apps/desktop/src-tauri
cargo fmt --check
cargo test --locked
cargo clippy --locked --all-targets -- -D warnings
Pop-Location

# Browser end-to-end tests
corepack pnpm e2e
```

The frontend's Vite/Playwright loopback server exists only for development and tests. It is not part of the production runtime. The Tauri host keeps `connect-src 'none'` in its production CSP, and the Worker communicates over controlled stdin/stdout JSON-lines rather than an HTTP endpoint.

## Windows packaging

The release pipeline can produce an offline current-user NSIS installer and a complete portable directory:

```powershell
corepack pnpm release:build
```

Release output is written under `dist/release/` and includes the desktop application, packaged Worker, direct model layout, distribution metadata, SHA-256 manifest, and Python SBOM. Target machines do not need Python, Node.js, or Rust, but they still need Windows 11, the required WebView2 runtime, a compatible NVIDIA driver, and the packaged model layout described in [packaging/README.md](packaging/README.md).

## Repository layout

```text
src/whisper_subtitle/       Python domain, application, Worker, CLI, and infrastructure
apps/web/                   React/TypeScript desktop workbench and browser tests
apps/desktop/src-tauri/     Tauri 2 / Rust host and Worker supervisor
contracts/                  Versioned Desktop IPC schemas
tests/                      Python, protocol, architecture, UI, and integration tests
docs/                       Current architecture, development, migration, and packaging docs
packaging/                  Windows offline installer and portable-build scripts
assets/                     Source assets copied into installable packages
wiki-memory/                Current engineering memory and historical audit records
AGENTS.md                   Agent startup, validation, memory, and delivery gates
```

Local models, virtual environments, caches, generated build output, and local Agent/tool state are intentionally outside the product source boundary. They are ignored, and periodic maintenance must not delete them without explicit authorization.

## Documentation

- [Current architecture](docs/architecture/current_architecture.md)
- [Extension guide](docs/development/extension_guide.md)
- [Periodic maintenance guide](docs/development/maintenance_guide.md)
- [Windows packaging](packaging/README.md)
- [Repository policy](docs/repository_policy.md)
- [Project documentation index](docs/README.md)
- [Engineering memory](wiki-memory/README.md)

## 中文说明

WhisperSubtitle 是面向 Windows 11 x64 的本地离线字幕转录工具。它使用 Tauri 2 + React/TypeScript 构建桌面界面，使用常驻 Python Worker 调用 `faster-whisper`/CTranslate2 推理，并输出 TXT、Markdown 和带真实片段时间戳的 SRT。

它不是在线网页服务：媒体文件和转录结果留在本机，生产桌面不启动 localhost 服务，也不依赖账号或后端。运行时需要本地 Whisper 模型；目标发布环境还需要兼容的 NVIDIA 驱动/GPU。

四种预设为：`cn` 中文标准、`cn2` 中文防幻觉、`en` 英文标准、`en2` 英文防幻觉。CLI、桌面界面和 Web 参数展示都从 `src/whisper_subtitle/domain/presets.py` 的同一注册表派生，避免界面参数与实际推理参数漂移。

默认情况下，结果会写到输入媒体旁的 `Text`、`Markdown`、`SRT` 文件夹。开发者可以先运行 `python -m whisper_subtitle check` 检查依赖、CUDA 和模型路径，再使用 `corepack pnpm desktop:dev` 启动桌面开发环境。

## License

This repository currently does not include a license file. Redistribution and reuse are not granted unless the maintainer provides separate permission.
