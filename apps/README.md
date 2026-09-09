# Desktop presentation applications

This directory contains the current production desktop presentation layer.

- `web/`: React/TypeScript UI, persistent task workspace, metrics trends, design tokens and mock/Tauri bridge adapters.
- `desktop/`: Tauri 2 / Rust WebView host, strict Worker protocol boundary, bounded output preview and process supervisor.

Inside Tauri, the UI binds to the real local bridge. Browser-based unit and Playwright tests retain the mock adapter. Release builds use a packaged sibling Worker and a direct model snapshot without a localhost service. This application is the sole production desktop entry; the former PyQt5 presentation layer is retired.
