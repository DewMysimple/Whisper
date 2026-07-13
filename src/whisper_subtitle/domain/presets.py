"""The single typed registry for every WhisperSubtitle transcription preset."""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from types import MappingProxyType
from typing import Any

from .contracts import Preset
from .postprocess.strategies import STRATEGY_LABELS


CN_PROMPT = (
    "请准确转录以下中文音频。"
    "使用正确的中文标点符号。"
    "确保每个句子完整，并以句号、感叹号或问号结尾。"
    "保持原文的语气和表达方式。"
)

EN_PROMPT = (
    "Please transcribe the following English audio accurately. "
    "Use proper punctuation, capitalization, and grammar. "
    "Ensure each sentence is complete and ends with a period, exclamation mark, or question mark."
)

POSTPROCESS_STRATEGIES = STRATEGY_LABELS

DISPLAY_KEYS = (
    "language",
    "task",
    "beam_size",
    "best_of",
    "patience",
    "length_penalty",
    "temperature",
    "compression_ratio_threshold",
    "log_prob_threshold",
    "no_speech_threshold",
    "condition_on_previous_text",
    "word_timestamps",
    "vad_filter",
    "min_silence_duration_ms",
    "后处理",
)

DEFAULT_PRESET_ID = "en_v1"
DEFAULT_CLI_ALIAS = "en"


def _params(
    *,
    language: str,
    compression_ratio_threshold: float,
    log_prob_threshold: float,
    no_speech_threshold: float,
    condition_on_previous_text: bool,
    initial_prompt: str,
    min_silence_duration_ms: int,
) -> dict[str, Any]:
    return {
        "language": language,
        "task": "transcribe",
        "beam_size": 5,
        "best_of": 5,
        "patience": 1.5,
        "length_penalty": 1.0,
        "temperature": 0.0,
        "compression_ratio_threshold": compression_ratio_threshold,
        "log_prob_threshold": log_prob_threshold,
        "no_speech_threshold": no_speech_threshold,
        "condition_on_previous_text": condition_on_previous_text,
        "initial_prompt": initial_prompt,
        "word_timestamps": False,
        "vad_filter": True,
        "vad_parameters": {
            "min_silence_duration_ms": min_silence_duration_ms,
            "max_speech_duration_s": 999999,
        },
    }


PRESETS = (
    Preset(
        id="cn",
        cli_alias="cn",
        label="中文转录",
        description="中文语音转录，输出到 Text 文件夹",
        group="中文",
        params=_params(
            language="zh",
            compression_ratio_threshold=2.4,
            log_prob_threshold=-1.0,
            no_speech_threshold=0.6,
            condition_on_previous_text=True,
            initial_prompt=CN_PROMPT,
            min_silence_duration_ms=300,
        ),
        postprocess_strategy="chinese_standard",
    ),
    Preset(
        id="cn2",
        cli_alias="cn2",
        label="中文防幻觉",
        description="中文防幻觉版，关闭上下文 + 收紧阈值，清理尾部与句内重复幻觉，输出到 Text 文件夹",
        group="中文",
        params=_params(
            language="zh",
            compression_ratio_threshold=2.0,
            log_prob_threshold=-1.5,
            no_speech_threshold=0.8,
            condition_on_previous_text=False,
            initial_prompt=CN_PROMPT,
            min_silence_duration_ms=500,
        ),
        postprocess_strategy="chinese_anti_hallucination",
    ),
    Preset(
        id="en_v1",
        cli_alias="en",
        label="英文标准版",
        description="英文标准版，输出到 Text 文件夹",
        group="英文",
        params=_params(
            language="en",
            compression_ratio_threshold=2.4,
            log_prob_threshold=-1.0,
            no_speech_threshold=0.6,
            condition_on_previous_text=True,
            initial_prompt=EN_PROMPT,
            min_silence_duration_ms=300,
        ),
        postprocess_strategy="english_standard",
    ),
    Preset(
        id="en_v2",
        cli_alias="en2",
        label="英文防幻觉",
        description="英文防幻觉版，自动清理视频结尾的重复幻觉，输出到 Text 文件夹",
        group="英文",
        params=_params(
            language="en",
            compression_ratio_threshold=2.0,
            log_prob_threshold=-1.5,
            no_speech_threshold=0.8,
            condition_on_previous_text=False,
            initial_prompt=EN_PROMPT,
            min_silence_duration_ms=500,
        ),
        postprocess_strategy="english_anti_hallucination",
    ),
)


_PARAMETER_TYPES = {
    "language": str,
    "task": str,
    "beam_size": int,
    "best_of": int,
    "patience": float,
    "length_penalty": float,
    "temperature": float,
    "compression_ratio_threshold": float,
    "log_prob_threshold": float,
    "no_speech_threshold": float,
    "condition_on_previous_text": bool,
    "initial_prompt": str,
    "word_timestamps": bool,
    "vad_filter": bool,
    "vad_parameters": Mapping,
}


def _validate_params(preset: Preset, errors: list[str]) -> None:
    missing = set(_PARAMETER_TYPES).difference(preset.params)
    if missing:
        errors.append(f"{preset.id}: missing params {sorted(missing)}")
        return
    for key, expected_type in _PARAMETER_TYPES.items():
        value = preset.params[key]
        valid = isinstance(value, expected_type) if expected_type is Mapping else type(value) is expected_type
        if not valid:
            expected_name = getattr(expected_type, "__name__", str(expected_type))
            errors.append(f"{preset.id}: param {key} must be {expected_name}")
    vad_parameters = preset.params.get("vad_parameters")
    if isinstance(vad_parameters, Mapping):
        for key in ("min_silence_duration_ms", "max_speech_duration_s"):
            if type(vad_parameters.get(key)) is not int:
                errors.append(f"{preset.id}: vad parameter {key} must be int")


def validate_registry(presets: Iterable[Preset]) -> None:
    """Fail fast when identifiers, aliases, strategies or parameters drift."""
    values = tuple(presets)
    errors: list[str] = []
    ids = [preset.id for preset in values]
    aliases = [preset.cli_alias for preset in values]
    duplicate_ids = sorted({value for value in ids if ids.count(value) > 1})
    duplicate_aliases = sorted(
        {value for value in aliases if aliases.count(value) > 1}
    )
    if duplicate_ids:
        errors.append(f"duplicate preset ids: {duplicate_ids}")
    if duplicate_aliases:
        errors.append(f"duplicate CLI aliases: {duplicate_aliases}")

    for preset in values:
        if preset.postprocess_strategy not in POSTPROCESS_STRATEGIES:
            errors.append(
                f"{preset.id}: unknown postprocess strategy "
                f"{preset.postprocess_strategy}"
            )
        _validate_params(preset, errors)

    if errors:
        raise ValueError("invalid preset registry:\n- " + "\n- ".join(errors))


validate_registry(PRESETS)

PRESETS_BY_ID = MappingProxyType({preset.id: preset for preset in PRESETS})
PRESETS_BY_CLI_ALIAS = MappingProxyType(
    {preset.cli_alias: preset for preset in PRESETS}
)
CLI_ALIASES = tuple(PRESETS_BY_CLI_ALIAS)


def get_preset_by_id(preset_id: str) -> Preset:
    try:
        return PRESETS_BY_ID[preset_id]
    except KeyError as exc:
        raise KeyError(f"未知 preset id: {preset_id}") from exc


def get_preset_by_cli_alias(cli_alias: str) -> Preset:
    try:
        return PRESETS_BY_CLI_ALIAS[cli_alias]
    except KeyError as exc:
        raise KeyError(f"未知 CLI preset: {cli_alias}") from exc


def resolve_preset(value: str) -> Preset:
    """Resolve either a canonical ID or a public CLI alias."""
    if value in PRESETS_BY_ID:
        return PRESETS_BY_ID[value]
    if value in PRESETS_BY_CLI_ALIAS:
        return PRESETS_BY_CLI_ALIAS[value]
    raise KeyError(f"未知 preset: {value}")


def canonical_preset_id(value: str) -> str:
    return resolve_preset(value).id


def get_postprocess_label(preset: Preset) -> str:
    return POSTPROCESS_STRATEGIES[preset.postprocess_strategy]


def get_display_value(preset: Preset, key: str) -> str:
    if key == "后处理":
        return get_postprocess_label(preset)
    if key == "min_silence_duration_ms":
        return str(preset.params["vad_parameters"]["min_silence_duration_ms"])
    value = preset.params.get(key)
    return str(value) if value is not None else "-"
