"""Task parameter capabilities and defaults for non-Whisper backends."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from .models import MODELS_BY_ID
from .parameters import VAD_PARAMETER_NAMES


QWEN_LANGUAGES = dict(zip(
    "zh en yue ar de fr es pt id it ko ru th vi ja tr hi ms nl sv da fi pl cs tl fa el hu mk ro".split(),
    ("Chinese English Cantonese Arabic German French Spanish Portuguese Indonesian Italian "
     "Korean Russian Thai Vietnamese Japanese Turkish Hindi Malay Dutch Swedish Danish Finnish "
     "Polish Czech Filipino Persian Greek Hungarian Macedonian Romanian").split(),
    strict=True,
))
QWEN_ALIGNMENT_LANGUAGES = frozenset("zh en yue fr de it ja ko pt ru es".split())
QWEN_PARAMETER_NAMES = frozenset({
    "language", "initial_prompt", "hotwords", "word_timestamps", "max_new_tokens",
    "chunk_length", "vad_filter", *VAD_PARAMETER_NAMES,
})


def is_qwen_model(model_id: str | None) -> bool:
    definition = MODELS_BY_ID.get(model_id)
    return definition is not None and definition.backend == "qwen3-asr"


def qwen_defaults() -> dict[str, Any]:
    return {
        "language": None, "initial_prompt": None, "hotwords": None,
        "word_timestamps": False, "max_new_tokens": 440, "chunk_length": 30,
        "vad_filter": True,
        "vad_parameters": {
            "threshold": 0.05, "min_silence_duration_ms": 2000,
            "speech_pad_ms": 600, "max_speech_duration_s": 999999,
        },
    }


def validate_model_overrides(model_id: str | None, overrides: Mapping[str, Any]) -> None:
    if not is_qwen_model(model_id):
        return
    unsupported = set(overrides) - QWEN_PARAMETER_NAMES
    if unsupported:
        raise ValueError(f"{model_id} 不支持参数: {', '.join(sorted(unsupported))}")
    language = overrides.get("language")
    if language is not None and language not in QWEN_LANGUAGES:
        raise ValueError(f"{model_id} 不支持语言: {language}")
