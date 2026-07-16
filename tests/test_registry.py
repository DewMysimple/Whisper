"""Validation tests for the single typed preset registry."""

from __future__ import annotations

from dataclasses import replace

import pytest

from whisper_subtitle.domain.presets import (
    CLI_ALIASES,
    DEFAULT_PRESET_ID,
    POSTPROCESS_STRATEGIES,
    PRESETS,
    PRESETS_BY_CLI_ALIAS,
    PRESETS_BY_ID,
    canonical_preset_id,
    get_display_value,
    get_preset_by_cli_alias,
    get_preset_by_id,
    resolve_preset,
    validate_registry,
)
EXPECTED_ALIAS_TO_ID = {
    "cn": "cn",
    "cn2": "cn2",
    "en": "en_v1",
    "en2": "en_v2",
}


def test_registry_has_one_typed_preset_per_public_alias_and_canonical_id():
    assert tuple(CLI_ALIASES) == ("cn", "cn2", "en", "en2")
    assert set(PRESETS_BY_ID) == {"cn", "cn2", "en_v1", "en_v2"}
    assert {
        alias: preset.id for alias, preset in PRESETS_BY_CLI_ALIAS.items()
    } == EXPECTED_ALIAS_TO_ID
    assert all(PRESETS_BY_ID[preset.id] is preset for preset in PRESETS)


@pytest.mark.parametrize(("alias", "preset_id"), EXPECTED_ALIAS_TO_ID.items())
def test_alias_id_and_qsettings_resolution_share_one_rule(alias, preset_id):
    assert get_preset_by_cli_alias(alias) is get_preset_by_id(preset_id)
    assert resolve_preset(alias) is get_preset_by_id(preset_id)
    assert resolve_preset(preset_id) is get_preset_by_id(preset_id)
    assert canonical_preset_id(alias) == preset_id
    assert canonical_preset_id(preset_id) == preset_id


def test_old_english_ids_remain_canonical_and_default_is_stable():
    assert canonical_preset_id("en_v1") == "en_v1"
    assert canonical_preset_id("en_v2") == "en_v2"
    assert DEFAULT_PRESET_ID == "en_v1"


def test_registry_owns_display_data_without_physical_script_metadata():
    for preset in PRESETS:
        assert not hasattr(preset, "module")
        assert not hasattr(preset, "script")
        assert get_display_value(preset, "后处理") == POSTPROCESS_STRATEGIES[
            preset.postprocess_strategy
        ]


def test_registry_rejects_duplicate_ids_and_aliases():
    with pytest.raises(ValueError, match="duplicate preset ids"):
        validate_registry([PRESETS[0], replace(PRESETS[1], id=PRESETS[0].id)])
    with pytest.raises(ValueError, match="duplicate CLI aliases"):
        validate_registry(
            [PRESETS[0], replace(PRESETS[1], cli_alias=PRESETS[0].cli_alias)]
        )


def test_registry_rejects_unknown_strategy_and_wrong_parameter_type():
    with pytest.raises(ValueError, match="unknown postprocess strategy"):
        validate_registry(
            [replace(PRESETS[0], postprocess_strategy="missing")]
        )

    params = PRESETS[0].transcription_options()
    params["beam_size"] = True
    with pytest.raises(ValueError, match="beam_size must be int"):
        validate_registry([replace(PRESETS[0], params=params)])


def test_registry_validation_passes_for_all_production_presets():
    validate_registry(PRESETS)


def test_unknown_id_alias_and_general_value_raise_clear_key_errors():
    with pytest.raises(KeyError, match="preset id"):
        get_preset_by_id("unknown")
    with pytest.raises(KeyError, match="CLI preset"):
        get_preset_by_cli_alias("unknown")
    with pytest.raises(KeyError, match="未知 preset"):
        resolve_preset("unknown")
