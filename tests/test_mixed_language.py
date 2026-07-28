from types import SimpleNamespace

from whisper_subtitle.domain.mixed_language import (
    EnglishCandidateRegion,
    LanguageDetectionRegion,
    candidate_rejection_reason,
    hotword_audit,
    latin_hotwords,
    select_english_candidate_regions,
    splice_candidate_segments,
)
from whisper_subtitle.domain.quality import build_recognition_quality_diagnostics


def segment(text: str, start: float, end: float, **overrides):
    values = {
        "text": text,
        "start": start,
        "end": end,
        "temperature": 0.0,
        "avg_logprob": -0.2,
        "compression_ratio": 1.1,
        "no_speech_prob": 0.01,
    }
    values.update(overrides)
    return SimpleNamespace(**values)

def word(text: str, start: float, end: float):
    return SimpleNamespace(word=text, start=start, end=end, probability=0.95)


def detection(start, end, english, chinese, language="en"):
    return LanguageDetectionRegion(
        start=start,
        end=end,
        top_language=language,
        top_probability=max(english, chinese),
        english_probability=english,
        chinese_probability=chinese,
    )


def test_selects_strong_english_and_adjacent_weak_continuation():
    regions = (
        detection(0, 2, 0.05, 0.92, "zh"),
        detection(3, 5, 0.81, 0.12),
        detection(5.2, 7, 0.63, 0.25),
        detection(9, 11, 0.62, 0.3),
    )

    selected = select_english_candidate_regions(regions, model_id="large-v3")

    assert selected == (
        EnglishCandidateRegion(
            start=3,
            end=7,
            english_probability=0.81,
            chinese_probability=0.25,
            detection_count=2,
        ),
    )

def test_candidate_regions_never_chain_beyond_the_short_block_limit():
    regions = tuple(
        detection(index * 4, index * 4 + 4, 0.9, 0.04)
        for index in range(5)
    )

    selected = select_english_candidate_regions(regions, model_id="large-v3-turbo")

    assert [(item.start, item.end) for item in selected] == [(0, 12), (12, 20)]


def test_candidate_requires_safe_timeline_and_rejects_high_compression():
    primary = [
        segment("中文前文", 0, 3),
        segment("错误中文", 3, 5),
        segment("中文后文", 5, 8),
    ]
    region = EnglishCandidateRegion(3, 5, 0.9, 0.05, 1)
    candidate = [segment("I'm free.", 3, 5)]
    info = SimpleNamespace(language="en", language_probability=0.95)
    safe = build_recognition_quality_diagnostics(
        candidate,
        info,
        {"log_prob_threshold": -1.0, "compression_ratio_threshold": 2.0},
    )

    assert candidate_rejection_reason(primary, candidate, region, safe) is None
    assert [item.text for item in splice_candidate_segments(primary, [(region, candidate)])] == [
        "中文前文",
        "I'm free.",
        "中文后文",
    ]

    looping = [segment("repeat repeat repeat", 3, 5, compression_ratio=4.0)]
    unsafe = build_recognition_quality_diagnostics(
        looping,
        info,
        {"log_prob_threshold": -1.0, "compression_ratio_threshold": 2.0},
    )
    assert (
        candidate_rejection_reason(primary, looping, region, unsafe)
        == "unsafe_quality"
    )
    low_confidence = [segment("two words", 3, 5, avg_logprob=-0.8)]
    assert (
        candidate_rejection_reason(primary, low_confidence, region, safe)
        == "low_candidate_confidence"
    )
    implausibly_dense = [segment("one two three four five six seven eight nine ten", 3, 5)]
    assert (
        candidate_rejection_reason(primary, implausibly_dense, region, safe)
        == "implausible_speech_rate"
    )

def test_word_timed_splice_preserves_primary_text_outside_the_english_region():
    primary = [
        segment(
            "中文 Baby 错误中文 后文",
            0,
            6,
            words=[
                word("中文 ", 0, 1),
                word("Baby ", 1, 2),
                word("错误中文 ", 2, 4),
                word("后文", 4, 6),
            ],
        )
    ]
    region = EnglishCandidateRegion(1, 4, 0.95, 0.02, 1)
    candidate = [
        segment(
            " Baby, I'm free. ",
            1,
            4,
            words=[
                word(" Baby,", 1, 2),
                word(" I'm", 2, 3),
                word(" free.", 3, 4),
            ],
        )
    ]
    info = SimpleNamespace(language="en", language_probability=0.95)
    quality = build_recognition_quality_diagnostics(candidate, info, {})

    assert candidate_rejection_reason(primary, candidate, region, quality) is None
    merged = splice_candidate_segments(primary, [(region, candidate)])
    assert "".join(item.text for item in merged) == "中文  Baby, I'm free.后文"
    assert [item.start for item in merged] == sorted(item.start for item in merged)


def test_hotword_helpers_filter_latin_terms_and_audit_without_rewriting():
    value = "拟态\nWalter Lippmann，simulacra-self;奖学金"

    assert latin_hotwords(value) == "Walter Lippmann\nsimulacra-self"
    assert hotword_audit(value, "拟 态的自我与 Walter\nLippmann") == {
        "term_count": 4,
        "matched_count": 2,
        "missing_count": 2,
        "matched_terms": ["拟态", "Walter Lippmann"],
        "missing_terms": ["simulacra-self", "奖学金"],
        "omitted_term_count": 0,
    }
