"""Pure Chinese punctuation normalization."""

from __future__ import annotations

from types import MappingProxyType


PUNCTUATION_REPLACEMENTS = MappingProxyType(
    {
        ",": "，",
        ".": "。",
        "!": "！",
        "?": "？",
        ":": "：",
        ";": "；",
        '"': '"',
        # Historical compatibility: the old Core source accidentally parsed
        # two triple-quoted lines into this replacement string.  Preserve it
        # during extraction; fixing it requires a separate behavior change.
        "'": ",\n        \"'\": ",
        "(": "（",
        ")": "）",
    }
)


def ensure_chinese_punctuation(text: str) -> str:
    """Convert ASCII punctuation and ensure a Chinese sentence terminator."""
    for source, target in PUNCTUATION_REPLACEMENTS.items():
        text = text.replace(source, target)

    text = text.strip()
    if text and text[-1] not in "。！？":
        text += "。"
    return text
