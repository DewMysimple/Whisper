"""Integration checks for generated golden outputs and benchmark metadata."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pytest


PROJECT_ROOT = Path(__file__).resolve().parents[1]
BASELINE_PATH = PROJECT_ROOT / "tests" / "benchmark" / "baseline.json"
PARAMETERS_PATH = PROJECT_ROOT / "tests" / "golden" / "parameters.json"
PRESET_NAMES = ("en", "en2", "cn", "cn2")


def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


@pytest.mark.parametrize("preset_name", PRESET_NAMES)
def test_golden_output_exists_is_nonempty_and_matches_recorded_hash(preset_name):
    baseline = load_json(BASELINE_PATH)
    output = PROJECT_ROOT / baseline["presets"][preset_name]["output"]["path"]
    assert output.is_file()
    assert output.stat().st_size > 0
    digest = hashlib.sha256(output.read_bytes()).hexdigest().upper()
    assert digest == baseline["presets"][preset_name]["output"]["sha256"]


@pytest.mark.parametrize("preset_name", PRESET_NAMES)
def test_benchmark_has_complete_positive_metrics(preset_name):
    metrics = load_json(BASELINE_PATH)["presets"][preset_name]["metrics"]
    required_positive = {
        "startup_to_model_load_start_seconds",
        "startup_to_model_ready_seconds",
        "model_load_seconds",
        "transcription_to_output_seconds",
        "total_process_seconds",
        "peak_process_memory_mib",
        "peak_gpu_memory_mib",
        "peak_gpu_device_used_mib",
    }
    assert required_positive <= set(metrics)
    assert all(metrics[key] > 0 for key in required_positive)
    assert metrics["startup_to_model_ready_seconds"] >= metrics["model_load_seconds"]
    assert metrics["total_process_seconds"] >= metrics["startup_to_model_ready_seconds"]


@pytest.mark.parametrize("preset_name", PRESET_NAMES)
def test_parameter_snapshot_matches_benchmark(preset_name):
    baseline = load_json(BASELINE_PATH)["presets"][preset_name]
    snapshot = load_json(PARAMETERS_PATH)[preset_name]
    assert snapshot["preset_id"] == baseline["preset_id"]
    assert snapshot["script"] == baseline["script"]
    assert snapshot["model"] == baseline["model"]
    assert snapshot["params"] == baseline["params"]
    assert snapshot["postprocess"] == baseline["postprocess"]
