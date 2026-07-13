"""Composable post-processing pipelines selected by typed presets."""

from __future__ import annotations

from collections.abc import Callable, Iterable
from dataclasses import dataclass
from types import MappingProxyType

from .chinese import ensure_chinese_punctuation
from .english import ensure_proper_case, ensure_punctuation
from .repetition import clean_inner_repetition, clean_repetition


TextTransform = Callable[[str], str]
LinesTransform = Callable[[list[str]], list[str]]


@dataclass(frozen=True, slots=True)
class PostprocessStrategy:
    id: str
    label: str
    text_transforms: tuple[TextTransform, ...] = ()
    lines_transforms: tuple[LinesTransform, ...] = ()

    def process_text(self, text: str) -> str:
        for transform in self.text_transforms:
            text = transform(text)
        return text

    def process_lines(self, lines: Iterable[str]) -> list[str]:
        processed = [self.process_text(line) for line in lines]
        for transform in self.lines_transforms:
            processed = transform(processed)
        return processed


STRATEGIES = MappingProxyType(
    {
        "english_standard": PostprocessStrategy(
            id="english_standard",
            label="无",
            text_transforms=(ensure_proper_case, ensure_punctuation),
        ),
        "english_anti_hallucination": PostprocessStrategy(
            id="english_anti_hallucination",
            label="clean_repetition()",
            text_transforms=(ensure_proper_case, ensure_punctuation),
            lines_transforms=(clean_repetition,),
        ),
        "chinese_standard": PostprocessStrategy(
            id="chinese_standard",
            label="无",
            text_transforms=(ensure_chinese_punctuation,),
        ),
        "chinese_anti_hallucination": PostprocessStrategy(
            id="chinese_anti_hallucination",
            label="中文标点 + clean_inner_repetition + clean_repetition",
            text_transforms=(ensure_chinese_punctuation, clean_inner_repetition),
            lines_transforms=(clean_repetition,),
        ),
    }
)

STRATEGY_LABELS = MappingProxyType(
    {strategy_id: strategy.label for strategy_id, strategy in STRATEGIES.items()}
)


def get_strategy(strategy_id: str) -> PostprocessStrategy:
    try:
        return STRATEGIES[strategy_id]
    except KeyError as exc:
        raise KeyError(f"未知后处理策略: {strategy_id}") from exc


def apply_strategy(strategy_id: str, lines: Iterable[str]) -> list[str]:
    return get_strategy(strategy_id).process_lines(lines)
