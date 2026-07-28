"""Shared Unicode, Simplified-Chinese and mixed-language normalization."""

from __future__ import annotations

from functools import lru_cache
import unicodedata


_ASCII_TO_CJK = {
    ",": "，",
    ".": "。",
    "!": "！",
    "?": "？",
    ":": "：",
    ";": "；",
}
_CJK_TO_ASCII = {value: key for key, value in _ASCII_TO_CJK.items()}
_OPENING = {"(": "（", "[": "［"}
_CLOSING = {")": "）", "]": "］"}
_CJK_OPENING_TO_ASCII = {value: key for key, value in _OPENING.items()}
_CJK_CLOSING_TO_ASCII = {value: key for key, value in _CLOSING.items()}
_STRONG_ENDINGS = frozenset(".!?。！？")


def _is_cjk(character: str) -> bool:
    value = ord(character)
    return (
        0x3400 <= value <= 0x4DBF
        or 0x4E00 <= value <= 0x9FFF
        or 0xF900 <= value <= 0xFAFF
    )


def _is_latin_context(character: str) -> bool:
    return character.isascii() and (character.isalnum() or character in "'_-")


def _nearest_context(text: str, index: int, step: int) -> str | None:
    cursor = index + step
    while 0 <= cursor < len(text):
        character = text[cursor]
        if _is_cjk(character):
            return "cjk"
        if _is_latin_context(character):
            return "latin"
        if not character.isspace() and unicodedata.category(character)[0] not in {"P", "S"}:
            return "other"
        cursor += step
    return None


def _context_language(text: str, index: int, default_language: str) -> str:
    before = _nearest_context(text, index, -1)
    after = _nearest_context(text, index, 1)
    if before == after and before in {"cjk", "latin"}:
        return before
    if before in {"cjk", "latin"}:
        return before
    if after in {"cjk", "latin"}:
        return after
    return "cjk" if default_language == "zh" else "latin"


@lru_cache(maxsize=1)
def _opencc_converter():
    from opencc import OpenCC

    return OpenCC("t2s")


def sanitize_and_simplify(text: str) -> str:
    """Remove invalid/control characters and convert Traditional Chinese to Simplified."""
    cleaned = "".join(
        character
        for character in text
        if character != "\ufffd"
        and (
            character in "\n\t"
            or unicodedata.category(character) not in {"Cc", "Cs"}
        )
    )
    return _opencc_converter().convert(cleaned)


def normalize_mixed_punctuation(text: str, default_language: str) -> str:
    """Choose punctuation width from nearby script instead of the preset name."""
    normalized: list[str] = []
    for index, character in enumerate(text):
        context = _context_language(text, index, default_language)
        if character in _ASCII_TO_CJK or character in _CJK_TO_ASCII:
            ascii_character = _CJK_TO_ASCII.get(character, character)
            normalized.append(
                _ASCII_TO_CJK[ascii_character] if context == "cjk" else ascii_character
            )
        elif character in _OPENING or character in _CJK_OPENING_TO_ASCII:
            ascii_character = _CJK_OPENING_TO_ASCII.get(character, character)
            normalized.append(_OPENING[ascii_character] if context == "cjk" else ascii_character)
        elif character in _CLOSING or character in _CJK_CLOSING_TO_ASCII:
            ascii_character = _CJK_CLOSING_TO_ASCII.get(character, character)
            normalized.append(_CLOSING[ascii_character] if context == "cjk" else ascii_character)
        else:
            normalized.append(character)

    value = "".join(normalized)
    for invalid, replacement in (
        ("，。", "。"),
        ("，！", "！"),
        ("，？", "？"),
        (",.", "."),
        (",!", "!"),
        (",?", "?"),
        ("。.", "。"),
        (".。", "."),
    ):
        while invalid in value:
            value = value.replace(invalid, replacement)
    return value


def ensure_contextual_terminator(text: str, default_language: str) -> str:
    """Append a terminator that matches the final spoken script."""
    value = text.strip()
    if not value or value[-1] in _STRONG_ENDINGS:
        return value
    context = _nearest_context(value, len(value), -1)
    terminator = (
        "。" if context == "cjk" or (context is None and default_language == "zh") else "."
    )
    if value[-1] in "，,；;：:":
        value = value[:-1].rstrip()
    return value + terminator
