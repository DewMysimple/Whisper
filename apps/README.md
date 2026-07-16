# Desktop presentation applications

This directory contains the next-generation presentation layer introduced in architecture batch 3, connected to the real Python Worker in batch 4, completed with product experience and diagnostics in batch 5, and packaged for Windows in batch 6.

- `web/`: React/TypeScript UI, persistent task workspace, metrics trends, design tokens and mock/Tauri bridge adapters.
- `desktop/`: Tauri 2 / Rust WebView host, strict Worker protocol boundary, bounded output preview and process supervisor.

Inside Tauri, the UI binds to the real local bridge. Browser-based unit and Playwright tests retain the mock adapter. Release builds use a packaged sibling Worker and a direct model snapshot without a localhost service. Batch 7 made this application the production desktop entry and retired the PyQt5 presentation layer.
