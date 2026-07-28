from types import SimpleNamespace

from whisper_subtitle.domain.detail_review import (
    DetailCandidateRegion,
    candidate_prompt,
    evaluate_detail_candidate,
    prior_context,
    replacement_preserves_protected_content,
    select_chinese_detail_regions,
    splice_detail_candidates,
    stable_splice_boundary_is_safe,
)
from whisper_subtitle.domain.mixed_language import LanguageDetectionRegion
from whisper_subtitle.domain.quality import build_recognition_quality_diagnostics


def word(text, start, end, probability):
    return SimpleNamespace(
        word=text,
        start=start,
        end=end,
        probability=probability,
    )


def segment(
    text,
    start,
    end,
    *,
    probability=0.8,
    avg_logprob=-0.3,
    compression_ratio=1.1,
    no_speech_prob=0.01,
):
    return SimpleNamespace(
        text=text,
        start=start,
        end=end,
        words=[word(text, start, end, probability)],
        temperature=0.0,
        avg_logprob=avg_logprob,
        compression_ratio=compression_ratio,
        no_speech_prob=no_speech_prob,
    )


def diagnostics(segments):
    return build_recognition_quality_diagnostics(
        segments,
        SimpleNamespace(language="zh", language_probability=0.98),
        {
            "log_prob_threshold": -1.0,
            "compression_ratio_threshold": 2.0,
            "no_speech_threshold": 0.6,
        },
    )


def test_selects_only_confident_chinese_vad_regions():
    detections = [
        LanguageDetectionRegion(0, 4, "zh", 0.94, 0.02, 0.94),
        LanguageDetectionRegion(4, 7, "en", 0.91, 0.91, 0.03),
        LanguageDetectionRegion(7, 9, "zh", 0.45, 0.12, 0.45),
    ]

    assert select_chinese_detail_regions(detections) == (
        DetailCandidateRegion(0, 4, 0.94),
    )


def test_context_excludes_the_active_region_and_keeps_only_the_tail():
    primary = [
        segment("较早的内容", 0, 2),
        segment("传媒学讨论", 2, 4),
        segment("你太的自我", 4, 6),
    ]

    assert prior_context(primary, 4, limit=5) == "传媒学讨论"
    assert candidate_prompt(" 专业访谈 ", "传媒学讨论") == "专业访谈\n传媒学讨论"


def test_reliable_hotword_recovery_is_replaced_and_spliced():
    primary = [
        segment(
            "一种叫做你太的自我",
            0,
            4,
            probability=0.72,
            avg_logprob=-0.35,
        )
    ]
    candidate = [
        segment(
            "一种叫做拟态的自我",
            0,
            4,
            probability=0.91,
            avg_logprob=-0.15,
        )
    ]
    region = DetailCandidateRegion(0, 4, 0.97)

    decision, trimmed = evaluate_detail_candidate(
        primary,
        candidate,
        region,
        diagnostics(candidate),
        "拟态\n李普曼",
    )

    assert decision.decision == "replaced"
    assert decision.recovered_hotwords == ("拟态",)
    merged = splice_detail_candidates(primary, [(region, trimmed)])
    assert "".join(item.text for item in merged) == "一种叫做拟态的自我"


def test_different_candidate_without_probability_gain_is_review_only():
    primary = [segment("掌心拿到陆续", 0, 3, probability=0.88, avg_logprob=-0.2)]
    candidate = [segment("侥幸拿到录取", 0, 3, probability=0.86, avg_logprob=-0.21)]

    decision, _trimmed = evaluate_detail_candidate(
        primary,
        candidate,
        DetailCandidateRegion(0, 3, 0.96),
        diagnostics(candidate),
        None,
    )

    assert decision.decision == "review"
    assert decision.reason == "insufficient_probability_gain"


def test_candidate_that_changes_protected_content_never_auto_replaces():
    primary = [segment("版本V3需要2.0环境", 0, 4, probability=0.7, avg_logprob=-0.5)]
    candidate = [segment("版本V2需要环境", 0, 4, probability=0.95, avg_logprob=-0.1)]

    decision, _trimmed = evaluate_detail_candidate(
        primary,
        candidate,
        DetailCandidateRegion(0, 4, 0.97),
        diagnostics(candidate),
        None,
    )

    assert decision.decision == "review"
    assert decision.reason == "protected_content_changed"


def test_existing_correct_hotword_is_protected_from_candidate_deletion():
    primary = [segment("李普曼提出这个观点", 0, 4, probability=0.7, avg_logprob=-0.5)]
    candidate = [segment("有人提出这个观点", 0, 4, probability=0.95, avg_logprob=-0.1)]

    decision, _trimmed = evaluate_detail_candidate(
        primary,
        candidate,
        DetailCandidateRegion(0, 4, 0.97),
        diagnostics(candidate),
        "李普曼",
    )

    assert decision.decision == "review"
    assert decision.reason == "protected_content_changed"


def test_hotword_recovery_uses_the_term_probability_not_the_clip_average():
    primary = [segment("一种叫做你太环境", 0, 4, probability=0.8, avg_logprob=-0.3)]
    candidate = segment("一种叫做拟态环境", 0, 4, probability=0.9, avg_logprob=-0.3)
    candidate.words = [
        word("一种叫做", 0, 2, 0.99),
        word("拟态", 2, 3, 0.7),
        word("环境", 3, 4, 0.99),
    ]

    decision, _trimmed = evaluate_detail_candidate(
        primary,
        [candidate],
        DetailCandidateRegion(0, 4, 0.97),
        diagnostics([candidate]),
        "拟态",
    )

    assert decision.decision == "review"
    assert decision.reason == "insufficient_probability_gain"


def test_global_splice_guard_catches_hotword_loss_at_a_vad_boundary():
    primary = [
        segment("这里讨论拟态", 0, 2),
        segment("的自我与V3模型", 2, 4),
    ]
    tentative = [
        segment("这里讨论倪态", 0, 2),
        segment("的自我与V3模型", 2, 4),
    ]

    assert not replacement_preserves_protected_content(primary, tentative, "拟态")
    assert replacement_preserves_protected_content(primary, primary, "拟态")


def test_segment_only_primary_requires_full_containment_before_splicing():
    region = DetailCandidateRegion(2, 4, 0.97)
    crossing = [SimpleNamespace(text="跨越边界的稳定正文", start=0, end=6, words=[])]
    contained = [SimpleNamespace(text="边界内正文", start=2, end=4, words=[])]

    assert not stable_splice_boundary_is_safe(crossing, region)
    assert stable_splice_boundary_is_safe(contained, region)


def test_high_compression_and_unsafe_length_are_rejected():
    primary = [segment("正常的一段中文", 0, 4)]
    looping = [
        segment(
            "重复重复重复重复",
            0,
            4,
            probability=0.95,
            avg_logprob=-0.1,
            compression_ratio=4.0,
        )
    ]
    region = DetailCandidateRegion(0, 4, 0.96)

    decision, _trimmed = evaluate_detail_candidate(
        primary,
        looping,
        region,
        diagnostics(looping),
        None,
    )
    assert decision.decision == "rejected"
    assert decision.reason == "unsafe_quality"

    too_short = [segment("短", 0, 4, probability=0.99, avg_logprob=-0.01)]
    decision, _trimmed = evaluate_detail_candidate(
        primary,
        too_short,
        region,
        diagnostics(too_short),
        None,
    )
    assert decision.decision == "rejected"
    assert decision.reason == "unsafe_length_change"
