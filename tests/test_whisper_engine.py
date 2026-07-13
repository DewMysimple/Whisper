"""Contracts for the faster-whisper inference adapter."""

from pathlib import Path
from types import SimpleNamespace

import pytest

from whisper_subtitle.domain.transcription import TranscriptionEngine
from whisper_subtitle.infrastructure.hardware import HardwareInfo
from whisper_subtitle.infrastructure.whisper_engine import (
    DEFAULT_MODEL_NAME,
    FasterWhisperEngine,
    resolve_model_location,
)


def cpu_hardware():
    return HardwareInfo(
        device="cpu",
        compute_type="int8",
        cuda_available=False,
        gpu_name=None,
        cuda_version=None,
        cpu_threads=4,
    )


def test_model_location_is_resolved_inside_project():
    location = resolve_model_location(Path("C:/WhisperSubtitle"))

    assert location.hf_home == Path("C:/WhisperSubtitle/models/huggingface")
    assert location.hub == Path("C:/WhisperSubtitle/models/huggingface/hub")


def test_load_preserves_model_constructor_contract():
    observed = {}
    underlying = SimpleNamespace(transcribe=lambda *_args, **_kwargs: ([], object()))

    def model_factory(*args, **kwargs):
        observed["args"] = args
        observed["kwargs"] = kwargs
        return underlying

    location = resolve_model_location(Path("project"))
    engine = FasterWhisperEngine.load(
        cpu_hardware(),
        location,
        model_factory=model_factory,
    )

    assert observed == {
        "args": (DEFAULT_MODEL_NAME,),
        "kwargs": {
            "device": "cpu",
            "compute_type": "int8",
            "cpu_threads": 4,
            "num_workers": 1,
        },
    }
    assert engine.model_name == DEFAULT_MODEL_NAME
    assert engine.location == location
    assert isinstance(engine, TranscriptionEngine)


def test_transcribe_delegates_path_options_and_result_unchanged():
    observed = {}
    expected = ([SimpleNamespace(text="hello")], SimpleNamespace(language="en"))

    def transcribe(path, **options):
        observed["path"] = path
        observed["options"] = options
        return expected

    location = resolve_model_location(Path("project"))
    engine = FasterWhisperEngine(
        SimpleNamespace(transcribe=transcribe),
        model_name=DEFAULT_MODEL_NAME,
        location=location,
    )

    result = engine.transcribe("media.wav", language="en", beam_size=5)

    assert result is expected
    assert observed == {
        "path": "media.wav",
        "options": {"language": "en", "beam_size": 5},
    }


def test_model_loading_error_propagates():
    def missing_model(*_args, **_kwargs):
        raise FileNotFoundError("model missing")

    with pytest.raises(FileNotFoundError, match="model missing"):
        FasterWhisperEngine.load(
            cpu_hardware(),
            resolve_model_location(Path("project")),
            model_factory=missing_model,
        )
