"""SRT formatting contracts built from real model segment timestamps."""

from __future__ import annotations

import importlib
from pathlib import Path
from types import SimpleNamespace

import pytest

from whisper_subtitle.application.transcribe import TranscriptionService
from whisper_subtitle.domain.contracts import TranscriptionRequest
from whisper_subtitle.domain.subtitles import (
    SubtitleOptions,
    build_srt_document,
    build_subtitle_cues,
    build_word_timed_subtitle_cues,
    format_srt_timestamp,
)
from whisper_subtitle.infrastructure.output_store import OutputPlan


def test_formats_standard_comma_timestamps_without_losing_hours():
    assert format_srt_timestamp(0) == "00:00:00,000"
    assert format_srt_timestamp(3661.234) == "01:01:01,234"


def test_default_layout_is_one_line_per_cue():
    assert SubtitleOptions().max_lines_per_cue == 1


def test_word_timed_cues_use_real_speech_boundaries_and_stay_single_line():
    segment = SimpleNamespace(
        words=[
            SimpleNamespace(word="In", start=0.62, end=0.78),
            SimpleNamespace(word="tern", start=0.78, end=0.96),
            SimpleNamespace(word="ational", start=0.96, end=1.22),
            SimpleNamespace(word=" Ph", start=1.30, end=1.48),
            SimpleNamespace(word="on", start=1.48, end=1.60),
            SimpleNamespace(word="etic", start=1.60, end=1.82),
        ]
    )

    cues = build_word_timed_subtitle_cues(
        [segment],
        "english_standard",
        SubtitleOptions(max_characters_per_line=18, max_lines_per_cue=1, cue_gap_ms=0),
    )

    assert [cue.lines for cue in cues] == [("International",), ("Phonetic",)]
    assert cues[0].start == pytest.approx(0.62)
    assert cues[0].end == pytest.approx(1.22)
    assert cues[1].start == pytest.approx(1.30)
    assert cues[1].end == pytest.approx(1.82)
    assert all(len(cue.lines) == 1 for cue in cues)


def test_word_timed_document_does_not_extend_past_the_last_spoken_word():
    segment = SimpleNamespace(
        words=[
            SimpleNamespace(word=" hello", start=1.25, end=1.70),
            SimpleNamespace(word=" world.", start=1.80, end=2.35),
        ]
    )

    document = build_srt_document(
        [{"start": 0.0, "end": 9.0, "text": "fallback timing"}],
        "english_standard",
        SubtitleOptions(max_characters_per_line=42, max_lines_per_cue=1),
        word_segments=[segment],
    )

    assert "00:00:01,250 --> 00:00:02,350" in document
    assert "00:00:09,000" not in document


def test_short_adjacent_sentences_merge_and_anti_hallucination_removes_duplicates():
    sentences = [
        {"start": 0.0, "end": 0.4, "text": "你好"},
        {"start": 0.45, "end": 1.0, "text": "世界"},
        {"start": 1.2, "end": 2.0, "text": "重复"},
        {"start": 2.1, "end": 3.0, "text": "重复"},
    ]

    cues = build_subtitle_cues(
        sentences,
        "chinese_anti_hallucination",
        SubtitleOptions(max_characters_per_line=18, cue_gap_ms=80),
    )

    assert cues[0].lines == ("你好。 世界。",)
    assert [cue.lines for cue in cues].count(("重复。",)) == 1
    assert all(current.start >= previous.end for previous, current in zip(cues, cues[1:]))


def test_long_english_sentence_respects_line_capacity_and_keeps_source_time_range():
    document = build_srt_document(
        [
            {
                "start": 2.0,
                "end": 10.0,
                "text": "one two three four five six seven eight nine ten eleven twelve.",
            }
        ],
        "english_standard",
        SubtitleOptions(max_characters_per_line=16, max_lines_per_cue=2),
    )

    assert "00:00:02,000 -->" in document
    assert "00:00:10,000" in document
    text_lines = [
        line
        for line in document.splitlines()
        if line and not line.isdigit() and " --> " not in line
    ]
    assert all(len(line) <= 16 for line in text_lines)


def test_english_word_wrapping_spills_into_another_cue_without_losing_text():
    source = "This is a sentence with several words"
    cues = build_subtitle_cues(
        [{"start": 0.0, "end": 4.0, "text": source}],
        "chinese_standard",
        SubtitleOptions(max_characters_per_line=18, max_lines_per_cue=2),
    )

    assert len(cues) == 2
    assert cues[0].lines == ("This is a", "sentence with")
    assert cues[1].lines == ("several words。",)
    assert " ".join(line for cue in cues for line in cue.lines) == f"{source}。"
    assert cues[0].start == 0.0
    assert cues[-1].end == 4.0
    assert all(len(cue.lines) <= 2 for cue in cues)
    assert all(len(line) <= 18 for cue in cues for line in cue.lines)


def test_single_long_token_is_hard_split_across_valid_cues_without_truncation():
    source = "supercalifragilisticexpialidocious0123456789"
    cues = build_subtitle_cues(
        [{"start": 1.0, "end": 6.0, "text": source}],
        "english_standard",
        SubtitleOptions(max_characters_per_line=12, max_lines_per_cue=2),
    )

    assert "".join(line for cue in cues for line in cue.lines) == f"{source.capitalize()}."
    assert cues[0].start == 1.0
    assert cues[-1].end == 6.0
    assert all(len(cue.lines) <= 2 for cue in cues)
    assert all(len(line) <= 12 for cue in cues for line in cue.lines)


def test_rejects_incoherent_subtitle_duration_options():
    with pytest.raises(ValueError, match="cannot exceed"):
        SubtitleOptions(min_cue_duration_ms=5000, max_cue_duration_ms=1000)


class _FakeEngine:
    def __init__(self):
        self.options = None

    def transcribe(self, _media_path, **options):
        self.options = options
        segments = [
            SimpleNamespace(text="hello world.", start=1.25, end=3.5),
        ]
        return iter(segments), SimpleNamespace(language="en", language_probability=1.0)


def test_application_writes_srt_without_using_transcript_layout(
    tmp_path: Path, monkeypatch
):
    media = tmp_path / "lesson.wav"
    media.write_bytes(b"fixture")
    destination = tmp_path / "SRT" / "lesson.srt"
    plan = OutputPlan(primary_txt=None, primary_srt=destination)
    service = TranscriptionService(progress=lambda _event: None)
    transcribe_module = importlib.import_module(
        "whisper_subtitle.application.transcribe"
    )
    monkeypatch.setattr(
        transcribe_module,
        "build_transcript_document",
        lambda *_args, **_kwargs: pytest.fail("SRT-only must bypass transcript layout"),
    )

    engine = _FakeEngine()
    result = service.transcribe_file(
        TranscriptionRequest(media, "en_v1"),
        engine,
        output_plan=plan,
        subtitle_options={
            "max_characters_per_line": 42,
            "max_lines_per_cue": 1,
            "min_cue_duration_ms": 800,
            "max_cue_duration_ms": 7000,
            "max_characters_per_second": 20,
            "cue_gap_ms": 80,
        },
    )

    assert result.success
    assert engine.options["word_timestamps"] is True
    assert result.output_path == destination
    assert destination.read_text(encoding="utf-8") == (
        "1\n00:00:01,250 --> 00:00:03,500\nHello world.\n"
    )
    assert not (tmp_path / "Text" / "lesson.txt").exists()
