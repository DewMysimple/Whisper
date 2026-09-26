"""Public controls survive protocol freezing and reach the inference adapter."""

from pathlib import Path
from types import SimpleNamespace

import pytest

from whisper_subtitle.domain.parameters import LANGUAGE_CODES, parameter_schema
from whisper_subtitle.domain.presets import derive_preset, get_preset_by_id
from whisper_subtitle.infrastructure.whisper_engine import FasterWhisperEngine, resolve_model_location
from whisper_subtitle.protocol import CommandMessage, CommandMethod, ProtocolValidationError


PUBLIC_OVERRIDES = {
    "task": "transcribe", "language": "zh", "multilingual": True,
    "language_detection_threshold": 0.8, "language_detection_segments": 3,
    "beam_size": 4, "best_of": 3, "patience": 1.2, "length_penalty": 0.8,
    "temperature": [0, 0.2, 0.4], "repetition_penalty": 1.1,
    "no_repeat_ngram_size": 3, "compression_ratio_threshold": None,
    "log_prob_threshold": None, "no_speech_threshold": None,
    "condition_on_previous_text": False, "prompt_reset_on_temperature": 0.4,
    "initial_prompt": "术语\r\nWhisper", "hotwords": "本地 识别", "prefix": None,
    "suppress_blank": False, "suppress_tokens": [-1, 25],
    "max_new_tokens": 256, "chunk_length": 20, "word_timestamps": True,
    "max_initial_timestamp": 0.8, "prepend_punctuations": "([{",
    "append_punctuations": ".,。", "hallucination_silence_threshold": 2,
    "vad_filter": True, "vad_threshold": 0.6, "vad_neg_threshold": 0.3,
    "min_speech_duration_ms": 100, "max_speech_duration_s": 60,
    "min_silence_duration_ms": 400, "speech_pad_ms": 200,
}


def command(overrides):
    return CommandMessage("public-controls", CommandMethod.TRANSCRIPTION_START, {
        "inputs": [{"path": "fixture.wav", "kind": "file", "origin": "dialog"}],
        "model_id": "large-v3-turbo",
        "profile": {"base_preset_id": "cn2", "overrides": overrides},
        "output": {"mode": "compatibility", "txt": {"enabled": True},
                   "markdown": {"enabled": False}, "preserve_source_txt": False,
                   "conflict_policy": "overwrite"},
    })


def test_every_public_control_reaches_engine_and_preserves_canonical_preset():
    original = get_preset_by_id("cn2").transcription_options()
    frozen = command(PUBLIC_OVERRIDES).params["profile"]["overrides"]
    derived = derive_preset("cn2", frozen, model_id="large-v3-turbo")
    observed = {}
    def transcribe(path, **kwargs):
        observed.update(kwargs)
        return [], SimpleNamespace(language="zh")
    engine = FasterWhisperEngine(SimpleNamespace(transcribe=transcribe),
        model_name="large-v3-turbo", location=resolve_model_location(Path("test")))
    engine.transcribe("fixture.wav", **derived.transcription_options())
    assert set(PUBLIC_OVERRIDES) == set(parameter_schema()["properties"])
    assert observed["vad_parameters"] == {
        "threshold": 0.6, "neg_threshold": 0.3, "min_speech_duration_ms": 100,
        "max_speech_duration_s": 60, "min_silence_duration_ms": 400, "speech_pad_ms": 200,
    }
    assert observed["temperature"] == [0, 0.2, 0.4]
    assert observed["initial_prompt"] == "术语\nWhisper"
    for name in set(PUBLIC_OVERRIDES) - {"initial_prompt", "vad_threshold", "vad_neg_threshold",
            "min_speech_duration_ms", "max_speech_duration_s", "min_silence_duration_ms", "speech_pad_ms"}:
        assert observed[name] == PUBLIC_OVERRIDES[name], name
    assert get_preset_by_id("cn2").transcription_options() == original


@pytest.mark.parametrize("overrides", [
    {"language": "invalid"}, {"temperature": []}, {"temperature": [0.6, 0.2]},
    {"temperature": [0, float("nan")]}, {"suppress_tokens": [51865]},
    {"suppress_tokens": [True]}, {"max_new_tokens": 441}, {"chunk_length": 31},
    {"vad_filter": 1}, {"vad_threshold": -0.1}, {"speech_pad_ms": 1.5},
    {"prefix": "bad\x00"}, {"language_detection_segments": 0},
])
def test_protocol_and_domain_reject_invalid_public_options(overrides):
    with pytest.raises(ProtocolValidationError):
        command(overrides)
    with pytest.raises(ValueError):
        derive_preset("cn2", overrides, model_id="large-v3-turbo")


def test_public_catalog_matches_installed_engine_signature():
    # The optional runtime contract catches drift when faster-whisper is upgraded.
    from inspect import signature
    from faster_whisper import WhisperModel
    from faster_whisper.tokenizer import _LANGUAGE_CODES
    from faster_whisper.vad import VadOptions
    options = derive_preset("cn2", PUBLIC_OVERRIDES, model_id="large-v3-turbo").transcription_options()
    signature(WhisperModel.transcribe).bind(None, "fixture.wav", **options)
    VadOptions(**options["vad_parameters"])
    assert set(LANGUAGE_CODES) == set(_LANGUAGE_CODES)


@pytest.mark.parametrize("preset_id", ["cn", "cn2", "en_v1", "en_v2"])
def test_inherited_window_resets_previous_task_on_reused_extractor(preset_id):
    import numpy as np
    from faster_whisper.feature_extractor import FeatureExtractor

    extractor = FeatureExtractor()
    observed = []

    def transcribe(path, **options):
        extractor(np.zeros(16000, dtype=np.float32), chunk_length=options.get("chunk_length"))
        observed.append(extractor.n_samples // extractor.sampling_rate)
        return [], SimpleNamespace(language="zh")

    engine = FasterWhisperEngine(
        SimpleNamespace(transcribe=transcribe),
        model_name="large-v3-turbo",
        location=resolve_model_location(Path("test")),
    )
    for overrides in ({"chunk_length": 20}, {}):
        preset = derive_preset(preset_id, overrides, model_id="large-v3-turbo")
        engine.transcribe("fixture.wav", **preset.transcription_options())

    assert observed == [20, 30]
