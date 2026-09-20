"""Public task-local inference options, independent of the runtime dependency.

The catalog projects to the UI and IPC schema. Omitted overrides retain preset
calibration or the engine default; this does not change canonical CLI presets.
"""

from __future__ import annotations

import math
from collections.abc import Mapping
from typing import Any

# (type, lower bound, upper bound). VAD names are flattened only at the IPC edge.
PARAMETER_RULES = {
    "beam_size": (int, 1, 20),
    "best_of": (int, 1, 20),
    "patience": (float, 0.1, 5),
    "length_penalty": (float, 0, 2),
    "temperature": (float, 0, 1),
    "repetition_penalty": (float, 1, 2),
    "no_repeat_ngram_size": (int, 0, 10),
    "compression_ratio_threshold": (float, 0, 10),
    "log_prob_threshold": (float, -10, 0),
    "no_speech_threshold": (float, 0, 1),
    "condition_on_previous_text": (bool, 0, 1),
    "prompt_reset_on_temperature": (float, 0, 1),
    "multilingual": (bool, 0, 1),
    "language_detection_threshold": (float, 0, 1),
    "language_detection_segments": (int, 1, 100),
    "suppress_blank": (bool, 0, 1),
    "word_timestamps": (bool, 0, 1),
    "max_initial_timestamp": (float, 0, 30),
    "vad_filter": (bool, 0, 1),
    "vad_threshold": (float, 0, 1),
    "vad_neg_threshold": (float, 0, 1),
    "min_speech_duration_ms": (int, 0, 10000),
    "min_silence_duration_ms": (int, 0, 10000),
    "max_speech_duration_s": (float, 1, 999999),
    "speech_pad_ms": (int, 0, 5000),
    "max_new_tokens": (int, 1, 440),
    "chunk_length": (int, 1, 30),
    "hallucination_silence_threshold": (float, 0.1, 3600),
}
VAD_PARAMETER_NAMES = {
    "vad_threshold": "threshold",
    "vad_neg_threshold": "neg_threshold",
    "min_speech_duration_ms": "min_speech_duration_ms",
    "min_silence_duration_ms": "min_silence_duration_ms",
    "max_speech_duration_s": "max_speech_duration_s",
    "speech_pad_ms": "speech_pad_ms",
}
NULLABLE_PARAMETERS = frozenset({
    "language", "compression_ratio_threshold", "log_prob_threshold",
    "no_speech_threshold", "vad_neg_threshold", "max_new_tokens",
    "hallucination_silence_threshold", "initial_prompt", "hotwords", "prefix",
})
TEXT_PARAMETERS = frozenset({
    "initial_prompt", "hotwords", "prefix", "prepend_punctuations", "append_punctuations",
})
# Whisper multilingual tokenizer language codes (including Cantonese).
LANGUAGE_CODES = tuple("en zh de es ru ko fr ja pt tr pl ca nl ar sv it id hi fi vi he uk el ms cs ro da hu ta no th ur hr bg lt la mi ml cy sk te fa lv bn sr az sl kn et mk br eu is hy ne mn bs kk sq sw gl mr pa si km sn yo so af oc ka be tg sd gu am yi lo uz fo ht ps tk nn mt sa lb my bo tl mg as tt haw ln ha ba jw su yue".split())
SPECIAL_PARAMETERS = TEXT_PARAMETERS | {"task", "language", "suppress_tokens"}

# Values are used for displaying inherited settings only; they are not injected
# into tasks unless the user overrides them. Defaults match faster-whisper 1.2.1.
ENGINE_DEFAULTS = {
    "multilingual": False,
    "language_detection_threshold": 0.5,
    "language_detection_segments": 1,
    "suppress_blank": True,
    "suppress_tokens": [-1],
    "word_timestamps": False,
    "max_initial_timestamp": 1.0,
    "vad_filter": False,
    "vad_threshold": 0.5,
    "vad_neg_threshold": None,
    "min_speech_duration_ms": 0,
    "max_speech_duration_s": 999999,
    "speech_pad_ms": 400,
    "max_new_tokens": None,
    "chunk_length": 30,
    "hallucination_silence_threshold": None,
    "prefix": None,
    "prepend_punctuations": "\"'“¿([{-",
    "append_punctuations": "\"'.。,，!！?？:：”)]}、",
}


def normalize_parameter(name: str, value: Any) -> Any:
    if value is None and name in NULLABLE_PARAMETERS:
        return None
    valid = False
    if name in TEXT_PARAMETERS:
        if isinstance(value, str):
            value = value.replace("\r\n", "\n").replace("\r", "\n")
            if name in {"initial_prompt", "hotwords", "prefix"}:
                value = value.strip()
            valid = len(value) <= 4000 and all(
                ord(c) >= 0x20 or c in {"\n", "\t"} for c in value
            ) and (bool(value) or name in {"prepend_punctuations", "append_punctuations"})
    elif name == "language":
        valid = isinstance(value, str) and value in LANGUAGE_CODES
    elif name == "task":
        valid = isinstance(value, str) and value in {"transcribe", "translate"}
    elif name == "temperature" and isinstance(value, (list, tuple)):
        valid = 1 <= len(value) <= 10 and all(
            type(item) in {int, float} and 0 <= item <= 1 and math.isfinite(item)
            for item in value
        ) and all(a < b for a, b in zip(value, value[1:]))
        value = list(value)
    elif name == "suppress_tokens":
        valid = isinstance(value, (list, tuple)) and len(value) <= 256 and all(
            type(item) is int and -1 <= item <= 51864 for item in value
        )
        if valid:
            value = list(value)
    elif name in PARAMETER_RULES:
        kind, low, high = PARAMETER_RULES[name]
        valid = (
            type(value) is kind if kind in {int, bool}
            else type(value) in {int, float}
        ) and (kind is bool or (low <= value <= high and math.isfinite(value)))
    if not valid:
        raise ValueError(f"invalid override for {name}: {value!r}")
    return value


def normalize_overrides(overrides: Mapping[str, Any]) -> dict[str, Any]:
    return {name: normalize_parameter(name, value) for name, value in overrides.items()}


def parameter_schema() -> dict[str, Any]:
    properties: dict[str, Any] = {}
    for name, (kind, low, high) in PARAMETER_RULES.items():
        properties[name] = {"type": "boolean"} if kind is bool else {
            "type": "integer" if kind is int else "number", "minimum": low, "maximum": high,
        }
    properties["temperature"] = {"oneOf": [properties["temperature"], {
        "type": "array", "minItems": 1, "maxItems": 10,
        "items": {"type": "number", "minimum": 0, "maximum": 1},
    }]}
    properties.update({name: {
        "type": "string", "maxLength": 4000,
        "minLength": 0 if name in {"prepend_punctuations", "append_punctuations"} else 1,
    } for name in sorted(TEXT_PARAMETERS)})
    properties["task"] = {"type": "string", "enum": ["transcribe", "translate"]}
    properties["language"] = {"type": "string", "enum": list(LANGUAGE_CODES)}
    properties["suppress_tokens"] = {"type": "array", "maxItems": 256,
        "items": {"type": "integer", "minimum": -1, "maximum": 51864}}
    for name in sorted(NULLABLE_PARAMETERS):
        properties[name] = {"anyOf": [properties[name], {"type": "null"}]}
    return {"type": "object", "additionalProperties": False, "properties": properties}
