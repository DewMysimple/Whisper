"""Restore transcript punctuation around real aligner word boundaries."""

from __future__ import annotations

import math
import unicodedata
from collections.abc import Mapping, Sequence

from .transcription import TranscribedWord


def _spoken_character(char: str) -> bool:
    return unicodedata.category(char)[0] in {"L", "N", "M"}


def aligned_words(text: str, timestamps: Sequence[Mapping], *, offset: float,
                  duration: float) -> tuple[TranscribedWord, ...]:
    """Keep every character while attaching punctuation to measured tokens.

    Alignment may strip punctuation inside tokens (e.g. apostrophes). Match
    spoken characters in order, preserving the original spans and spaces.
    Never synthesize evenly spaced timestamps if the aligner fails.
    """
    indices = [i for i, char in enumerate(text) if _spoken_character(char) for _ in char.casefold()]
    spoken = "".join(char.casefold() for char in text if _spoken_character(char))
    cursor = 0
    spans = []
    previous_start = 0.0
    for item in timestamps:
        token = "".join(c for c in str(item["text"]) if _spoken_character(c)).casefold()
        if not token:
            continue
        if not spoken.startswith(token, cursor):
            raise ValueError("Qwen 对齐文字与转录不一致，无法生成可靠字幕时间戳")
        start, end = float(item["start_time"]), float(item["end_time"])
        if not all(math.isfinite(t) for t in (start, end)) or start < previous_start or start < 0 or end < start or start > duration:
            raise ValueError("Qwen 返回了无效的字幕时间戳")
        spans.append((indices[cursor], indices[cursor + len(token) - 1] + 1,
                      start, min(end, duration)))
        cursor += len(token)
        previous_start = start
    if cursor != len(indices) or (indices and not spans):
        raise ValueError("Qwen 未返回完整的逐词对齐，无法生成可靠字幕时间戳")
    words = []
    start_index = 0
    for index, (_begin, end_index, start, end) in enumerate(spans):
        following = spans[index + 1][0] if index + 1 < len(spans) else len(text)
        # Closing punctuation stays with this token; whitespace begins the next.
        while end_index < following and not text[end_index].isspace():
            end_index += 1
        if index + 1 == len(spans):
            end_index = len(text)
        words.append(TranscribedWord(offset + start, offset + end, text[start_index:end_index]))
        start_index = end_index
    return tuple(words)
