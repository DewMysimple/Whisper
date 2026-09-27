"""Validate local model artifacts without importing inference dependencies."""

from __future__ import annotations

import json
from pathlib import Path

from .domain.models import ASSETS_BY_ID


def complete_model_directory(path: Path, model_id: str) -> bool:
    definition = ASSETS_BY_ID.get(model_id)
    if definition is None or not path.is_dir():
        return False
    if not all((path / name).is_file() for name in definition.required_files):
        return False
    if definition.config_model_type is None:
        return True
    try:
        config = json.loads((path / "config.json").read_text(encoding="utf-8"))
        if config.get("model_type") != definition.config_model_type:
            return False
        if definition.config_architecture not in config.get("architectures", []):
            return False
        if (path / "model.safetensors").is_file():
            return (path / "model.safetensors").stat().st_size > 0
        index = json.loads((path / "model.safetensors.index.json").read_text(encoding="utf-8"))
        shards = set(index["weight_map"].values())
        return bool(shards) and all(
            isinstance(name, str) and Path(name).name == name
            and (path / name).is_file() and (path / name).stat().st_size > 0
            for name in shards
        )
    except (OSError, ValueError, TypeError, KeyError, AttributeError):
        return False
