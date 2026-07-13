"""Unit tests for pure post-processing functions."""

from __future__ import annotations

import pytest

from whisper_subtitle.domain.postprocess import (
    clean_inner_repetition,
    clean_repetition,
    ensure_chinese_punctuation,
    ensure_proper_case,
)


@pytest.mark.parametrize(
    ("source", "expected"),
    [
        ("", ""),
        ("hello world. i use youtube on monday.", "Hello world. I use YouTube on Monday."),
        ("i'm learning english with google", "I'm learning English with Google"),
        ("...", "..."),
        ("  hello", "Hello"),
    ],
)
def test_ensure_proper_case_common_and_edge_cases(source, expected):
    assert ensure_proper_case(source) == expected


@pytest.mark.parametrize(
    ("source", "expected"),
    [
        ("", ""),
        ("你好,世界", "你好，世界。"),
        ("真的?", "真的？"),
        ("(测试):完成!", "（测试）：完成！"),
        (".", "。"),
        ("已经结束。", "已经结束。"),
    ],
)
def test_ensure_chinese_punctuation_common_and_edge_cases(source, expected):
    assert ensure_chinese_punctuation(source) == expected


@pytest.mark.parametrize(
    ("source", "expected"),
    [
        ([], []),
        (["one"], ["one"]),
        (["one", "one", "two", "two"], ["one", "two"]),
        (["one", "two", "one"], ["one", "two", "one"]),
        (["start", "tail", "tail", "tail", "tail", "tail"], ["start", "tail"]),
    ],
)
def test_clean_repetition_only_removes_consecutive_duplicates(source, expected):
    assert clean_repetition(source) == expected


@pytest.mark.parametrize(
    ("source", "expected"),
    [
        ("", ""),
        ("谢谢观看谢谢观看谢谢观看", "谢谢观看"),
        ("天气天气天气", "天气"),
        ("测试测试测试测试结束", "测试结束"),
        ("好的好的", "好的好的"),
        ("对对", "对对"),
    ],
)
def test_clean_inner_repetition_keeps_normal_double_emphasis(source, expected):
    assert clean_inner_repetition(source) == expected
