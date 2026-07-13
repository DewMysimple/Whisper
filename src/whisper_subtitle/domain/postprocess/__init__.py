"""Pure text, segment and strategy post-processing APIs."""

from .chinese import ensure_chinese_punctuation
from .english import ensure_proper_case, ensure_punctuation
from .repetition import clean_inner_repetition, clean_repetition
from .segments import (
    merge_chinese_segments_to_sentences,
    merge_english_segments_to_sentences,
    merge_segments_to_sentences,
)
from .strategies import (
    STRATEGIES,
    STRATEGY_LABELS,
    PostprocessStrategy,
    apply_strategy,
    get_strategy,
)

__all__ = [
    "PostprocessStrategy",
    "STRATEGIES",
    "STRATEGY_LABELS",
    "apply_strategy",
    "clean_inner_repetition",
    "clean_repetition",
    "ensure_chinese_punctuation",
    "ensure_proper_case",
    "ensure_punctuation",
    "get_strategy",
    "merge_chinese_segments_to_sentences",
    "merge_english_segments_to_sentences",
    "merge_segments_to_sentences",
]
