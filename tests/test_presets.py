"""Structural and parameter contracts for canonical presets."""

from __future__ import annotations

from collections.abc import Mapping

import pytest

from whisper_subtitle.domain.contracts import Preset
from whisper_subtitle.domain.presets import (
    CLI_ALIASES,
    DISPLAY_KEYS,
    PRESETS,
    PRESETS_BY_ID,
    derive_preset,
    get_display_value,
    get_preset_by_id,
)


def test_four_logical_presets_are_available_through_cli_aliases():
    assert set(CLI_ALIASES) == {"cn", "cn2", "en", "en2"}
    assert set(PRESETS_BY_ID) == {"cn", "cn2", "en_v1", "en_v2"}


@pytest.mark.parametrize("preset", PRESETS, ids=lambda preset: preset.id)
def test_each_preset_has_complete_typed_business_configuration(preset):
    assert isinstance(preset, Preset)
    for value in (
        preset.id,
        preset.cli_alias,
        preset.label,
        preset.description,
        preset.group,
        preset.postprocess_strategy,
    ):
        assert isinstance(value, str) and value
    assert isinstance(preset.params, Mapping)


@pytest.mark.parametrize("preset", PRESETS, ids=lambda preset: preset.id)
def test_each_preset_parameter_types_are_stable(preset):
    params = preset.params
    assert isinstance(params["language"], str)
    assert isinstance(params["task"], str)
    assert type(params["beam_size"]) is int
    assert type(params["best_of"]) is int
    assert type(params["patience"]) is float
    assert type(params["length_penalty"]) is float
    assert type(params["temperature"]) is float
    assert type(params["compression_ratio_threshold"]) is float
    assert type(params["log_prob_threshold"]) is float
    assert type(params["no_speech_threshold"]) is float
    assert type(params["condition_on_previous_text"]) is bool
    assert type(params["word_timestamps"]) is bool
    assert type(params["vad_filter"]) is bool
    assert type(params["vad_parameters"]["min_silence_duration_ms"]) is int
    assert type(params["vad_parameters"]["max_speech_duration_s"]) is int


@pytest.mark.parametrize(
    ("standard_id", "robust_id"),
    [("cn", "cn2"), ("en_v1", "en_v2")],
)
def test_anti_hallucination_presets_have_expected_parameter_differences(
    standard_id, robust_id
):
    standard = get_preset_by_id(standard_id).params
    robust = get_preset_by_id(robust_id).params

    assert robust["compression_ratio_threshold"] < standard[
        "compression_ratio_threshold"
    ]
    assert robust["log_prob_threshold"] < standard["log_prob_threshold"]
    assert robust["no_speech_threshold"] > standard["no_speech_threshold"]
    assert standard["condition_on_previous_text"] is True
    assert robust["condition_on_previous_text"] is False
    assert (
        robust["vad_parameters"]["min_silence_duration_ms"]
        > standard["vad_parameters"]["min_silence_duration_ms"]
    )


def test_display_values_include_nested_and_derived_fields():
    preset = get_preset_by_id("cn2")
    assert "后处理" in DISPLAY_KEYS
    assert get_display_value(preset, "min_silence_duration_ms") == "500"
    assert get_display_value(preset, "后处理")
    assert get_display_value(preset, "missing") == "-"


def test_unknown_preset_raises_key_error():
    with pytest.raises(KeyError, match="未知 preset id"):
        get_preset_by_id("unknown")


def test_derived_preset_freezes_valid_overrides_without_mutating_registry():
    original = get_preset_by_id("cn2")

    derived = derive_preset(
        "cn2",
        {
            "beam_size": 8,
            "temperature": 0.25,
            "min_silence_duration_ms": 750,
        },
    )

    assert derived.id == original.id
    assert derived.params["beam_size"] == 8
    assert derived.params["temperature"] == 0.25
    assert derived.params["vad_parameters"]["min_silence_duration_ms"] == 750
    assert original.params["beam_size"] == 5
    assert original.params["temperature"] == 0.0
    assert original.params["vad_parameters"]["min_silence_duration_ms"] == 500


@pytest.mark.parametrize("model_id", ["large-v3", "large-v3-turbo"])
@pytest.mark.parametrize("preset_id", ["cn", "cn2", "en_v1", "en_v2"])
def test_v3_family_profiles_preserve_spoken_language_and_enable_real_fallback(
    model_id, preset_id
):
    preset = derive_preset(preset_id, {}, model_id=model_id)

    assert preset.params["task"] == "transcribe"
    assert preset.params["language"] is None
    assert preset.params["multilingual"] is False
    assert preset.params["language_detection_segments"] == 5
    assert preset.params["language_detection_threshold"] == 1.0
    assert list(preset.params["temperature"])[0] == 0.0
    assert len(preset.params["temperature"]) > 1
    assert preset.params["initial_prompt"] is None


def test_turbo_temperature_fallback_is_capped_below_full_v3():
    turbo = derive_preset("cn2", {}, model_id="large-v3-turbo")
    full = derive_preset("cn2", {}, model_id="large-v3")

    assert max(turbo.params["temperature"]) == 0.6
    assert max(full.params["temperature"]) == 1.0


def test_manual_temperature_override_replaces_model_fallback_for_one_task():
    preset = derive_preset(
        "en_v2",
        {"temperature": 0.3},
        model_id="large-v3",
    )

    assert preset.params["temperature"] == 0.3


def test_v3_english_profile_accepts_local_translation_and_guidance_parameters():
    preset = derive_preset(
        "en_v2",
        {
            "task": "translate",
            "initial_prompt": "  CTranslate2\r\nWebView2  ",
            "hotwords": "WhisperSubtitle\nLarge V3",
            "repetition_penalty": 1.15,
            "no_repeat_ngram_size": 3,
            "prompt_reset_on_temperature": 0.7,
        },
        model_id="large-v3",
    )

    assert preset.params["task"] == "translate"
    assert preset.params["initial_prompt"] == "CTranslate2\nWebView2"
    assert preset.params["hotwords"] == "WhisperSubtitle\nLarge V3"
    assert preset.params["repetition_penalty"] == 1.15
    assert preset.params["no_repeat_ngram_size"] == 3
    assert preset.params["prompt_reset_on_temperature"] == 0.7


def test_turbo_profile_rejects_translation_task():
    with pytest.raises(ValueError, match="not trained for translation"):
        derive_preset(
            "en_v2",
            {"task": "translate"},
            model_id="large-v3-turbo",
        )


@pytest.mark.parametrize("preset_id", ["cn", "cn2"])
def test_chinese_profiles_reject_translate_task(preset_id):
    with pytest.raises(ValueError, match="only supported by English presets"):
        derive_preset(
            preset_id,
            {"task": "translate"},
            model_id="large-v3-turbo",
        )


@pytest.mark.parametrize(
    "overrides",
    [
        {"initial_prompt": ""},
        {"hotwords": "bad\u0000term"},
        {"initial_prompt": "x" * 4001},
        {"repetition_penalty": 0.9},
        {"no_repeat_ngram_size": 11},
        {"prompt_reset_on_temperature": 1.1},
    ],
)
def test_guidance_and_repeat_overrides_reject_invalid_values(overrides):
    with pytest.raises(ValueError):
        derive_preset("en_v1", overrides, model_id="large-v3")


def test_small_models_keep_legacy_fixed_language_parameters():
    preset = derive_preset("cn2", {}, model_id="medium")

    assert preset.params["language"] == "zh"
    assert "multilingual" not in preset.params
    assert preset.params["temperature"] == 0.0


@pytest.mark.parametrize(
    "overrides",
    [
        {"unknown": 1},
        {"beam_size": 0},
        {"beam_size": True},
        {"temperature": 2},
        {"condition_on_previous_text": 1},
    ],
)
def test_derived_preset_revalidates_worker_override_boundaries(overrides):
    with pytest.raises((TypeError, ValueError)):
        derive_preset("en_v1", overrides)
