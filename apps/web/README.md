# React WebView presentation

This application is a desktop presentation surface, not a browser WebUI. Its production assets are compiled by Vite and loaded from `apps/web/dist` by the Tauri WebView.

Runtime rules:

- `src/bridge/index.ts` selects `TauriDesktopBridge` only inside Tauri and retains `MockDesktopBridge` for browser tests/previews.
- No HTTP/WebSocket client or localhost service is required.
- Vite development assets use build-watch mode rather than a development server.
- Real files, folders, drag/drop, pasted paths, outputs and tasks cross only the typed Tauri command/event boundary.
- UI task state uses machine codes and identifiers, never localized Worker messages.
- Preset and model capabilities shown by the presentation layer come from generated projections of the Python domain catalogs; TypeScript is not a second source of truth.
- Versioned local desktop state retains preferences and at most 100 task snapshots; configuration export excludes task history and logs.
- Performance trends use real Worker metrics in Tauri and bounded mock samples only in tests/previews.
- Output preview crosses a dedicated bounded Rust command and accepts TXT, Markdown, and SRT files only.
- Native attention and power-countdown notifications cross `DesktopBridge`; UI modules do not import Tauri APIs directly.
- Playwright uses a temporary loopback Vite preview only while tests run; production keeps `connect-src 'none'` and starts no server.

From the repository root:

```powershell
corepack pnpm check
corepack pnpm build
```
