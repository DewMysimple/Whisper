"""Integration checks for generated golden outputs and benchmark metadata."""

from __future__ import annotations

import hashlib
import json
import wave
from pathlib import Path

import pytest


PROJECT_ROOT = Path(__file__).resolve().parents[1]
BASELINE_PATH = PROJECT_ROOT / "tests" / "benchmark" / "baseline.json"
PARAMETERS_PATH = PROJECT_ROOT / "tests" / "golden" / "parameters.json"
CHINESE_REGRESSION_PATH = (
    PROJECT_ROOT / "tests" / "golden" / "chinese_regression.json"
)
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
@pytest.mark.parametrize("phase", ["cold_process", "warm_system_cache"])
def test_benchmark_has_complete_repeated_positive_metrics(preset_name, phase):
    baseline = load_json(BASELINE_PATH)
    measurement = baseline["presets"][preset_name]["measurements"][phase]
    metrics = measurement["metrics"]
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
    assert measurement["run_count"] >= 3
    for key in required_positive:
        summary = metrics[key]
        assert len(summary["samples"]) == measurement["run_count"]
        assert all(value > 0 for value in summary["samples"])
        assert summary["min"] <= summary["median"] <= summary["max"]
        assert summary["range"] == pytest.approx(summary["max"] - summary["min"])
    assert (
        metrics["startup_to_model_ready_seconds"]["median"]
        >= metrics["model_load_seconds"]["median"]
    )
    assert (
        metrics["total_process_seconds"]["median"]
        >= metrics["startup_to_model_ready_seconds"]["median"]
    )


def test_benchmark_schema_declares_cold_and_warm_semantics():
    baseline = load_json(BASELINE_PATH)
    environment = baseline["environment"]

    assert baseline["schema_version"] == 2
    assert environment["runs_per_phase"] >= 3
    assert environment["measurement_runs_per_preset"] == (
        environment["runs_per_phase"] * 2
    )
    assert set(environment["phase_definitions"]) == {
        "cold_process",
        "warm_system_cache",
    }


@pytest.mark.parametrize("preset_name", PRESET_NAMES)
def test_parameter_snapshot_matches_benchmark(preset_name):
    baseline = load_json(BASELINE_PATH)["presets"][preset_name]
    snapshot = load_json(PARAMETERS_PATH)[preset_name]
    assert snapshot["preset_id"] == baseline["preset_id"]
    assert snapshot["script"] == baseline["script"]
    assert snapshot["model"] == baseline["model"]
    assert snapshot["params"] == baseline["params"]
    assert snapshot["postprocess"] == baseline["postprocess"]


def test_english_regression_input_exists_and_matches_recorded_hash():
    baseline = load_json(BASELINE_PATH)
    input_path = PROJECT_ROOT / baseline["input"]["path"]

    assert input_path.is_file()
    assert input_path.stat().st_size == baseline["input"]["bytes"]
    assert (
        hashlib.sha256(input_path.read_bytes()).hexdigest().upper()
        == baseline["input"]["sha256"]
    )


def test_chinese_regression_input_is_valid_pcm_and_matches_metadata():
    regression = load_json(CHINESE_REGRESSION_PATH)
    metadata = regression["input"]
    input_path = PROJECT_ROOT / metadata["path"]

    assert input_path.is_file()
    assert input_path.stat().st_size == metadata["bytes"]
    assert (
        hashlib.sha256(input_path.read_bytes()).hexdigest().upper()
        == metadata["sha256"]
    )
    with wave.open(str(input_path), "rb") as audio:
        assert audio.getnchannels() == metadata["channels"]
        assert audio.getframerate() == metadata["sample_rate_hz"]
        assert audio.getsampwidth() == metadata["sample_width_bytes"]
        assert audio.getnframes() == metadata["frames"]


@pytest.mark.parametrize("preset_name", ["cn", "cn2"])
def test_real_chinese_golden_is_nonempty_exact_utf8_and_matches_hash(preset_name):
    regression = load_json(CHINESE_REGRESSION_PATH)
    output_metadata = regression["presets"][preset_name]
    output_path = PROJECT_ROOT / output_metadata["output_path"]

    assert output_path.is_file()
    assert output_path.read_text(encoding="utf-8") == regression["expected_text"]
    assert (
        hashlib.sha256(output_path.read_bytes()).hexdigest().upper()
        == output_metadata["sha256"]
    )
