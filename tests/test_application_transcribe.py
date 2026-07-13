"""Contracts for the unified transcription application service."""

from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

import pytest

from whisper_subtitle.application.transcribe import TranscriptionService
from whisper_subtitle.domain.contracts import TranscriptionRequest
from whisper_subtitle.domain.presets import get_preset_by_id


class FakeEngine:
    def __init__(self, failures=()):
        self.failures = set(failures)
        self.calls = []

    def transcribe(self, media_path, **options):
        path = Path(media_path)
        self.calls.append((path, options))
        if path.name in self.failures:
            raise ValueError(f"cannot decode {path.name}")
        segments = [
            SimpleNamespace(text=f"{path.stem} transcript.", start=0.0, end=1.0)
        ]
        info = SimpleNamespace(language="en", language_probability=0.99)
        return iter(segments), info


def make_media(directory: Path, *names: str) -> list[Path]:
    paths = []
    for name in names:
        path = directory / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"fixture")
        paths.append(path)
    return paths


def fail_if_called(*_args, **_kwargs):
    pytest.fail("injected engines must bypass runtime initialization")


def injected_service(events):
    return TranscriptionService(
        progress=events.append,
        runtime_configurer=fail_if_called,
        hardware_detector=fail_if_called,
        engine_loader=fail_if_called,
    )


def test_single_file_uses_exact_preset_params_and_writes_expected_text(
    tmp_path, capsys
):
    media = make_media(tmp_path, "lecture.wav")[0]
    engine = FakeEngine()
    events = []
    request = TranscriptionRequest(media, "en_v1")

    result = injected_service(events).run(request, engine=engine)

    expected_params = get_preset_by_id("en_v1").transcription_options()
    assert engine.calls == [(media, expected_params)]
    assert result.outcome == "success"
    assert result.exit_code == 0
    assert result.results[0].output_path == tmp_path / "Text" / "lecture.txt"
    assert result.results[0].output_path.read_text(encoding="utf-8") == (
        "Lecture transcript.\n"
    )
    assert {event.stage for event in events} >= {
        "media_discovered",
        "file_started",
        "language_detected",
        "segments_collected",
        "sentences_merged",
        "output_written",
        "batch_completed",
    }
    assert capsys.readouterr().out == ""


def test_partial_failure_is_structured_and_batch_continues_in_sorted_order(tmp_path):
    media = make_media(tmp_path, "z-last.wav", "a-first.wav", "m-middle.wav")
    engine = FakeEngine(failures={"m-middle.wav"})
    events = []

    result = injected_service(events).run(
        TranscriptionRequest(tmp_path, "en_v1"), engine=engine
    )

    assert [path.name for path, _params in engine.calls] == [
        "a-first.wav",
        "m-middle.wav",
        "z-last.wav",
    ]
    assert [item.input_path.name for item in result.results] == [
        "a-first.wav",
        "m-middle.wav",
        "z-last.wav",
    ]
    assert [item.success for item in result.results] == [True, False, True]
    assert result.results[1].error == "cannot decode m-middle.wav"
    assert result.outcome == "partial_failure"
    assert result.exit_code == 1
    assert [event.input_path.name for event in events if event.stage == "file_failed"] == [
        "m-middle.wav"
    ]
    assert all(path in media for path, _params in engine.calls)


def test_all_file_failures_have_failure_outcome_and_legacy_exit_code(tmp_path):
    make_media(tmp_path, "a.wav", "b.wav")
    engine = FakeEngine(failures={"a.wav", "b.wav"})

    result = injected_service([]).run(
        TranscriptionRequest(tmp_path, "cn"), engine=engine
    )

    assert result.outcome == "failure"
    assert result.success_count == 0
    assert result.failure_count == 2
    assert result.exit_code == 1


def test_invalid_input_fails_before_runtime_or_model_loading(tmp_path):
    events = []
    service = TranscriptionService(
        progress=events.append,
        runtime_configurer=fail_if_called,
        hardware_detector=fail_if_called,
        engine_loader=fail_if_called,
    )
    request = TranscriptionRequest(tmp_path / "missing.wav", "en_v1")

    result = service.run(request)

    assert result.outcome == "failure"
    assert result.exit_code == 1
    assert "输入路径不存在" in result.results[0].error
    assert [event.stage for event in events] == ["input_invalid"]


def test_default_engine_initialization_is_explicit_and_injected(tmp_path):
    media = make_media(tmp_path, "media.wav")[0]
    events = []
    location = SimpleNamespace(hub=Path("models/huggingface/hub"))
    hardware = SimpleNamespace(
        cuda_available=True,
        gpu_name="Test GPU",
        cuda_version="12.8",
    )
    engine = FakeEngine()
    calls = []

    def configure():
        calls.append("runtime")
        return location

    def detect():
        calls.append("hardware")
        return hardware

    def load(observed_hardware, observed_location):
        calls.append((observed_hardware, observed_location))
        return engine

    service = TranscriptionService(
        progress=events.append,
        runtime_configurer=configure,
        hardware_detector=detect,
        engine_loader=load,
    )

    result = service.run(TranscriptionRequest(media, "en_v1"))

    assert result.success
    assert calls == ["runtime", "hardware", (hardware, location)]
    assert [event.stage for event in events if event.stage.startswith("model_")] == [
        "model_loading",
        "model_loaded",
    ]
    assert any(event.stage == "hardware_detected" for event in events)


def test_explicit_output_directory_error_is_not_converted_to_file_failure(
    tmp_path, monkeypatch
):
    media = make_media(tmp_path, "media.wav")[0]
    blocked = tmp_path / "blocked"
    original_mkdir = Path.mkdir

    def guarded_mkdir(path, *args, **kwargs):
        if path == blocked:
            raise PermissionError("output directory denied")
        return original_mkdir(path, *args, **kwargs)

    monkeypatch.setattr(Path, "mkdir", guarded_mkdir)

    with pytest.raises(PermissionError, match="output directory denied"):
        injected_service([]).run(
            TranscriptionRequest(media, "en_v1", blocked),
            engine=FakeEngine(),
        )
