"""Contracts for time-aware TXT and Markdown transcript layout."""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from whisper_subtitle.domain.transcript_layout import (
    HARD_LINE_UNITS,
    build_transcript_document,
    build_transcript_units,
    display_units,
)

BROKEN_APOSTROPHE_SENTINEL = ",\n        \"'\": "
CONTRACTIONS = (
    "don't",
    "couldn't",
    "doesn't",
    "can't",
    "won't",
    "it's",
    "I'm",
    "I'll",
    "you're",
    "we're",
    "John's",
    "don’t",
    "couldn’t",
)


def segment(text: str, start: float, end: float):
    return SimpleNamespace(text=text, start=start, end=end)


def test_strong_punctuation_splits_inside_segments_without_splitting_decimals():
    chinese = build_transcript_units(
        [segment("第一句。第二句！数值 1.5 正常？", 0.0, 2.0)], "zh"
    )
    english = build_transcript_units(
        [segment("Dr. Smith measured 1.5 volts. Next question? Yes!", 0.0, 2.0)],
        "en",
    )

    assert [unit.text for unit in chinese] == ["第一句。", "第二句！", "数值 1.5 正常？"]
    assert [unit.text for unit in english] == [
        "Dr. Smith measured 1.5 volts.",
        "Next question?",
        "Yes!",
    ]


def test_real_segment_pauses_create_lines_and_long_pause_marks_paragraph():
    units = build_transcript_units(
        [
            segment("第一部分", 0.0, 1.0),
            segment("第二部分", 1.8, 2.5),
            segment("第三部分", 4.3, 5.0),
        ],
        "zh",
    )

    assert [unit.text for unit in units] == ["第一部分", "第二部分", "第三部分"]
    assert [unit.paragraph_break_after for unit in units] == [False, True, False]


def test_language_aware_length_wraps_chinese_and_preserves_one_long_english_word():
    chinese = build_transcript_units(
        [segment("长" * 100, 0.0, 1.0)],
        "zh",
    )
    english_word = "x" * (HARD_LINE_UNITS + 1)
    english = build_transcript_units([segment(english_word, 0.0, 1.0)], "en")

    assert len(chinese) == 2
    assert all(display_units(unit.text) <= HARD_LINE_UNITS for unit in chinese)
    assert "".join(unit.text for unit in chinese) == "长" * 100
    assert [unit.text for unit in english] == [english_word]


def test_segment_boundaries_wrap_after_preferred_length():
    phrase = "这是一个用于验证智能分行长度的中文语音片段"
    units = build_transcript_units(
        [
            segment(phrase, 0.0, 1.0),
            segment(phrase, 1.1, 2.0),
            segment(phrase, 2.1, 3.0),
        ],
        "zh",
    )

    assert len(units) >= 2
    assert all(display_units(unit.text) <= HARD_LINE_UNITS for unit in units)


def test_markdown_groups_three_sentences_and_honours_real_long_pauses():
    document = build_transcript_document(
        [
            segment("第一句。第二句。", 0.0, 1.0),
            segment("第三句。", 1.1, 1.5),
            segment("第四句。", 3.3, 4.0),
            segment("第五句。", 4.1, 4.5),
        ],
        "zh",
        "chinese_standard",
    )

    assert document.txt_content == "第一句。\n第二句。\n第三句。\n第四句。\n第五句。\n"
    assert document.markdown_content == "第一句。第二句。第三句。\n\n第四句。第五句。\n"
    assert "".join(document.txt_content.split()) == "".join(
        document.markdown_content.split()
    )


def test_anti_hallucination_keeps_timing_and_paragraph_after_removed_duplicates():
    document = build_transcript_document(
        [
            segment("谢谢观看。", 0.0, 0.5),
            segment("谢谢观看。", 0.6, 1.0),
            segment("谢谢观看。", 1.1, 1.5),
            segment("新的内容。", 3.3, 4.0),
        ],
        "zh",
        "chinese_anti_hallucination",
    )

    assert document.source_unit_count == 4
    assert [unit.text for unit in document.units] == ["谢谢观看。", "新的内容。"]
    assert document.units[0].end == 1.5
    assert document.units[0].paragraph_break_after is True
    assert document.markdown_content == "谢谢观看。\n\n新的内容。\n"


@pytest.mark.parametrize(
    ("language", "strategy_id"),
    [
        ("zh", "chinese_standard"),
        ("zh", "chinese_anti_hallucination"),
        ("en", "english_standard"),
        ("en", "english_anti_hallucination"),
    ],
)
def test_all_presets_preserve_ascii_and_curly_apostrophes_in_txt_and_markdown(
    language, strategy_id
):
    source = " ".join(CONTRACTIONS) + "."
    document = build_transcript_document(
        [segment(source, 0.0, 4.0)],
        language,
        strategy_id,
    )

    for rendered in (document.txt_content, document.markdown_content):
        assert BROKEN_APOSTROPHE_SENTINEL not in rendered
        folded = rendered.casefold()
        assert all(contraction.casefold() in folded for contraction in CONTRACTIONS)
