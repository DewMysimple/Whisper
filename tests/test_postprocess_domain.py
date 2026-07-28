"""Behavior contracts for pure post-processing strategies."""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from whisper_subtitle.domain.postprocess import (
    STRATEGIES,
    apply_strategy,
    ensure_punctuation,
    get_strategy,
    merge_chinese_segments_to_sentences,
    merge_english_segments_to_sentences,
)
from whisper_subtitle.domain.presets import PRESETS


def make_segments(*texts):
    return [
        SimpleNamespace(text=text, start=float(index), end=float(index) + 0.5)
        for index, text in enumerate(texts)
    ]


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("", ""),
        ("hello", "hello."),
        ("hello.", "hello."),
        ("really?", "really?"),
        ("  hi  ", "hi."),
    ],
)
def test_english_punctuation_contract(text, expected):
    assert ensure_punctuation(text) == expected


def test_english_segment_merging_preserves_boundaries_and_timestamps():
    segments = make_segments("", "hello", "world.", "tail")

    assert merge_english_segments_to_sentences(segments) == [
        {"start": 1.0, "end": 2.5, "text": "hello world."},
        {"start": 3.0, "end": 3.5, "text": "tail"},
    ]


def test_chinese_segment_merging_uses_chinese_sentence_endings():
    segments = make_segments("你好", "世界。", "尾部")

    assert merge_chinese_segments_to_sentences(segments) == [
        {"start": 0.0, "end": 1.5, "text": "你好 世界。"},
        {"start": 2.0, "end": 2.5, "text": "尾部"},
    ]


def test_strategy_chains_compose_language_normalization_and_repetition_steps():
    english = apply_strategy(
        "english_anti_hallucination", ["hello youtube", "hello youtube"]
    )
    chinese = apply_strategy(
        "chinese_anti_hallucination",
        ["谢谢观看谢谢观看谢谢观看", "谢谢观看谢谢观看谢谢观看"],
    )

    assert english == ["Hello YouTube."]
    assert chinese == ["谢谢观看。"]
    assert apply_strategy("english_standard", ["hello"]) == ["Hello."]
    assert apply_strategy("chinese_standard", ["你好,世界"]) == ["你好，世界。"]


def test_all_strategies_simplify_chinese_remove_replacement_chars_and_preserve_mixed_language():
    source = "我錄了一些事情�。Baby, are you busy? 謝謝。"

    for strategy_id in STRATEGIES:
        result = apply_strategy(strategy_id, [source])[0]
        assert "錄" not in result
        assert "謝" not in result
        assert "�" not in result
        assert "Baby, are you busy?" in result
        assert "我录了一些事情。" in result


def test_each_preset_selects_an_existing_complete_strategy_chain():
    assert {preset.postprocess_strategy for preset in PRESETS} == set(STRATEGIES)
    assert all(get_strategy(preset.postprocess_strategy) for preset in PRESETS)


def test_unknown_strategy_raises_clear_key_error():
    with pytest.raises(KeyError, match="未知后处理策略"):
        get_strategy("unknown")
