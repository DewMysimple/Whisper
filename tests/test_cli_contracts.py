"""Behavioral contracts for the public command-line interface."""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from types import ModuleType

import pytest

from whisper_subtitle import cli
from whisper_subtitle.domain.presets import (
    get_postprocess_label,
    get_preset_by_id,
)


PROJECT_ROOT = Path(__file__).resolve().parents[1]
PARAMETERS_PATH = PROJECT_ROOT / "tests" / "golden" / "parameters.json"
CLI_TO_PRESET_ID = {
    "cn": "cn",
    "cn2": "cn2",
    "en": "en_v1",
    "en2": "en_v2",
}


@pytest.mark.parametrize("preset_name", ["cn", "cn2", "en", "en2"])
def test_transcribe_forwards_preset_input_output_and_exit_code(
    preset_name, monkeypatch
):
    observed = {}

    def fake_run(request, *, progress_format):
        observed["request"] = request
        observed["progress_format"] = progress_format
        return 7

    monkeypatch.setattr(
        "whisper_subtitle.presentation.console.run_transcription_request",
        fake_run,
    )

    result = cli.main(
        [
            "transcribe",
            "input folder/media.wav",
            "--preset",
            preset_name,
            "--output",
            "output folder",
            "--desktop",
            "--progress",
            "jsonl",
        ]
    )

    assert result == 7
    assert observed["request"].input_path == Path("input folder/media.wav")
    assert observed["request"].preset_id == CLI_TO_PRESET_ID[preset_name]
    assert observed["request"].output_dir == Path("output folder")
    assert observed["request"].desktop is True
    assert observed["progress_format"] == "jsonl"


def test_transcribe_omits_default_output_argument(monkeypatch):
    observed = {}

    def fake_run(request, *, progress_format):
        observed["request"] = request
        observed["progress_format"] = progress_format
        return 0

    monkeypatch.setattr(
        "whisper_subtitle.presentation.console.run_transcription_request",
        fake_run,
    )

    assert cli.main(["transcribe", "media.wav"]) == 0
    assert observed["request"].output_dir is None
    assert observed["request"].desktop is False
    assert observed["progress_format"] == "text"


def test_transcribe_propagates_application_failure(monkeypatch):
    def fake_run(_request, *, progress_format):
        raise RuntimeError("application failure")

    monkeypatch.setattr(
        "whisper_subtitle.presentation.console.run_transcription_request",
        fake_run,
    )

    with pytest.raises(RuntimeError, match="application failure"):
        cli.main(["transcribe", "media.wav", "--preset", "cn"])


def test_explicit_model_dir_is_scoped_to_one_cli_invocation(monkeypatch, tmp_path):
    observed = {}
    monkeypatch.setenv("WHISPER_SUBTITLE_MODEL_DIR", "previous-model-home")

    def fake_run(_request, *, progress_format):
        observed["model_dir"] = os.environ["WHISPER_SUBTITLE_MODEL_DIR"]
        return 0

    monkeypatch.setattr(
        "whisper_subtitle.presentation.console.run_transcription_request",
        fake_run,
    )

    assert cli.main(
        ["transcribe", "media.wav", "--model-dir", str(tmp_path)]
    ) == 0
    assert observed["model_dir"] == str(tmp_path)
    assert os.environ["WHISPER_SUBTITLE_MODEL_DIR"] == "previous-model-home"


@pytest.mark.parametrize("preset_name", ["cn", "cn2", "en", "en2"])
def test_cli_alias_resolves_to_recorded_preset_parameters(preset_name):
    snapshots = json.loads(PARAMETERS_PATH.read_text(encoding="utf-8"))
    snapshot = snapshots[preset_name]
    preset = get_preset_by_id(CLI_TO_PRESET_ID[preset_name])

    assert snapshot["preset_id"] == preset.id
    assert snapshot["params"] == preset.transcription_options()
    assert snapshot["postprocess"] == get_postprocess_label(preset)


def test_check_subcommand_converts_system_exit_to_return_code(monkeypatch):
    fake_module = ModuleType("whisper_subtitle.infrastructure.environment_check")

    def fake_check():
        raise SystemExit(3)

    fake_module.main = fake_check
    monkeypatch.setitem(
        sys.modules,
        "whisper_subtitle.infrastructure.environment_check",
        fake_module,
    )

    assert cli.main(["check"]) == 3


def test_retired_gui_subcommand_is_an_argparse_usage_error():
    with pytest.raises(SystemExit) as exc_info:
        cli.main(["gui"])

    assert exc_info.value.code == 2


def test_invalid_preset_is_an_argparse_usage_error():
    with pytest.raises(SystemExit) as exc_info:
        cli.main(["transcribe", "media.wav", "--preset", "invalid"])

    assert exc_info.value.code == 2


def test_no_subcommand_prints_help_and_succeeds(capsys):
    assert cli.main([]) == 0
    assert "transcribe" in capsys.readouterr().out


def test_worker_subcommand_forwards_idle_timeout(monkeypatch):
    observed = {}

    def fake_worker_main(*, idle_timeout_seconds):
        observed["idle_timeout_seconds"] = idle_timeout_seconds
        return 9

    monkeypatch.setattr("whisper_subtitle.worker.stdio.main", fake_worker_main)

    assert cli.main(["worker", "--model-idle-timeout", "12.5"]) == 9
    assert observed == {"idle_timeout_seconds": 12.5}
