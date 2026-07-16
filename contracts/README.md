# Cross-language contracts

`contracts/` contains versioned machine contracts shared by Python, the Tauri host and the React/TypeScript client.

Current contract:

- [Desktop IPC v1](desktop_ipc/v1/README.md)

Rules:

- Published versions are immutable except for documentation corrections that do not change validation.
- Breaking changes require a new version directory.
- Python enums and validators must match the JSON Schema through automated tests.
- Human-readable `message` fields are optional presentation aids; consumers make decisions from method/event/error codes and `data`.
