# Tauri desktop host

This is the current Tauri 2 / Rust host. It loads prebuilt React assets directly in WebView2 and supervises the persistent Python Worker.

Current boundary:

- controlled Python Worker child process in development and packaged sibling Worker lookup in release builds;
- whitelisted commands for Worker lifecycle, input inspection, dialogs, output reveal and bounded TXT/Markdown/SRT preview;
- no generic shell or network permission;
- CSP uses `connect-src 'none'`;
- strict Desktop IPC v1 validation before Worker messages reach the WebView;
- graceful Worker shutdown on normal application exit.
- read-only CPU/memory/GPU/VRAM sampling through the validated Worker protocol.

The packaging pipeline constructs a PyInstaller onedir Worker and assembles `dist/WhisperSubtitle/WhisperSubtitle.exe` plus `dist/WhisperSubtitle.zip`; an offline NSIS medium is optional. The portable runtime is grouped under `_internal/`, while `whisper-subtitle-desktop.exe` below Cargo `target/` remains a developer artifact. VBS and PyQt5 are absent from the release dependency graph. See [the packaging guide](../../tools/release/README.md).
