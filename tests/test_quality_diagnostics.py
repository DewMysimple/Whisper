from types import SimpleNamespace

from whisper_subtitle.domain.quality import build_recognition_quality_diagnostics


def test_quality_diagnostics_flags_real_fallback_and_threshold_failures():
    segments = [
        SimpleNamespace(
            start=1.0,
            end=2.5,
            text=" clean segment ",
            temperature=0.0,
            avg_logprob=-0.3,
            compression_ratio=1.1,
            no_speech_prob=0.05,
        ),
        SimpleNamespace(
            start=3.0,
            end=4.5,
            text=" suspicious   segment ",
            temperature=0.4,
            avg_logprob=-1.2,
            compression_ratio=2.6,
            no_speech_prob=0.8,
        ),
    ]
    info = SimpleNamespace(language="zh", language_probability=0.87)

    diagnostics = build_recognition_quality_diagnostics(
        segments,
        info,
        {
            "log_prob_threshold": -1.0,
            "compression_ratio_threshold": 2.0,
            "no_speech_threshold": 0.6,
        },
    )

    assert diagnostics["detected_language"] == "zh"
    assert diagnostics["language_probability"] == 0.87
    assert diagnostics["segment_count"] == 2
    assert diagnostics["fallback_segment_count"] == 1
    assert diagnostics["max_temperature"] == 0.4
    assert diagnostics["low_confidence_count"] == 1
    assert diagnostics["segments"][0]["text"] == "suspicious segment"
    assert diagnostics["segments"][0]["reasons"] == [
        "fallback_temperature",
        "low_log_probability",
        "high_compression_ratio",
        "silence_conflict",
    ]


def test_quality_diagnostics_tolerates_legacy_segment_stubs():
    diagnostics = build_recognition_quality_diagnostics(
        [SimpleNamespace(start=0.0, end=1.0, text="hello")],
        SimpleNamespace(language="en", language_probability=0.99),
        {},
    )

    assert diagnostics["segment_count"] == 1
    assert diagnostics["low_confidence_count"] == 0
    assert diagnostics["segments"] == []
