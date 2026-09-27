"""Stage complete offline bundles from the canonical application catalog."""

from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src"))

from whisper_subtitle.domain.models import ASSETS_BY_ID, DEFAULT_MODEL_ID, MODEL_DEFINITIONS
from whisper_subtitle.paths import AppPaths


def stage_models(source: Path, destination: Path | None, *, include_qwen: bool) -> list[str]:
    location = AppPaths.discover(explicit_model_dir=source).model_location
    selected = [DEFAULT_MODEL_ID]
    if include_qwen:
        available = [m.id for m in MODEL_DEFINITIONS if m.backend == "qwen3-asr" and location.find_model(m.id)]
        selected.extend(available)
    assets: dict[str, Path] = {}
    for model_id in selected:
        assets[model_id] = location.require_bundle(model_id)
        companion = ASSETS_BY_ID[model_id].companion_id
        if companion:
            assets[companion] = location.require_model(companion)
    if destination is not None:
        destination.mkdir(parents=True, exist_ok=True)
        for model_id, path in assets.items():
            shutil.copytree(path, destination / model_id, ignore=shutil.ignore_patterns(".cache", ".git"))
    return list(assets)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--destination", type=Path)
    parser.add_argument("--include-qwen", action="store_true")
    args = parser.parse_args()
    print("Models: " + ", ".join(stage_models(args.source, args.destination, include_qwen=args.include_qwen)))
