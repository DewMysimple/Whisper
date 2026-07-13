"""Structural contract tests for GUI presets and their public CLI aliases."""

from __future__ import annotations

from pathlib import Path

import pytest

from whisper_subtitle.cli import PRESET_MODULES
from whisper_subtitle.core.presets import PRESETS, get_display_value, get_preset


CLI_TO_PRESET_ID = {
    "cn": "cn",
    "cn2": "cn2",
    "en": "en_v1",
    "en2": "en_v2",
}
PRESETS_BY_ID = {preset["id"]: preset for preset in PRESETS}


def test_four_logical_presets_are_available_through_cli_aliases():
    assert set(PRESET_MODULES) == {"cn", "cn2", "en", "en2"}
    assert set(CLI_TO_PRESET_ID.values()) == set(PRESETS_BY_ID)


@pytest.mark.parametrize("cli_name", ["cn", "cn2", "en", "en2"])
def test_each_cli_alias_points_to_an_existing_core_module(cli_name):
    module_name = PRESET_MODULES[cli_name]
    module_path = Path("src", *module_name.split(".")).with_suffix(".py")
    assert module_path.is_file()


@pytest.mark.parametrize("preset", PRESETS, ids=lambda preset: preset["id"])
def test_each_preset_has_all_required_fields(preset):
    assert set(preset) == {
        "id",
        "label",
        "desc",
        "group",
        "script",
        "params",
        "postprocess",
    }
    assert all(isinstance(preset[key], str) and preset[key] for key in (
        "id", "label", "desc", "group", "script", "postprocess"
    ))
    assert isinstance(preset["params"], dict)


@pytest.mark.parametrize("preset", PRESETS, ids=lambda preset: preset["id"])
def test_each_preset_parameter_types_are_stable(preset):
    params = preset["params"]
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
    standard = get_preset(standard_id)["params"]
    robust = get_preset(robust_id)["params"]

    assert robust["compression_ratio_threshold"] < standard["compression_ratio_threshold"]
    assert robust["log_prob_threshold"] < standard["log_prob_threshold"]
    assert robust["no_speech_threshold"] > standard["no_speech_threshold"]
    assert standard["condition_on_previous_text"] is True
    assert robust["condition_on_previous_text"] is False
    assert (
        robust["vad_parameters"]["min_silence_duration_ms"]
        > standard["vad_parameters"]["min_silence_duration_ms"]
    )


def test_display_values_include_nested_and_derived_fields():
    preset = get_preset("cn2")
    assert get_display_value(preset, "min_silence_duration_ms") == "500"
    assert get_display_value(preset, "后处理") == preset["postprocess"]
    assert get_display_value(preset, "missing") == "-"


def test_unknown_preset_raises_key_error():
    with pytest.raises(KeyError, match="未知 preset id"):
        get_preset("unknown")
