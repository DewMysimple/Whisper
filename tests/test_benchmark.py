"""Unit tests for benchmark aggregation without loading a Whisper model."""

from __future__ import annotations

import pytest

from tests.benchmark.run_benchmark import (
    BASELINE_PATH,
    build_preset_result,
    parse_args,
    restore_file,
    snapshot_file,
    summarize_phase,
    summarize_values,
)


def test_summarize_values_records_samples_median_and_range():
    assert summarize_values([1.0, 3.0, 2.0], 4) == {
        "samples": [1.0, 3.0, 2.0],
        "median": 2.0,
        "min": 1.0,
        "max": 3.0,
        "range": 2.0,
    }


def test_summarize_phase_rejects_empty_runs():
    with pytest.raises(ValueError, match="empty benchmark phase"):
        summarize_phase([])


def test_parse_args_requires_at_least_three_runs_per_phase():
    with pytest.raises(SystemExit) as exc_info:
        parse_args(["--runs-per-phase", "2"])

    assert exc_info.value.code == 2


def test_parse_args_keeps_canonical_default_and_accepts_candidate_output():
    assert parse_args([]).output == BASELINE_PATH
    assert str(parse_args(["--output", "candidate.json"]).output) == "candidate.json"
    assert parse_args([]).cli.name == "whisper-subtitle.exe"
    assert str(parse_args(["--cli", "candidate.exe"]).cli) == "candidate.exe"


def test_snapshot_and_restore_file_preserve_existing_or_remove_generated(tmp_path):
    existing = tmp_path / "existing.txt"
    existing.write_bytes(b"original\r\nbytes")
    snapshot = snapshot_file(existing)
    existing.write_bytes(b"changed")
    restore_file(existing, snapshot)
    assert existing.read_bytes() == b"original\r\nbytes"

    generated = tmp_path / "generated.txt"
    snapshot = snapshot_file(generated)
    generated.write_bytes(b"temporary")
    restore_file(generated, snapshot)
    assert not generated.exists()


def test_build_preset_result_separates_cold_and_warm_measurements():
    def raw_run(phase, value):
        metrics = {
            "startup_to_model_load_start_seconds": value,
            "startup_to_model_ready_seconds": value + 1,
            "model_load_seconds": value,
            "transcription_to_output_seconds": value,
            "total_process_seconds": value + 2,
            "peak_process_memory_mib": value * 100,
            "peak_gpu_memory_mib": value * 100,
            "peak_gpu_device_used_mib": value * 100,
            "gpu_baseline_used_mib": value * 10,
            "gpu_measurement_method": "fake NVML",
        }
        return {
            "preset_id": "en_v1",
            "entrypoint": "whisper-subtitle transcribe --preset en",
            "model": "Whisper Large-V3-Turbo",
            "params": {"language": "en"},
            "postprocess": "无",
            "output": {"path": "golden.txt", "bytes": 1, "sha256": "ABC"},
            "benchmark_phase": phase,
            "metrics": metrics,
        }

    result = build_preset_result(
        [
            *(raw_run("cold_process", value) for value in (1.0, 2.0, 3.0)),
            *(raw_run("warm_system_cache", value) for value in (4.0, 5.0, 6.0)),
        ]
    )

    assert result["measurements"]["cold_process"]["run_count"] == 3
    assert result["measurements"]["warm_system_cache"]["run_count"] == 3
    assert (
        result["measurements"]["warm_system_cache"]["metrics"]
        ["total_process_seconds"]["median"]
        == 7.0
    )
