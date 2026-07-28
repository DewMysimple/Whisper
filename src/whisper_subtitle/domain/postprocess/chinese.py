"""Context-aware punctuation for the Chinese formatting profile."""

from __future__ import annotations

from .multilingual import ensure_contextual_terminator, normalize_mixed_punctuation


def ensure_chinese_punctuation(text: str) -> str:
    """Use Chinese punctuation around CJK and preserve English punctuation."""
    return ensure_contextual_terminator(
        normalize_mixed_punctuation(text, "zh"),
        "zh",
    )
