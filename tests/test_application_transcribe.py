"""Contracts for the unified transcription application service."""

from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

import pytest

from whisper_subtitle.application.transcribe import TranscriptionService
from whisper_subtitle.domain.contracts import TranscriptionRequest
from whisper_subtitle.domain.mixed_language import LanguageDetectionRegion
from whisper_subtitle.domain.presets import derive_preset, get_preset_by_id
from whisper_subtitle.infrastructure.output_store import OutputPlan


class FakeEngine:
    def __init__(self, failures=()):
        self.failures = set(failures)
        self.calls = []

    def transcribe(self, media_path, **options):
        path = Path(media_path)
        self.calls.append((path, options))
        if path.name in self.failures:
            raise ValueError(f"cannot decode {path.name}")
        segments = [
            SimpleNamespace(text=f"{path.stem} transcript.", start=0.0, end=1.0)
        ]
        info = SimpleNamespace(language="en", language_probability=0.99, duration=1.0)
        return iter(segments), info


class FakeMixedEngine(FakeEngine):
    def detect_language_regions(
        self,
        _media_path,
        *,
        max_speech_duration_s,
        min_silence_duration_ms,
        speech_pad_ms=200,
        cancelled=None,
    ):
        assert max_speech_duration_s == 8
        assert min_silence_duration_ms == 300
        assert speech_pad_ms == 200
        assert cancelled is not None
        return [
            LanguageDetectionRegion(0, 3, "zh", 0.94, 0.03, 0.94),
            LanguageDetectionRegion(3, 5, "en", 0.92, 0.92, 0.04),
            LanguageDetectionRegion(5, 8, "zh", 0.96, 0.02, 0.96),
        ]

    def transcribe(self, media_path, **options):
        self.calls.append((Path(media_path), options))
        if "clip_timestamps" in options:
            segments = [
                SimpleNamespace(
                    text="I'm free.",
                    start=3.0,
                    end=5.0,
                    words=[
                        SimpleNamespace(word=" I'm", start=3.0, end=4.0, probability=0.95),
                        SimpleNamespace(word=" free.", start=4.0, end=5.0, probability=0.95),
                    ],
                    temperature=0.0,
                    avg_logprob=-0.2,
                    compression_ratio=1.1,
                    no_speech_prob=0.01,
                )
            ]
            return iter(segments), SimpleNamespace(
                language="en",
                language_probability=0.98,
                duration=8.0,
            )
        segments = [
            SimpleNamespace(
                text="中文前文",
                start=0.0,
                end=3.0,
                words=[
                    SimpleNamespace(word="中文前文", start=0.0, end=3.0, probability=0.95)
                ],
            ),
            SimpleNamespace(
                text="错误中文",
                start=3.0,
                end=5.0,
                words=[
                    SimpleNamespace(word="错误中文", start=3.0, end=5.0, probability=0.95)
                ],
            ),
            SimpleNamespace(
                text="中文后文",
                start=5.0,
                end=8.0,
                words=[
                    SimpleNamespace(word="中文后文", start=5.0, end=8.0, probability=0.95)
                ],
            ),
        ]
        return iter(segments), SimpleNamespace(
            language="zh",
            language_probability=0.95,
            duration=8.0,
        )


class FakeDetailEngine(FakeEngine):
    def detect_language_regions(
        self,
        _media_path,
        *,
        max_speech_duration_s,
        min_silence_duration_ms,
        speech_pad_ms=200,
        cancelled=None,
    ):
        assert max_speech_duration_s == 8
        assert min_silence_duration_ms == 300
        assert speech_pad_ms == 400
        assert cancelled is not None
        return [LanguageDetectionRegion(0, 4, "zh", 0.97, 0.01, 0.97)]

    def transcribe(self, media_path, **options):
        self.calls.append((Path(media_path), options))
        candidate = "clip_timestamps" in options
        text = "一种叫做拟态的自我" if candidate else "一种叫做你太的自我"
        probability = 0.92 if candidate else 0.7
        avg_logprob = -0.12 if candidate else -0.4
        segments = [
            SimpleNamespace(
                text=text,
                start=0.0,
                end=4.0,
                words=[
                    SimpleNamespace(
                        word=text,
                        start=0.0,
                        end=4.0,
                        probability=probability,
                    )
                ],
                temperature=0.0,
                avg_logprob=avg_logprob,
                compression_ratio=1.1,
                no_speech_prob=0.01,
            )
        ]
        return iter(segments), SimpleNamespace(
            language="zh",
            language_probability=0.98,
            duration=4.0,
        )


def make_media(directory: Path, *names: str) -> list[Path]:
    paths = []
    for name in names:
        path = directory / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"fixture")
        paths.append(path)
    return paths


def fail_if_called(*_args, **_kwargs):
    pytest.fail("injected engines must bypass runtime initialization")


def injected_service(events):
    return TranscriptionService(
        progress=events.append,
        runtime_configurer=fail_if_called,
        hardware_detector=fail_if_called,
        engine_loader=fail_if_called,
    )


def test_single_file_uses_exact_preset_params_and_writes_expected_text(
    tmp_path, capsys
):
    media = make_media(tmp_path, "lecture.wav")[0]
    engine = FakeEngine()
    events = []
    request = TranscriptionRequest(media, "en_v1")

    result = injected_service(events).run(request, engine=engine)

    expected_params = get_preset_by_id("en_v1").transcription_options()
    assert engine.calls == [(media, expected_params)]
    assert result.outcome == "success"
    assert result.exit_code == 0
    assert result.results[0].output_path == tmp_path / "Text" / "lecture.txt"
    assert result.results[0].output_path.read_text(encoding="utf-8") == (
        "Lecture transcript.\n"
    )
    assert {event.stage for event in events} >= {
        "media_discovered",
        "file_started",
        "language_detected",
        "segment_progress",
        "segments_collected",
        "sentences_merged",
        "output_written",
        "batch_completed",
    }
    internal = next(event for event in events if event.stage == "segment_progress")
    assert internal.media_progress_percent == 100
    assert internal.media_status == "running"
    completed = next(event for event in events if event.stage == "output_written")
    assert completed.media_progress_percent == 100
    assert completed.media_status == "completed"
    assert completed.output_paths == (tmp_path / "Text" / "lecture.txt",)
    assert capsys.readouterr().out == ""


def test_translation_guidance_and_repetition_controls_reach_engine_unchanged(tmp_path):
    media = make_media(tmp_path, "guided.wav")[0]
    engine = FakeEngine()
    preset = derive_preset(
        "en_v2",
        {
            "task": "translate",
            "initial_prompt": "  CTranslate2\r\nWebView2  ",
            "hotwords": "WhisperSubtitle\nLarge V3",
            "repetition_penalty": 1.15,
            "no_repeat_ngram_size": 3,
            "prompt_reset_on_temperature": 0.7,
            "temperature": 0.0,
        },
        model_id="large-v3",
    )

    result = injected_service([]).transcribe_file(
        TranscriptionRequest(media, "en_v2"),
        engine,
        preset=preset,
    )

    assert result.success
    options = engine.calls[0][1]
    assert options["task"] == "translate"
    assert options["initial_prompt"] == "CTranslate2\nWebView2"
    assert options["hotwords"] == "WhisperSubtitle\nLarge V3"
    assert options["repetition_penalty"] == 1.15
    assert options["no_repeat_ngram_size"] == 3
    assert options["prompt_reset_on_temperature"] == 0.7
    assert options["temperature"] == 0.0


def test_mixed_strategy_replaces_only_safe_english_region_and_reports_progress(tmp_path):
    media = make_media(tmp_path, "mixed.wav")[0]
    engine = FakeMixedEngine()
    events = []

    result = injected_service(events).transcribe_file(
        TranscriptionRequest(
            media,
            "cn2",
            recognition_strategy="mixed_zh_en",
        ),
        engine,
        model_id="large-v3",
    )

    assert result.success
    output = result.output_path.read_text(encoding="utf-8")
    assert "I'm free." in output
    assert "错误中文" not in output
    assert engine.calls[1][1]["language"] == "en"
    assert engine.calls[1][1]["task"] == "transcribe"
    assert engine.calls[1][1]["condition_on_previous_text"] is False
    progress = [
        event.media_progress_percent
        for event in events
        if event.media_progress_percent is not None
    ]
    assert progress == sorted(progress)
    diagnostics = next(
        event.quality_diagnostics
        for event in events
        if event.stage == "segments_collected"
    )
    assert diagnostics["recognition_strategy"] == "mixed_zh_en"
    assert diagnostics["replaced_region_count"] == 1


def test_mixed_strategy_srt_and_companion_txt_share_the_same_monotonic_timeline(tmp_path):
    media = make_media(tmp_path, "mixed-subtitle.wav")[0]
    engine = FakeMixedEngine()
    srt = tmp_path / "out" / "mixed-subtitle.srt"
    companion = tmp_path / "out" / "mixed-subtitle.txt"

    result = injected_service([]).transcribe_file(
        TranscriptionRequest(media, "cn2", recognition_strategy="mixed_zh_en"),
        engine,
        output_plan=OutputPlan(
            primary_txt=None,
            primary_srt=srt,
            primary_srt_txt=companion,
        ),
        model_id="large-v3-turbo",
    )

    assert result.success
    assert srt.read_bytes() == companion.read_bytes()
    content = srt.read_text(encoding="utf-8")
    assert "I'm free" in content
    assert content.index("00:00:00") < content.index("00:00:03") < content.index("00:00:05")


def test_chinese_detail_strategy_adopts_only_reliable_local_candidate(tmp_path):
    media = make_media(tmp_path, "detail.wav")[0]
    engine = FakeDetailEngine()
    events = []
    preset = derive_preset(
        "cn2",
        {"hotwords": "拟态\n李普曼"},
        model_id="large-v3",
    )

    result = injected_service(events).transcribe_file(
        TranscriptionRequest(media, "cn2", recognition_strategy="zh_detail_review"),
        engine,
        preset=preset,
        model_id="large-v3",
    )

    assert result.success
    assert "拟态" in result.output_path.read_text(encoding="utf-8")
    assert "你太" not in result.output_path.read_text(encoding="utf-8")
    scoring_options = engine.calls[1][1]
    assert scoring_options["word_timestamps"] is True
    assert "clip_timestamps" not in scoring_options
    candidate_options = engine.calls[2][1]
    assert candidate_options["language"] == "zh"
    assert candidate_options["condition_on_previous_text"] is True
    assert candidate_options["hotwords"] == "拟态\n李普曼"
    assert candidate_options["clip_timestamps"] == [0.0, 4.4]
    progress = [
        event.media_progress_percent
        for event in events
        if event.media_progress_percent is not None
    ]
    assert progress == sorted(progress)
    diagnostics = next(
        event.quality_diagnostics
        for event in events
        if event.stage == "segments_collected"
    )
    assert diagnostics["recognition_strategy"] == "zh_detail_review"
    assert diagnostics["replaced_region_count"] == 1
    assert diagnostics["review_region_count"] == 0
    assert diagnostics["detail_candidates"][0]["recovered_hotwords"] == ("拟态",)


def test_partial_failure_is_structured_and_batch_continues_in_sorted_order(tmp_path):
    media = make_media(tmp_path, "z-last.wav", "a-first.wav", "m-middle.wav")
    engine = FakeEngine(failures={"m-middle.wav"})
    events = []

    result = injected_service(events).run(
        TranscriptionRequest(tmp_path, "en_v1"), engine=engine
    )

    assert [path.name for path, _params in engine.calls] == [
        "a-first.wav",
        "m-middle.wav",
        "z-last.wav",
    ]
    assert [item.input_path.name for item in result.results] == [
        "a-first.wav",
        "m-middle.wav",
        "z-last.wav",
    ]
    assert [item.success for item in result.results] == [True, False, True]
    assert result.results[1].error == "cannot decode m-middle.wav"
    assert result.outcome == "partial_failure"
    assert result.exit_code == 1
    failed_events = [event for event in events if event.stage == "file_failed"]
    assert [event.input_path.name for event in failed_events] == ["m-middle.wav"]
    assert failed_events[0].media_status == "failed"
    assert all(path in media for path, _params in engine.calls)


def test_all_file_failures_have_failure_outcome_and_legacy_exit_code(tmp_path):
    make_media(tmp_path, "a.wav", "b.wav")
    engine = FakeEngine(failures={"a.wav", "b.wav"})

    result = injected_service([]).run(
        TranscriptionRequest(tmp_path, "cn"), engine=engine
    )

    assert result.outcome == "failure"
    assert result.success_count == 0
    assert result.failure_count == 2
    assert result.exit_code == 1


def test_invalid_input_fails_before_runtime_or_model_loading(tmp_path):
    events = []
    service = TranscriptionService(
        progress=events.append,
        runtime_configurer=fail_if_called,
        hardware_detector=fail_if_called,
        engine_loader=fail_if_called,
    )
    request = TranscriptionRequest(tmp_path / "missing.wav", "en_v1")

    result = service.run(request)

    assert result.outcome == "failure"
    assert result.exit_code == 1
    assert "输入路径不存在" in result.results[0].error
    assert [event.stage for event in events] == ["input_invalid"]


def test_default_engine_initialization_is_explicit_and_injected(tmp_path):
    media = make_media(tmp_path, "media.wav")[0]
    events = []
    location = SimpleNamespace(hub=Path("models/huggingface/hub"))
    hardware = SimpleNamespace(
        cuda_available=True,
        gpu_name="Test GPU",
        cuda_version="12.8",
    )
    engine = FakeEngine()
    calls = []

    def configure():
        calls.append("runtime")
        return location

    def detect():
        calls.append("hardware")
        return hardware

    def load(observed_hardware, observed_location):
        calls.append((observed_hardware, observed_location))
        return engine

    service = TranscriptionService(
        progress=events.append,
        runtime_configurer=configure,
        hardware_detector=detect,
        engine_loader=load,
    )

    result = service.run(TranscriptionRequest(media, "en_v1"))

    assert result.success
    assert calls == ["runtime", "hardware", (hardware, location)]
    assert [event.stage for event in events if event.stage.startswith("model_")] == [
        "model_loading",
        "model_loaded",
    ]
    assert any(event.stage == "hardware_detected" for event in events)


def test_explicit_output_directory_error_is_not_converted_to_file_failure(
    tmp_path, monkeypatch
):
    media = make_media(tmp_path, "media.wav")[0]
    blocked = tmp_path / "blocked"
    original_mkdir = Path.mkdir

    def guarded_mkdir(path, *args, **kwargs):
        if path == blocked:
            raise PermissionError("output directory denied")
        return original_mkdir(path, *args, **kwargs)

    monkeypatch.setattr(Path, "mkdir", guarded_mkdir)

    with pytest.raises(PermissionError, match="output directory denied"):
        injected_service([]).run(
            TranscriptionRequest(media, "en_v1", blocked),
            engine=FakeEngine(),
        )
