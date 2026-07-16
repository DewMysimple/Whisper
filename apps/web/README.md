# React WebView presentation

This application is a desktop presentation surface, not a browser WebUI. Its production assets are compiled by Vite and loaded from `apps/web/dist` by the Tauri WebView.

Batch 5 runtime rules:

- `src/bridge/index.ts` selects `TauriDesktopBridge` only inside Tauri and retains `MockDesktopBridge` for browser tests/previews.
- No HTTP/WebSocket client or localhost service is required.
- Vite development assets use build-watch mode rather than a development server.
- Real files, folders, drag/drop, pasted paths, outputs and tasks cross only the typed Tauri command/event boundary.
- UI task state uses machine codes and identifiers, never localized Worker messages.
- Preset values shown by the presentation layer are aligned with the Python registry but are not a new runtime source of truth.
- Versioned local desktop state retains preferences and at most 100 task snapshots; configuration export excludes task history and logs.
- Performance trends use real Worker metrics in Tauri and bounded mock samples only in tests/previews.
- Output preview crosses a dedicated bounded Rust command and accepts only TXT/Markdown files.
- Playwright uses a temporary loopback Vite preview only while tests run; production keeps `connect-src 'none'` and starts no server.

From the repository root:

```powershell
npx --yes pnpm@10.34.5 check
npx --yes pnpm@10.34.5 build
```
