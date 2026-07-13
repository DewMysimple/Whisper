"""Runtime bootstrap and Core import side-effect contracts."""

from __future__ import annotations

import os
import subprocess
import sys
import warnings
from pathlib import Path

from whisper_subtitle.bootstrap import configure_runtime


PROJECT_ROOT = Path(__file__).resolve().parents[1]


def test_configure_runtime_explicitly_sets_project_model_cache(monkeypatch, tmp_path):
    monkeypatch.delenv("HF_HOME", raising=False)

    location = configure_runtime(tmp_path, suppress_warnings=False)

    assert location.hf_home == tmp_path / "models" / "huggingface"
    assert location.hub == location.hf_home / "hub"
    assert os.environ["HF_HOME"] == str(location.hf_home)


def test_warning_suppression_happens_only_when_explicitly_requested(tmp_path):
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("default")
        configure_runtime(tmp_path, suppress_warnings=True)
        warnings.warn("suppressed by explicit bootstrap", UserWarning)

    assert caught == []


def test_importing_canonical_contract_modules_has_no_runtime_side_effects():
    code = r'''
import importlib
import os
import sys
import warnings

os.environ.pop("HF_HOME", None)
before_filters = list(warnings.filters)
modules = [
    "whisper_subtitle.domain.presets",
    "whisper_subtitle.application.transcribe",
    "whisper_subtitle.presentation.console",
    "whisper_subtitle.infrastructure.environment_check",
]
for module in modules:
    importlib.import_module(module)
assert "HF_HOME" not in os.environ
assert warnings.filters == before_filters
assert "torch" not in sys.modules
assert "faster_whisper" not in sys.modules
'''
    env = os.environ.copy()
    env["PYTHONPATH"] = str(PROJECT_ROOT / "src")

    completed = subprocess.run(
        [sys.executable, "-c", code],
        cwd=PROJECT_ROOT,
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )

    assert completed.returncode == 0, completed.stderr
