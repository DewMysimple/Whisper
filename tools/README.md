# Engineering tools

This directory keeps repository automation separate from product source code.

- `codegen/`: deterministic Rust and TypeScript projections generated from Python domain registries.
- `maintenance/`: repository layout and hygiene checks.
- `release/`: Windows Worker freezing, portable assembly, ZIP creation, signing and optional installer tooling.

Generated state belongs in `build/`; final user-facing artifacts belong in `dist/`. Neither directory is product source.
