# Desktop applications

`apps/` contains two intentionally separate workspace packages:

- `web/`: React/TypeScript UI, persistent task workspace, metrics trends, design tokens and mock/Tauri bridge adapters.
- `desktop/`: Tauri 2 / Rust WebView host, strict Worker protocol boundary, bounded output preview and process supervisor.

This split is a runtime responsibility boundary, not duplicate application code. React never owns native process or filesystem access, and Rust never owns presentation behavior. `src-tauri/` remains nested below `desktop/` because it is Tauri's standard project layout.

## Source and generated directories

| Path                                                       | Ownership                                              |
| ---------------------------------------------------------- | ------------------------------------------------------ |
| `web/src/`, `web/e2e/`                                     | Tracked UI source and browser acceptance tests         |
| `desktop/src-tauri/src/`, `capabilities/`, `windows/`      | Tracked Rust host, permissions and Windows integration |
| `web/dist/`, `web/test-results/`, `web/playwright-report/` | Generated frontend build and test output               |
| `desktop/src-tauri/target/`, `desktop/src-tauri/gen/`      | Generated Rust/Tauri build output                      |
| `web/node_modules/`, `desktop/node_modules/`               | pnpm workspace dependency links                        |

Generated directories are ignored and may be recreated, but maintenance tasks do not delete local build caches without explicit authorization. Final user delivery never comes from `apps/`; it is assembled under the repository-level `dist/` directory.

## Development entry points

From the repository root, run `corepack pnpm web:dev` for a browser/mock preview or `corepack pnpm desktop:dev` for the real Tauri bridge and Worker; root-level `npm run dev` is an alias for the latter. Both use the loopback-only Vite server at `http://127.0.0.1:1420` with HMR. Release builds still embed static `web/dist/` assets and do not start localhost.
