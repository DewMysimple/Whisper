"""The single typed registry for every WhisperSubtitle transcription preset."""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from types import MappingProxyType
from typing import Any

from .contracts import Preset
from .models import CALIBRATED_MODEL_IDS, TRANSLATION_MODEL_IDS
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

MODEL_CALIBRATED_IDS = CALIBRATED_MODEL_IDS

POSTPROCESS_STRATEGIES = STRATEGY_LABELS

DISPLAY_KEYS = (
    "language",
    "task",
    "beam_size",
    "best_of",
    "patience",
    "length_penalty",
    "temperature",
    "repetition_penalty",
    "no_repeat_ngram_size",
    "compression_ratio_threshold",
    "log_prob_threshold",
    "no_speech_threshold",
    "condition_on_previous_text",
    "prompt_reset_on_temperature",
    "initial_prompt",
    "hotwords",
    "word_timestamps",
    "vad_filter",
    "min_silence_duration_ms",
    "后处理",
)

DEFAULT_PRESET_ID = "en_v1"
DEFAULT_CLI_ALIAS = "en"

EDITABLE_PARAMETER_RULES = MappingProxyType(
    {
        "beam_size": (int, 1, 20),
        "best_of": (int, 1, 20),
        "patience": (float, 0, 5),
        "length_penalty": (float, 0, 2),
        "temperature": (float, 0, 1),
        "repetition_penalty": (float, 1, 2),
        "no_repeat_ngram_size": (int, 0, 10),
        "compression_ratio_threshold": (float, 0, 10),
        "log_prob_threshold": (float, -10, 0),
        "no_speech_threshold": (float, 0, 1),
        "condition_on_previous_text": (bool, 0, 1),
        "prompt_reset_on_temperature": (float, 0, 1),
        "min_silence_duration_ms": (int, 0, 10000),
    }
)


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
        "repetition_penalty": 1.0,
        "no_repeat_ngram_size": 0,
        "compression_ratio_threshold": compression_ratio_threshold,
        "log_prob_threshold": log_prob_threshold,
        "no_speech_threshold": no_speech_threshold,
        "condition_on_previous_text": condition_on_previous_text,
        "prompt_reset_on_temperature": 0.5,
        "initial_prompt": initial_prompt,
        "hotwords": None,
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
    "repetition_penalty": float,
    "no_repeat_ngram_size": int,
    "compression_ratio_threshold": float,
    "log_prob_threshold": float,
    "no_speech_threshold": float,
    "condition_on_previous_text": bool,
    "prompt_reset_on_temperature": float,
    "initial_prompt": str,
    "hotwords": type(None),
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


def derive_preset(
    base_preset_id: str,
    overrides: Mapping[str, Any],
    *,
    model_id: str | None = None,
) -> Preset:
    """Create a validated task-local preset without mutating the registry."""
    base = get_preset_by_id(base_preset_id)
    if not isinstance(overrides, Mapping):
        raise TypeError("overrides must be a mapping")
    text_override_keys = {"initial_prompt", "hotwords"}
    task_override_keys = {"task"}
    unknown = set(overrides) - (
        set(EDITABLE_PARAMETER_RULES) | text_override_keys | task_override_keys
    )
    if unknown:
        raise ValueError(f"unsupported parameter overrides: {sorted(unknown)}")

    params = base.transcription_options()
    if model_id in MODEL_CALIBRATED_IDS:
        # Detect a stable primary language from multiple windows. faster-whisper
        # 1.2.1's `multilingual=True` chooses one language token independently
        # for every 30-second window; real mixed Chinese/English validation showed
        # that it can translate a whole mixed window or even jump to Korean.
        # Stable automatic detection keeps preset language out of recognition
        # while avoiding those false per-window switches.
        params["language"] = None
        params["multilingual"] = False
        params["language_detection_segments"] = 5
        # 1.0 forces the detector to inspect all configured windows and choose
        # their majority instead of accepting one locally confident mixed window.
        params["language_detection_threshold"] = 1.0
        # Language-specific prompts were empirically found to reintroduce
        # translation-style bias on mixed Chinese/English recordings even with
        # multilingual decoding enabled. Leave the decoder prompt empty so the
        # preset controls formatting only.
        params["initial_prompt"] = None
        # faster-whisper only retries failed decoding thresholds when more than
        # one temperature is supplied. Turbo is deliberately capped at 0.6 to
        # avoid high-temperature inventions observed in noisy mixed-language
        # recordings; full V3 retains the canonical complete fallback ladder.
        params["temperature"] = (
            [0.0, 0.2, 0.4, 0.6]
            if model_id == "large-v3-turbo"
            else [0.0, 0.2, 0.4, 0.6, 0.8, 1.0]
        )
        if base.postprocess_strategy.endswith("anti_hallucination"):
            params["log_prob_threshold"] = -1.0
            params["no_speech_threshold"] = 0.6

    if "task" in overrides:
        task = overrides["task"]
        if task not in {"transcribe", "translate"}:
            raise ValueError(f"invalid override for task: {task!r}")
        if task == "translate" and base.format_language != "en":
            raise ValueError("translate is only supported by English presets")
        if task == "translate" and model_id not in TRANSLATION_MODEL_IDS:
            raise ValueError(
                f"{model_id} is not trained for translation; use large-v3"
            )
        params["task"] = task

    for name in text_override_keys.intersection(overrides):
        params[name] = _normalize_prompt_override(name, overrides[name])

    for name, value in overrides.items():
        if name in text_override_keys or name in task_override_keys:
            continue
        expected_type, minimum, maximum = EDITABLE_PARAMETER_RULES[name]
        if expected_type is bool:
            valid_type = type(value) is bool
        elif expected_type is int:
            valid_type = type(value) is int
        else:
            valid_type = type(value) in {int, float}
        if not valid_type or not minimum <= value <= maximum:
            raise ValueError(f"invalid override for {name}: {value!r}")
        normalized = float(value) if expected_type is float else value
        if name == "min_silence_duration_ms":
            params["vad_parameters"][name] = normalized
        else:
            params[name] = normalized

    return Preset(
        id=base.id,
        cli_alias=base.cli_alias,
        label=base.label,
        description=base.description,
        group=base.group,
        params=params,
        postprocess_strategy=base.postprocess_strategy,
    )


def _normalize_prompt_override(name: str, value: Any) -> str:
    if not isinstance(value, str):
        raise ValueError(f"invalid override for {name}: {value!r}")
    normalized = value.replace("\r\n", "\n").replace("\r", "\n").strip()
    if not normalized or len(normalized) > 4000:
        raise ValueError(f"invalid override for {name}: text length is outside 1..4000")
    if any(ord(character) < 0x20 and character not in {"\n", "\t"} for character in normalized):
        raise ValueError(f"invalid override for {name}: text contains control characters")
    return normalized


def get_postprocess_label(preset: Preset) -> str:
    return POSTPROCESS_STRATEGIES[preset.postprocess_strategy]


def get_display_value(preset: Preset, key: str) -> str:
    if key == "后处理":
        return get_postprocess_label(preset)
    if key == "min_silence_duration_ms":
        return str(preset.params["vad_parameters"]["min_silence_duration_ms"])
    value = preset.params.get(key)
    return str(value) if value is not None else "-"
