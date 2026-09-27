"""Generate a deterministic file inventory for one assembled release tree."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def verify_manifest(root: Path, manifest: Path) -> int:
    """Verify the complete portable tree before replacing or pruning releases."""
    root = root.absolute()
    manifest = manifest.absolute()
    for ancestor in (root, *root.parents):
        if ancestor.is_symlink() or getattr(os.path, "isjunction", lambda _: False)(ancestor):
            raise ValueError(f"Linked release path: {ancestor}")
    payload = json.loads(manifest.read_text(encoding="utf-8"))
    if payload.get("product") != "WhisperSubtitle" or payload.get("schemaVersion") != 1:
        raise ValueError("Unrecognized release manifest")
    expected = {manifest.relative_to(root).as_posix()}
    for row in payload["files"]:
        name = row["path"]
        path = root / name
        if path.is_absolute() and not path.resolve().is_relative_to(root.resolve()):
            raise ValueError(f"Manifest path escapes release: {name}")
        if name in expected or ".." in Path(name).parts:
            raise ValueError(f"Invalid or duplicate manifest path: {name}")
        expected.add(name)
        if path.stat().st_size != row["size"] or sha256(path) != row["sha256"]:
            raise ValueError(f"Release file mismatch: {name}")
    required = {"WhisperSubtitle.exe", "_internal/worker/whisper-subtitle-worker.exe",
                "_internal/models/large-v3-turbo/model.bin"}
    if not required.issubset(expected):
        raise ValueError("Portable release is missing required runtime files")
    actual = set()
    for parent, dirs, files in os.walk(root, followlinks=False):
        for name in dirs + files:
            path = Path(parent) / name
            if path.is_symlink() or getattr(os.path, "isjunction", lambda _: False)(path):
                raise ValueError(f"Linked release file: {path}")
        actual.update((Path(parent) / name).relative_to(root).as_posix() for name in files)
    if actual != expected:
        raise ValueError(f"Release inventory mismatch: {actual ^ expected}")
    return len(actual)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("root", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--version")
    parser.add_argument("--verify", action="store_true")
    args = parser.parse_args()

    if args.verify:
        print(f"Verified {verify_manifest(args.root, args.output)} portable release files")
        return 0
    if not args.version:
        parser.error("--version is required when generating a manifest")

    root = args.root.resolve()
    output = args.output.resolve()
    files = []
    for path in sorted(root.rglob("*")):
        if not path.is_file() or path.resolve() == output:
            continue
        files.append(
            {
                "path": path.relative_to(root).as_posix(),
                "size": path.stat().st_size,
                "sha256": sha256(path),
            }
        )
    payload = {
        "schemaVersion": 1,
        "product": "WhisperSubtitle",
        "version": args.version,
        "files": files,
    }
    output.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
