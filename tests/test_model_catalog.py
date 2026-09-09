"""Cross-language guards for the canonical local model catalog."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

from whisper_subtitle.domain.models import (
    DEFAULT_MODEL_ID,
    MODEL_DEFINITIONS,
    SUPPORTED_MODEL_IDS,
)


PROJECT_ROOT = Path(__file__).resolve().parents[1]


def test_model_catalog_has_unique_supported_default():
    assert tuple(model.id for model in MODEL_DEFINITIONS) == SUPPORTED_MODEL_IDS
    assert len(SUPPORTED_MODEL_IDS) == len(set(SUPPORTED_MODEL_IDS))
    assert DEFAULT_MODEL_ID in SUPPORTED_MODEL_IDS
    assert all(model.repositories for model in MODEL_DEFINITIONS)


def test_generated_model_catalogs_and_desktop_schema_are_current():
    result = subprocess.run(
        [sys.executable, "scripts/generate_model_catalog.py", "--check"],
        cwd=PROJECT_ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stdout + result.stderr
