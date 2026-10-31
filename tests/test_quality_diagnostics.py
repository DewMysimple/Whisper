from types import SimpleNamespace

from whisper_subtitle.domain.quality import build_recognition_quality_diagnostics
from whisper_subtitle.domain.models import DECODING_DIAGNOSTIC_MODEL_IDS, MODELS_BY_ID


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


def test_whisper_clean_assessment_preserves_real_zero_fallback():
    diagnostics = build_recognition_quality_diagnostics(
        [SimpleNamespace(start=0, end=1, text="hello", temperature=0.0,
                         avg_logprob=-0.2, compression_ratio=1.1, no_speech_prob=0.01)],
        SimpleNamespace(language="en", language_probability=0.99),
        {"log_prob_threshold": -1, "compression_ratio_threshold": 2, "no_speech_threshold": 0.6},
    )
    assert diagnostics["low_confidence_count"] == 0
    assert diagnostics["fallback_segment_count"] == 0
    assert diagnostics["max_temperature"] == 0


def test_qwen_v1_carrier_preserves_language_without_evaluating_whisper_metrics():
    for model_id in ("qwen3-asr-0.6b", "qwen3-asr-1.7b"):
        assert model_id not in DECODING_DIAGNOSTIC_MODEL_IDS
        assert not MODELS_BY_ID[model_id].decoding_diagnostics
        diagnostics = build_recognition_quality_diagnostics(
            [SimpleNamespace(start=0, end=1, text="hello", temperature=0.4,
                             avg_logprob=-2, compression_ratio=3, no_speech_prob=0.9)],
            SimpleNamespace(language="en", language_probability=None),
            {"log_prob_threshold": -1, "compression_ratio_threshold": 2, "no_speech_threshold": 0.6},
            model_id=model_id,
        )
        assert diagnostics["detected_language"] == "en"
        assert diagnostics["language_probability"] is None
        assert diagnostics["segment_count"] == 1
        assert diagnostics["segments"] == []
