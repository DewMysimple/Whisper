"""Generate a deterministic file inventory for one assembled release tree."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src"))

def selected_model_assets(model_ids: object) -> tuple[str, ...]:
    """Resolve explicit ASR selections and their companions from the catalog."""
    from whisper_subtitle.domain.models import ASSETS_BY_ID, MODELS_BY_ID

    if not isinstance(model_ids, list) or not model_ids:
        raise ValueError("modelIds must be a nonempty list of registered ASR models")
    if any(not isinstance(model, str) or model not in MODELS_BY_ID for model in model_ids):
        raise ValueError("modelIds contains an unregistered ASR model")
    if len(set(model_ids)) != len(model_ids):
        raise ValueError("modelIds contains duplicate ASR models")
    assets = dict.fromkeys(model_ids)
    for model_id in model_ids:
        companion = ASSETS_BY_ID[model_id].companion_id
        if companion:
            assets[companion] = None
    return tuple(assets)


def verify_selected_models(root: Path, model_ids: object) -> None:
    from whisper_subtitle.paths import AppPaths

    assets = selected_model_assets(model_ids)
    model_root = root / "_internal" / "models"
    actual = {path.name for path in model_root.iterdir()}
    if actual != set(assets):
        raise ValueError(f"Selected release model inventory mismatch: {actual ^ set(assets)}")
    location = AppPaths.discover(explicit_model_dir=model_root, environ={}).model_location
    for model_id in model_ids:
        location.require_bundle(model_id)


def assert_unlinked(path: Path) -> None:
    """Reject links before opening or walking release files (also on Python 3.10)."""
    for candidate in (path, *path.parents):
        if candidate.is_symlink() or (
            candidate.exists() and getattr(candidate.lstat(), "st_file_attributes", 0) & 0x400
        ):
            raise ValueError(f"Linked release path: {candidate}")


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
    assert_unlinked(root)
    assert_unlinked(manifest)
    actual = set()
    for parent, dirs, files in os.walk(root, followlinks=False):
        for name in dirs + files:
            assert_unlinked(Path(parent) / name)
        actual.update((Path(parent) / name).relative_to(root).as_posix() for name in files)
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
    required = {"WhisperSubtitle.exe", "_internal/worker/whisper-subtitle-worker.exe"}
    if "modelIds" in payload:
        verify_selected_models(root, payload["modelIds"])
    else:
        required.add("_internal/models/large-v3-turbo/model.bin")
    if not required.issubset(expected):
        raise ValueError("Portable release is missing required runtime files")
    if actual != expected:
        raise ValueError(f"Release inventory mismatch: {actual ^ expected}")
    return len(actual)


def generate_manifest(root: Path, output: Path, version: str, model_ids: list[str] | None = None) -> None:
    root = root.absolute()
    output = output.absolute()
    assert_unlinked(root)
    assert_unlinked(output)
    if model_ids is not None:
        verify_selected_models(root, model_ids)
    files = []
    for path in sorted(root.rglob("*")):
        assert_unlinked(path)
        if not path.is_file() or path == output:
            continue
        files.append({"path": path.relative_to(root).as_posix(),
                      "size": path.stat().st_size, "sha256": sha256(path)})
    payload = {"schemaVersion": 1, "product": "WhisperSubtitle", "version": version, "files": files}
    if model_ids is not None:
        payload["modelIds"] = model_ids
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("root", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--version")
    parser.add_argument("--verify", action="store_true")
    parser.add_argument("--model-id", action="append", dest="model_ids")
    args = parser.parse_args()

    if args.verify:
        if args.model_ids is not None:
            parser.error("--verify reads modelIds from the manifest")
        print(f"Verified {verify_manifest(args.root, args.output)} portable release files")
        return 0
    if not args.version:
        parser.error("--version is required when generating a manifest")

    generate_manifest(args.root, args.output, args.version, args.model_ids)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
