# Windows release packaging

The release pipeline builds one runtime for both delivery forms:

- a two-part Tauri 2 NSIS current-user offline installation medium with the Evergreen WebView2 offline installer and adjacent model pack;
- a complete portable directory containing the same desktop EXE, PyInstaller `onedir` Worker and direct local model.

Neither output requires Python, Node.js or Rust on the target machine. Windows 11 x64, a compatible NVIDIA GPU/driver and sufficient disk space remain external prerequisites.

## Build

From the repository root:

```powershell
corepack pnpm release:build
```

The script creates a fresh build virtual environment, installs only the pinned Worker/build requirements, builds the project wheel, freezes the headless Worker, generates a CycloneDX Python SBOM, builds the portable directory and then invokes Tauri's NSIS bundler. Existing generated release paths are moved to the Windows Recycle Bin before replacement.

Outputs are written below `dist/release/`. Keep the setup executable beside its `models/` directory: a guarded NSIS hook verifies the direct model before installation and copies it into the application directory without network access. Generated build state stays below `build/release/`; neither directory is tracked by Git. Corepack enforces the `packageManager` version declared in the root `package.json`, so a different global pnpm installation is not used.

## Runtime layout

```text
WhisperSubtitle-portable/
├── whisper-subtitle-desktop.exe
├── worker/
│   ├── whisper-subtitle-worker.exe
│   └── _internal/
├── models/large-v3-turbo/
├── distribution/
│   ├── README.md
│   └── sbom-python.cdx.json
└── release-manifest.json

WhisperSubtitle-offline-installer/
├── WhisperSubtitle_0.1.0_x64-setup.exe
├── models/large-v3-turbo/
├── distribution/
└── release-manifest.json
```

The Rust Host launches only `worker/whisper-subtitle-worker.exe` without a shell and injects `WHISPER_SUBTITLE_HOME` plus the packaged direct model path. The Worker continues to use stdin/stdout Desktop IPC v1 and never starts a local server.

Application preferences and WebView data remain in the current Windows user's Tauri/WebView2 profile. Copying the portable directory to another computer therefore does not carry machine-specific settings or old absolute output paths.

## Model and CUDA policy

- Each delivery medium contains one direct `large-v3-turbo` model snapshot, not the duplicated Hugging Face blob cache. The model remains adjacent to the NSIS setup because NSIS cannot reliably compile the combined 2.5+ GiB payload into one executable; the installer validates and copies it automatically.
- The Worker bundle contains the pinned `nvidia-cublas-cu12` runtime and CTranslate2 native binaries.
- NVIDIA display drivers are not redistributed and must be installed on the target machine.
- WebView2 uses the Evergreen runtime. The NSIS installer embeds Microsoft's x64 offline installer; the portable directory expects the Windows 11 Evergreen runtime already present.

## Signing

Release builds are unsigned unless a real Windows code-signing certificate is supplied. Copy `packaging/signing.example.json` to the ignored `packaging/signing.local.json`, replace all placeholders and pass it to the build script:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File packaging/build_release.ps1 `
  -SigningConfig packaging/signing.local.json
```

The values are merged into Tauri's `bundle.windows` settings so the desktop executable and NSIS installer are signed by the standard Tauri/SignTool pipeline. Private keys and local certificate configuration must never be committed.

## Upgrade and uninstall policy

Version upgrades use the stable Tauri identifier `local.whispersubtitle.desktop` and NSIS current-user install mode. A newer signed installer replaces the prior application files while preserving WebView user data. Uninstall removes installed application resources; user-created media/output is out of scope and must not be removed. Since batch 7, the only portable desktop entry is `whisper-subtitle-desktop.exe`; the VBS launcher and retired PyQt5 workspace are no longer part of the release.

Automatic network updating remains disabled. Batch 6 delivers offline installers and a documented manual upgrade path; enabling an updater requires a separately authorized signing, endpoint and rollback design.
