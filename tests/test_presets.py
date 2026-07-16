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
