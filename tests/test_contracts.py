"""Unit tests for stable typed data exchanged between future modules."""

from __future__ import annotations

from pathlib import Path

import pytest

from whisper_subtitle.domain.contracts import (
    BatchResult,
    Preset,
    ProgressEvent,
    TranscriptionRequest,
    TranscriptionResult,
)


def make_preset(params=None):
    return Preset(
        id="test",
        cli_alias="test",
        label="Test",
        description="Test preset",
        group="Tests",
        params=params or {"language": "en", "vad_parameters": {"minimum": 1}},
        postprocess_strategy="none",
    )


def test_preset_freezes_nested_parameters_and_returns_independent_options():
    source = {"language": "en", "vad_parameters": {"minimum": 1}}
    preset = make_preset(source)
    source["language"] = "zh"
    source["vad_parameters"]["minimum"] = 2

    assert preset.params["language"] == "en"
    assert preset.params["vad_parameters"]["minimum"] == 1
    options = preset.transcription_options()
    options["vad_parameters"]["minimum"] = 99
    assert preset.params["vad_parameters"]["minimum"] == 1
    with pytest.raises(TypeError):
        preset.params["language"] = "zh"


@pytest.mark.parametrize(
    "field_name",
    ["id", "cli_alias", "label", "description", "group"],
)
def test_preset_rejects_empty_identity_and_display_fields(field_name):
    values = {
        "id": "test",
        "cli_alias": "test",
        "label": "Test",
        "description": "Test preset",
        "group": "Tests",
        "params": {"language": "en"},
        "postprocess_strategy": "none",
    }
    values[field_name] = ""

    with pytest.raises(ValueError, match=field_name):
        Preset(**values)


def test_transcription_request_normalizes_paths_and_checks_desktop_type():
    request = TranscriptionRequest("input.wav", "en_v1", "output", desktop=True)

    assert request.input_path == Path("input.wav")
    assert request.output_dir == Path("output")
    with pytest.raises(TypeError, match="desktop"):
        TranscriptionRequest("input.wav", "en_v1", desktop=1)


def test_transcription_result_exposes_request_identity_and_validates_error_state():
    request = TranscriptionRequest("input.wav", "en_v1")
    success = TranscriptionResult(request, True, "output.txt")
    failure = TranscriptionResult(request, False, error="decode failed")

    assert success.input_path == Path("input.wav")
    assert success.preset_id == "en_v1"
    assert success.output_path == Path("output.txt")
    assert failure.error == "decode failed"
    with pytest.raises(ValueError, match="successful result"):
        TranscriptionResult(request, True, error="unexpected")
    with pytest.raises(ValueError, match="failed result"):
        TranscriptionResult(request, False)


def test_progress_event_normalizes_path_and_validates_counts():
    event = ProgressEvent(
        "transcribing", "processing", current=1, total=2, input_path="input.wav"
    )

    assert event.input_path == Path("input.wav")
    with pytest.raises(ValueError, match="cannot exceed"):
        ProgressEvent("transcribing", "processing", current=3, total=2)
    with pytest.raises(ValueError, match="non-negative"):
        ProgressEvent("transcribing", "processing", current=-1)


def test_batch_result_counts_outcomes_and_produces_exit_code():
    request = TranscriptionRequest("input.wav", "en_v1")
    succeeded = TranscriptionResult(request, True, "output.txt")
    failed = TranscriptionResult(request, False, error="decode failed")

    batch = BatchResult.from_results([succeeded, failed])

    assert batch.results == (succeeded, failed)
    assert batch.success_count == 1
    assert batch.failure_count == 1
    assert batch.success is False
    assert batch.outcome == "partial_failure"
    assert batch.exit_code == 1
    assert BatchResult.from_results([succeeded]).outcome == "success"
    assert BatchResult.from_results([failed]).outcome == "failure"
    assert BatchResult().exit_code == 0
