"""Console rendering and application adapter contracts."""

from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace

from whisper_subtitle.domain.contracts import ProgressEvent
from whisper_subtitle.presentation import console


def test_console_progress_renderer_is_the_only_event_printer(capsys):
    console.ConsoleProgressRenderer()(ProgressEvent("test", "✅ rendered"))
    assert capsys.readouterr().out == "✅ rendered\n"


def test_json_lines_renderer_emits_one_stable_machine_readable_event(capsys):
    event = ProgressEvent(
        "file_started",
        "开始处理",
        current=2,
        total=3,
        preset_id="cn2",
        input_path="media/input.wav",
    )

    console.JsonLinesProgressRenderer()(event)

    assert json.loads(capsys.readouterr().out) == {
        "type": "progress",
        "stage": "file_started",
        "message": "开始处理",
        "current": 2,
        "total": 3,
        "preset_id": "cn2",
        "input_path": str(Path("media/input.wav")),
    }


def test_progress_renderer_rejects_unknown_transport():
    import pytest

    with pytest.raises(ValueError, match="unknown progress format"):
        console.progress_renderer("xml")


def test_request_adapter_returns_application_batch_exit_code(monkeypatch):
    observed = {}
    engine = object()

    class FakeService:
        def __init__(self, *, progress):
            observed["progress"] = progress

        def run(self, request, *, engine=None):
            observed["request"] = request
            observed["engine"] = engine
            return SimpleNamespace(exit_code=7)

    monkeypatch.setattr(console, "TranscriptionService", FakeService)

    request = SimpleNamespace(preset_id="cn2")
    exit_code = console.run_transcription_request(
        request,
        engine=engine,
    )

    assert exit_code == 7
    assert observed["request"] is request
    assert observed["engine"] is engine
