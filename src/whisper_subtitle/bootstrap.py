"""Explicit process-wide runtime configuration for transcription entry points."""

from __future__ import annotations

import os
import warnings
from pathlib import Path

from .paths import AppPaths, ModelLocation


def configure_runtime(
    project_root: Path | None = None,
    *,
    model_dir: Path | None = None,
    app_paths: AppPaths | None = None,
    suppress_warnings: bool = True,
) -> ModelLocation:
    """Configure model cache and warning policy when transcription starts."""

    if app_paths is not None:
        paths = app_paths
    elif project_root is not None and model_dir is None:
        paths = AppPaths.discover(
            explicit_model_dir=Path(project_root) / "models" / "huggingface",
            portable_root=project_root,
            environ={},
        )
    else:
        paths = AppPaths.discover(explicit_model_dir=model_dir)
    location = paths.model_location
    os.environ["HF_HOME"] = str(location.hf_home)
    if suppress_warnings:
        warnings.filterwarnings("ignore")
    return location
