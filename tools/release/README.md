# Windows release packaging

The release pipeline keeps compiler output and user delivery separate:

- `build/release/` is disposable intermediate state (fresh Python environment, PyInstaller work, stage files and generated Tauri config).
- `dist/WhisperSubtitle/` is the complete, directly runnable portable application.
- `dist/WhisperSubtitle.zip` is generated only on request, with the portable folder contents at the ZIP root.
- `dist/installer/` is created only by the explicit installer command.

The raw Cargo executable below `apps/desktop/src-tauri/target/release/` is a developer artifact and is not a complete delivery package.

## Portable build

From the repository root:

```powershell
corepack pnpm release:build
```

On Windows, double-click the repository-root `buildStart.cmd` for the same portable build. The window stays open to show the result. It builds the current local source tree and refreshes `dist/WhisperSubtitle/` and `dist/WhisperSubtitle.sha256`.

For a browser UI preview on a machine that does not package desktop releases, use `runStart.cmd`. A Git checkout does not include local Python environments, model weights or `dist/`; those are ignored artifacts. Their absence on another development machine does not mean workspace cleanup deleted them.

The build no longer requires an environment named `whisper_env`. It uses an explicit `-BootstrapPython` first, then the active `VIRTUAL_ENV`, existing repository environments (`whisper_env`, `.venv`, `venv`, `env`), `python.exe` on PATH, or the Windows `py -3` launcher. Candidates must be working Windows x64 Python 3.10+ interpreters with `venv` and `ensurepip`; an invalid explicit override fails instead of silently choosing another interpreter. Release dependencies are still installed into the disposable build environment, not the selected interpreter.

Before creating or clearing build files, the script checks Python, local model bundles, Node/Corepack and Cargo availability. Models come from `-ModelDir`, then `WHISPER_SUBTITLE_MODEL_DIR`, then `models/huggingface`. Missing prerequisites are reported together; the script does not recreate a deleted development environment or download models. Cargo lookup is shared with assembly and respects PATH and `CARGO_HOME`.

```powershell
# Check this machine without starting a build or downloading dependencies
.\buildStart.cmd -CheckOnly

# Use existing resources elsewhere on a packaging machine
.\buildStart.cmd -BootstrapPython "C:\path\to\python.exe" -ModelDir "D:\path\to\models"
```

`-CheckOnly` checks local discovery and model structure, not compilation or inference. A full desktop build also needs the pinned Rust toolchain, Visual Studio C++ Build Tools, project Node dependencies and access to the pinned Python build dependencies.

The command creates a clean release environment, builds and freezes the headless Worker, copies validated offline model bundles, builds the Tauri desktop host, and verifies every file in a staged portable directory before replacing the current version. Generated artifacts are permanently removed through a shared path guard, without accumulating them in the Windows Recycle Bin. Close the application before replacement; assembly checks for running processes, tracked files and linked directories.

Successful builds remove `build/release/` and the extra Worker resources copied into Cargo output. Pass `-KeepBuild` to retain them temporarily for debugging. Failed builds retain diagnostics; finish cleanup after verification. The release directory keeps its complete independent model and runtime copies and remains portable.

To distribute the current verified release without rebuilding:

```powershell
corepack pnpm release:archive
```

Use `corepack pnpm release:build:archive` (or `buildStart.cmd -IncludeArchive`) to build with a ZIP. At the end of a completed maintenance task, `corepack pnpm workspace:finish` verifies the current directory and removes generated build/test caches, old dated release backups and the optional ZIP. Models, the development environment and the current runnable directory are preserved.

The default Worker includes Whisper and Qwen3-ASR. It bundles Turbo plus any complete local Qwen ASR bundles and their shared ForcedAligner. Qwen adds the PyTorch CUDA and Transformers runtime; the initial dependency download and final package are substantially larger. Model files must already be present: the application does not download them.

```powershell
# Original Whisper runtime only
powershell -NoProfile -ExecutionPolicy Bypass -File tools/release/build.ps1 -WhisperOnly

# Separate validation package while the current portable app is running
powershell -NoProfile -ExecutionPolicy Bypass -File tools/release/build.ps1 -OutputRoot "$PWD/dist/qwen-validation"
```

With `-KeepBuild`, `tools/release/assemble.ps1` can reuse the prepared `build/release` stage without downloading or freezing dependencies again. Finish cleanup after validation. See [Qwen deployment and backend contracts](../../docs/development/qwen_asr.md).

```text
dist/
├── WhisperSubtitle/
│   ├── WhisperSubtitle.exe
│   ├── 使用说明.md
│   └── _internal/
│       ├── worker/
│       │   ├── whisper-subtitle-worker.exe
│       │   └── _internal/
│       ├── models/                 # Turbo and available Qwen bundles
│       ├── distribution/
│       │   ├── README.md
│       │   └── sbom-python.cdx.json
│       └── release-manifest.json
├── WhisperSubtitle.zip             # optional, on request
└── WhisperSubtitle.sha256
```

Users launch only `WhisperSubtitle.exe`. The technical runtime is deliberately grouped under `_internal`; the EXE must not be separated from that directory. Neither the folder nor the ZIP needs Python, Node.js or Rust on the target machine.

## Optional offline installer

Build the portable package and the NSIS current-user installer medium together:

```powershell
corepack pnpm release:build:installer
```

The extra output is isolated below `dist/installer/`:

```text
installer/
├── WhisperSubtitle-Setup.exe
├── 使用说明.md
└── _internal/
    ├── models/large-v3-turbo/
    ├── distribution/
    │   ├── MicrosoftEdgeWebView2RuntimeInstallerX64.exe
    │   └── sbom-python.cdx.json
    └── release-manifest.json
```

Keep the installer executable beside its complete `_internal` directory. Release assembly validates the WebView2 installer's Microsoft signature; the guarded NSIS hook checks that the adjacent prerequisites are present, installs WebView2 without a network request, and copies the model into the installed application's `_internal/models/` directory.

The build uses a valid Microsoft-signed `MicrosoftEdgeWebView2RuntimeInstallerX64.exe` already present in Tauri's local cache. On a clean build machine, download the official x64 offline installer first and pass it explicitly:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools/release/build.ps1 `
  -IncludeInstaller `
  -WebView2Installer C:\path\to\MicrosoftEdgeWebView2RuntimeInstallerX64.exe
```

## Runtime and model policy

- Windows 11 x64, a compatible NVIDIA GPU/driver and sufficient disk space remain external prerequisites.
- The portable package contains the desktop host, PyInstaller `onedir` Worker, CUDA user-mode dependencies, a direct `large-v3-turbo` snapshot and locally installed Qwen bundles unless `-WhisperOnly` is selected.
- WebView2 uses the Evergreen runtime. The optional installer medium carries Microsoft's signed x64 offline installer in `_internal/distribution/`; Tauri bundling performs no prerequisite download. The portable application expects the Windows 11 runtime to be present.
- The Rust Host launches only `_internal/worker/whisper-subtitle-worker.exe` without a shell and injects the packaged `_internal/models` path. Desktop IPC remains stdin/stdout JSONL.
- Application preferences and WebView data remain in the current Windows user's profile; copying the portable directory does not copy prior settings or output paths.

## Signing

Release builds are unsigned unless a real Windows code-signing certificate is supplied. Copy `tools/release/signing.example.json` to the ignored `tools/release/signing.local.json`, replace the placeholders, and run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools/release/build.ps1 `
  -SigningConfig tools/release/signing.local.json
```

Private keys and local certificate configuration must never be committed. Automatic network updating remains disabled.
