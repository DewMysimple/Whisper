"""Unit tests for the post-processing functions kept in the four core modules."""

from __future__ import annotations

from pathlib import Path

import pytest

from whisper_subtitle.core import WhisperProject as en
from whisper_subtitle.core import WhisperProject2 as en2
from whisper_subtitle.core import WhisperProjectCN as cn
from whisper_subtitle.core import WhisperProjectCN2 as cn2


@pytest.mark.parametrize("module", [en, en2, cn, cn2], ids=["en", "en2", "cn", "cn2"])
def test_txt_to_md_preserves_utf8_content_and_paragraphs(module, tmp_path: Path):
    source = tmp_path / "source.txt"
    target = tmp_path / "target.md"
    content = "# 标题\n\nFirst paragraph.\n第二段。\n"
    source.write_text(content, encoding="utf-8")

    module.txt_to_md(source, target, tmp_path / "unused-video.mp4")

    assert target.read_text(encoding="utf-8") == content


@pytest.mark.parametrize("module", [en, en2], ids=["en", "en2"])
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
def test_ensure_proper_case_common_and_edge_cases(module, source, expected):
    assert module.ensure_proper_case(source) == expected


@pytest.mark.parametrize("module", [cn, cn2], ids=["cn", "cn2"])
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
def test_ensure_chinese_punctuation_common_and_edge_cases(module, source, expected):
    assert module.ensure_chinese_punctuation(source) == expected


@pytest.mark.parametrize("function", [en2.clean_repetition, cn2.clean_repetition])
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
def test_clean_repetition_only_removes_consecutive_duplicates(function, source, expected):
    assert function(source) == expected


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
    assert cn2.clean_inner_repetition(source) == expected
