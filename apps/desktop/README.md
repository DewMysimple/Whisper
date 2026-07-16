# Tauri desktop host

This is the Tauri 2 / Rust host created in architecture batch 3, connected to the persistent Python Worker in batch 4, extended with batch 5 diagnostics and packaged for Windows in batch 6. It loads prebuilt React assets directly in WebView2.

Current boundary:

- controlled Python Worker child process in development and packaged sibling Worker lookup in release builds;
- whitelisted commands for Worker lifecycle, input inspection, dialogs, output reveal and bounded TXT/Markdown preview;
- no generic shell or network permission;
- CSP uses `connect-src 'none'`;
- strict Desktop IPC v1 validation before Worker messages reach the WebView;
- graceful Worker shutdown on normal application exit.
- read-only CPU/memory/GPU/VRAM sampling through the validated Worker protocol.

Batch 6 constructs a PyInstaller onedir Worker, a two-part offline NSIS medium and a complete portable directory. Batch 7 makes `whisper-subtitle-desktop.exe` the sole desktop entry and removes both the VBS launcher and PyQt5 from the release dependency graph. See `packaging/README.md`.
