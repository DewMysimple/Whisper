"""Pure merging of Whisper-like segments into sentence dictionaries."""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from typing import Protocol


class SegmentLike(Protocol):
    text: str
    start: float
    end: float


ENGLISH_ENDINGS = (".", "!", "?", '."', '!"', '?"', ".'", "!'", "?'")
CHINESE_ENDINGS = ("。", "！", "？", '。"', '！"', '？"')


def merge_segments_to_sentences(
    segments: Iterable[SegmentLike], sentence_endings: Sequence[str]
) -> list[dict[str, float | str]]:
    """Merge adjacent non-empty segments until one ends with a terminator."""
    sentences = []
    current_parts = []
    current_start = 0.0
    current_end = 0.0

    for segment in segments:
        text = segment.text.strip()
        if not text:
            continue
        if not current_parts:
            current_start = segment.start
        current_parts.append(text)
        current_end = segment.end

        if any(text.endswith(punctuation) for punctuation in sentence_endings):
            sentences.append(
                {
                    "start": current_start,
                    "end": current_end,
                    "text": " ".join(current_parts),
                }
            )
            current_parts = []

    if current_parts:
        sentences.append(
            {
                "start": current_start,
                "end": current_end,
                "text": " ".join(current_parts),
            }
        )
    return sentences


def merge_english_segments_to_sentences(
    segments: Iterable[SegmentLike],
) -> list[dict[str, float | str]]:
    return merge_segments_to_sentences(segments, ENGLISH_ENDINGS)


def merge_chinese_segments_to_sentences(
    segments: Iterable[SegmentLike],
) -> list[dict[str, float | str]]:
    return merge_segments_to_sentences(segments, CHINESE_ENDINGS)
