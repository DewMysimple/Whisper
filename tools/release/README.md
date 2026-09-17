# Windows release packaging

The release pipeline keeps compiler output and user delivery separate:

- `build/release/` is disposable intermediate state (fresh Python environment, PyInstaller work, stage files and generated Tauri config).
- `dist/WhisperSubtitle/` is the complete, directly runnable portable application.
- `dist/WhisperSubtitle.zip` contains the portable folder contents at the ZIP root, matching the adjacent directory.
- `dist/installer/` is created only by the explicit installer command.

The raw Cargo executable below `apps/desktop/src-tauri/target/release/` is a developer artifact and is not a complete delivery package.

## Portable build

From the repository root:

```powershell
corepack pnpm release:build
```

The command creates a clean release environment, builds and freezes the headless Worker, copies one direct offline model snapshot, builds the Tauri desktop host, assembles the portable directory, writes a manifest, and creates the adjacent ZIP. Existing generated paths owned by this release pipeline are sent to the Windows Recycle Bin before replacement.

```text
dist/
├── WhisperSubtitle/
│   ├── WhisperSubtitle.exe
│   ├── 使用说明.md
│   └── _internal/
│       ├── worker/
│       │   ├── whisper-subtitle-worker.exe
│       │   └── _internal/
│       ├── models/large-v3-turbo/
│       ├── distribution/
│       │   ├── README.md
│       │   └── sbom-python.cdx.json
│       └── release-manifest.json
├── WhisperSubtitle.zip
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
- The portable package contains the desktop host, PyInstaller `onedir` Worker, CUDA user-mode dependencies and one direct `large-v3-turbo` model snapshot.
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
