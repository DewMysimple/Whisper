"""Exercise Qwen orchestration and failure paths without model weights."""

from contextlib import nullcontext
from types import SimpleNamespace

import numpy as np
import pytest

from whisper_subtitle.domain.backend_parameters import qwen_defaults
from whisper_subtitle.domain.execution import HardwareInfo
from whisper_subtitle.domain.transcription import TranscriptionInfo
from whisper_subtitle.infrastructure.qwen_engine import QwenASREngine
from whisper_subtitle.infrastructure import torch_hardware
from whisper_subtitle.domain.transcription import TranscriptionCancelled


def test_torch_loader_initializes_shared_cuda_before_import(monkeypatch):
    calls = []
    monkeypatch.setattr(torch_hardware, "configure_cuda_runtime", lambda: calls.append("cuda"))
    def import_module(name):
        assert calls == ["cuda"]
        calls.append(name)
        return "torch-module"
    monkeypatch.setattr(torch_hardware.importlib, "import_module", import_module)
    assert torch_hardware.load_torch() == "torch-module"
    assert calls == ["cuda", "torch"]


class Inputs(dict):
    def to(self, *args):
        return self


def make_engine(*, generated=(11, 2), language="Chinese", cpu_threads=2):
    threads = SimpleNamespace(value=8)
    torch = SimpleNamespace(
        get_num_threads=lambda: threads.value,
        set_num_threads=lambda value: setattr(threads, "value", value),
        inference_mode=nullcontext,
    )
    processor = SimpleNamespace(
        apply_transcription_request=lambda **kw: Inputs(input_ids=np.array([[1, 3]])),
        decode=lambda *args, **kw: [{"transcription": " 你好。 ", "language": language}],
    )
    model = SimpleNamespace(
        device="cpu", dtype="float32",
        generation_config=SimpleNamespace(eos_token_id=2),
        generate=lambda **kw: np.array([[1, 3, *generated]]),
    )
    engine = QwenASREngine(
        model, processor, hardware=HardwareInfo("cpu", "float32", False, None, None, cpu_threads),
        location=None, model_name="qwen3-asr-0.6b", torch=torch, transformers=None,
    )
    return engine, threads


@pytest.mark.parametrize("eos", [2, [2, 3]])
def test_generation_at_budget_accepts_eos_and_resolves_language(eos):
    engine, _ = make_engine()
    engine._model.generation_config.eos_token_id = eos
    params = dict(qwen_defaults(), max_new_tokens=2)
    assert engine._recognize_chunk([], params, None) == ("你好。", "Chinese", "zh")


def test_generation_truncation_is_not_silently_accepted():
    engine, _ = make_engine(generated=(11, 12))
    with pytest.raises(ValueError, match="token"):
        engine._recognize_chunk([], dict(qwen_defaults(), max_new_tokens=2), None)


@pytest.mark.parametrize("failure", [None, "recognition", "alignment"])
def test_threads_are_restored_before_yield_or_failure(monkeypatch, failure):
    engine, threads = make_engine()
    monkeypatch.setattr("whisper_subtitle.infrastructure.qwen_engine.speech_windows",
                        lambda *args, **kw: iter([(32000, 64000)]))
    def recognize(*args):
        assert threads.value == 2
        if failure == "recognition":
            raise RuntimeError("recognition failed")
        return "你好。", "Chinese", "zh"
    def align(chunk, text, **kwargs):
        assert threads.value == 2
        assert kwargs == {"offset": 2.0, "duration": 2.0}
        if failure == "alignment":
            raise RuntimeError("alignment failed")
        return ()
    monkeypatch.setattr(engine, "_recognize_chunk", recognize)
    monkeypatch.setattr(engine, "_align_chunk", align)
    info = TranscriptionInfo(4)
    segments = engine._segments(np.zeros(64000), dict(qwen_defaults(), word_timestamps=True), info)
    if failure:
        with pytest.raises(RuntimeError, match=failure):
            next(segments)
    else:
        segment = next(segments)
        assert (segment.start, segment.end, segment.text) == (2, 4, "你好。")
        assert info.language == "zh"
        segments.close()
    assert threads.value == 8


def test_cancel_before_decode_and_between_windows(monkeypatch):
    import threading
    engine, threads = make_engine()
    cancelled = threading.Event()
    cancelled.set()
    monkeypatch.setattr("whisper_subtitle.infrastructure.qwen_engine.decode_media",
                        lambda _: pytest.fail("cancelled task decoded media"))
    with pytest.raises(TranscriptionCancelled):
        engine.transcribe_cancellable("unused.wav", cancelled=cancelled.is_set)
    cancelled.clear()
    monkeypatch.setattr("whisper_subtitle.infrastructure.qwen_engine.speech_windows",
                        lambda *args, **kw: [(0, 16000), (16000, 32000)])
    calls = []
    def recognize(*args, **kwargs):
        calls.append(1)
        return "你好", "Chinese", "zh"
    monkeypatch.setattr(engine, "_recognize_chunk", recognize)
    segments = engine._segments(np.zeros(32000), qwen_defaults(), TranscriptionInfo(2), cancelled=cancelled.is_set)
    assert next(segments).text == "你好"
    cancelled.set()
    with pytest.raises(TranscriptionCancelled):
        next(segments)
    assert calls == [1]
    assert threads.value == 8


@pytest.mark.parametrize("failure", ["cancel", "generate"])
def test_generation_stop_discards_partial_text_restores_threads_and_allows_reuse(monkeypatch, failure):
    import threading
    engine, threads = make_engine()
    engine._transformers = SimpleNamespace(StoppingCriteria=object, StoppingCriteriaList=list)
    engine._torch.bool = np.bool_
    engine._torch.full = lambda shape, value, **kwargs: np.full(shape, value, dtype=bool)
    cancelled = threading.Event()
    monkeypatch.setattr("whisper_subtitle.infrastructure.qwen_engine.speech_windows",
                        lambda *args, **kw: [(0, 16000), (16000, 32000)])
    original = engine._model.generate
    decoded = []
    engine._processor.decode = lambda *args, **kwargs: decoded.append(1) or [{"transcription": "完整", "language": "Chinese"}]
    def generate(**kwargs):
        criteria = kwargs["stopping_criteria"][0]
        ids = SimpleNamespace(shape=(1,), device="cpu")
        assert not criteria(ids, None).any()
        if failure == "generate":
            raise RuntimeError("generation error")
        cancelled.set()
        assert criteria(ids, None).all()
        return np.array([[1, 3, 11]])  # No EOS; must not be decoded or exported.
    for _ in range(3):
        cancelled.clear()
        engine._model.generate = generate
        iterator = engine._segments(np.zeros(32000), qwen_defaults(), TranscriptionInfo(2), cancelled=cancelled.is_set)
        with pytest.raises(TranscriptionCancelled if failure == "cancel" else RuntimeError):
            next(iterator)
        assert not decoded
        assert threads.value == 8
    cancelled.clear()
    engine._model.generate = original
    segments = list(engine._segments(np.zeros(32000), qwen_defaults(), TranscriptionInfo(2), cancelled=cancelled.is_set))
    assert [s.text for s in segments] == ["完整", "完整"]
    assert threads.value == 8


def retry_engine(monkeypatch, windows, generate):
    """Drive the real token-budget check with sample-addressed fake audio."""
    engine, threads = make_engine()
    monkeypatch.setattr("whisper_subtitle.infrastructure.qwen_engine.speech_windows",
                        lambda *args, **kwargs: windows)
    requests = []

    def prepare(*, audio, language, prompt):
        span = (int(audio[0]), int(audio[-1]) + 1)
        requests.append((span, language, prompt))
        return Inputs(input_ids=np.array([[1, 3]]), test_span=span)

    def generation(*, input_ids, test_span, max_new_tokens, **kwargs):
        assert threads.value == 2
        generated = generate(*test_span, max_new_tokens)
        return np.array([[*input_ids[0], *generated]])

    engine._processor.apply_transcription_request = prepare
    engine._model.generate = generation
    engine._processor.decode = lambda generated, **kwargs: [{
        "transcription": f"piece-{int(generated[0, 0]) - 10}", "language": "English",
    }]
    return engine, threads, requests


def test_token_retry_preserves_samples_order_offsets_alignment_and_prompt(monkeypatch):
    start, end = 32000, 160001  # Odd sample count, after leading VAD silence.
    midpoint = (start + end) // 2

    def generate(left, right, budget):
        return (7,) * budget if (left, right) == (start, end) else (left + 10, 2)

    engine, threads, requests = retry_engine(monkeypatch, [(start, end)], generate)
    aligned = []

    def align(chunk, text, *, offset, duration):
        from whisper_subtitle.domain.transcription import TranscribedWord
        aligned.append((chunk.copy(), offset, duration))
        return (TranscribedWord(offset, offset + duration, text),)

    monkeypatch.setattr(engine, "_align_chunk", align)
    info = TranscriptionInfo(end / 16000)
    params = dict(qwen_defaults(), max_new_tokens=3, word_timestamps=True,
                  initial_prompt="context", hotwords="Kojima")
    iterator = engine._segments(np.arange(end), params, info)
    first = next(iterator)
    assert threads.value == 8
    rest = list(iterator)
    segments = [first, *rest]
    assert [(s.start, s.end) for s in segments] == [
        (start / 16000, midpoint / 16000), (midpoint / 16000, end / 16000)]
    assert [s.text for s in segments] == [f"piece-{start}", f"piece-{midpoint}"]
    assert [span for span, language, prompt in requests] == [
        (start, end), (start, midpoint), (midpoint, end)]
    assert all(language is None and prompt == "context\nKojima" for _, language, prompt in requests)
    assert info.language == "en"
    assert [(offset, duration) for _, offset, duration in aligned] == [
        (s.start, s.end - s.start) for s in segments]
    np.testing.assert_array_equal(np.concatenate([chunk for chunk, _, _ in aligned]), np.arange(start, end))
    assert [(s.words[0].start, s.words[0].end) for s in segments] == [(s.start, s.end) for s in segments]
    assert threads.value == 8


def test_token_retry_recursively_splits_only_failed_children(monkeypatch):
    start, end = 16000, 272000
    midpoint, quarter = 144000, 80000
    saturated = {(start, end), (start, midpoint)}

    def generate(left, right, budget):
        return (7,) * budget if (left, right) in saturated else (left + 10, 2)

    engine, threads, requests = retry_engine(monkeypatch, [(start, end)], generate)
    segments = list(engine._segments(np.arange(end), dict(qwen_defaults(), max_new_tokens=3), TranscriptionInfo(17)))
    assert [span for span, _, _ in requests] == [
        (start, end), (start, midpoint), (start, quarter), (quarter, midpoint), (midpoint, end)]
    assert [(s.start, s.end) for s in segments] == [(1, 5), (5, 9), (9, 17)]
    assert [s.text for s in segments] == ["piece-16000", "piece-80000", "piece-144000"]
    assert threads.value == 8


@pytest.mark.parametrize("failure", [ValueError("ordinary error"), RuntimeError("CUDA error")])
def test_token_retry_does_not_retry_unrelated_errors(monkeypatch, failure):
    def generate(*args):
        raise failure

    engine, threads, requests = retry_engine(monkeypatch, [(0, 64000)], generate)
    with pytest.raises(type(failure), match=str(failure)):
        list(engine._segments(np.arange(64000), qwen_defaults(), TranscriptionInfo(4)))
    assert len(requests) == 1
    assert threads.value == 8


@pytest.mark.parametrize("sample_count", [1, 16000, 31999, 32000, 480000])
def test_token_retry_is_bounded_and_never_accepts_truncated_leaf(monkeypatch, sample_count):
    engine, threads, requests = retry_engine(monkeypatch, [(0, sample_count)],
                                           lambda left, right, budget: (7,) * budget)
    with pytest.raises(ValueError, match="token"):
        next(engine._segments(np.arange(sample_count), dict(qwen_defaults(), max_new_tokens=3),
                              TranscriptionInfo(sample_count / 16000)))
    # All attempts terminate within the 30s -> 15 -> 7.5 -> 3.75 -> 1.875s path.
    assert 1 <= len(requests) <= 6
    assert all(left < right for (left, right), _, _ in requests)
    assert len({span for span, _, _ in requests}) == len(requests)
    assert threads.value == 8


def test_token_retry_cancel_after_saturation_starts_no_child(monkeypatch):
    import threading
    cancelled = threading.Event()
    engine, threads = make_engine(generated=(11, 12, 13))
    original = engine._recognize_chunk
    attempts = []
    monkeypatch.setattr("whisper_subtitle.infrastructure.qwen_engine.speech_windows",
                        lambda *args, **kwargs: [(0, 64000)])

    def recognize(chunk, params, prompt, **kwargs):
        attempts.append(len(chunk))
        try:
            return original(chunk, params, prompt)
        finally:
            cancelled.set()

    monkeypatch.setattr(engine, "_recognize_chunk", recognize)
    with pytest.raises(TranscriptionCancelled):
        next(engine._segments(np.arange(64000), dict(qwen_defaults(), max_new_tokens=3),
                              TranscriptionInfo(4), cancelled=cancelled.is_set))
    assert attempts == [64000]
    assert threads.value == 8


def test_token_retry_cancel_between_children_does_not_process_right_child(monkeypatch):
    import threading
    cancelled = threading.Event()
    attempts = []
    engine, threads = make_engine()
    monkeypatch.setattr("whisper_subtitle.infrastructure.qwen_engine.speech_windows",
                        lambda *args, **kwargs: [(16000, 80000)])

    def recognize(chunk, params, prompt, **kwargs):
        from whisper_subtitle.infrastructure.qwen_engine import QwenTokenLimitError
        attempts.append((int(chunk[0]), int(chunk[-1]) + 1))
        if len(chunk) == 64000:
            raise QwenTokenLimitError("token limit")
        return "left", "English", "en"

    monkeypatch.setattr(engine, "_recognize_chunk", recognize)
    iterator = engine._segments(np.arange(80000), qwen_defaults(), TranscriptionInfo(5),
                                cancelled=cancelled.is_set)
    assert next(iterator).text == "left"
    assert threads.value == 8
    cancelled.set()
    with pytest.raises(TranscriptionCancelled):
        next(iterator)
    assert attempts == [(16000, 80000), (16000, 48000)]
    assert threads.value == 8


def test_eos_at_token_budget_produces_one_unsplit_segment(monkeypatch):
    engine, threads, requests = retry_engine(monkeypatch, [(16000, 80000)],
                                           lambda left, right, budget: (left + 10, 2))
    segments = list(engine._segments(np.arange(80000), dict(qwen_defaults(), max_new_tokens=2),
                                     TranscriptionInfo(5)))
    assert [(s.start, s.end, s.text) for s in segments] == [(1, 5, "piece-16000")]
    assert [span for span, _, _ in requests] == [(16000, 80000)]
    assert threads.value == 8


def test_invalid_alignment_retries_real_children_and_uses_successful_leaf_language(monkeypatch):
    from whisper_subtitle.domain.alignment import aligned_words
    engine, threads = make_engine()
    start, midpoint, end = 32000, 64000, 96000
    monkeypatch.setattr("whisper_subtitle.infrastructure.qwen_engine.speech_windows",
                        lambda *args, **kwargs: [(start, end)])
    recognized, aligned = [], []

    def recognize(chunk, params, prompt, **kwargs):
        span = (int(chunk[0]), int(chunk[-1]) + 1)
        recognized.append(span)
        if span == (start, end):
            return "parent", "Japanese", "ja"
        return "left" if span[0] == start else "right", "English", "en"

    def align(chunk, text, *, offset, duration):
        aligned.append((int(chunk[0]), int(chunk[-1]) + 1, text))
        # Run the production validator; the full window's measured stamp is invalid.
        word_start = duration + 1 if text == "parent" else 0.25
        return aligned_words(text, [{"text": text, "start_time": word_start,
                                     "end_time": word_start + 0.5}],
                             offset=offset, duration=duration)

    monkeypatch.setattr(engine, "_recognize_chunk", recognize)
    monkeypatch.setattr(engine, "_align_chunk", align)
    info = TranscriptionInfo(6)
    segments = list(engine._segments(np.arange(end), dict(qwen_defaults(), word_timestamps=True), info))
    assert recognized == [(start, end), (start, midpoint), (midpoint, end)]
    assert aligned == [(start, end, "parent"), (start, midpoint, "left"), (midpoint, end, "right")]
    assert [(s.start, s.end, s.text) for s in segments] == [(2, 4, "left"), (4, 6, "right")]
    assert [(s.words[0].start, s.words[0].end) for s in segments] == [(2.25, 2.75), (4.25, 4.75)]
    assert info.language == "en"
    assert threads.value == 8


def test_token_then_alignment_failures_share_the_same_retry_depth(monkeypatch):
    from whisper_subtitle.domain.alignment import AlignmentError
    import whisper_subtitle.infrastructure.qwen_engine as qwen_engine
    engine, threads = make_engine()
    # One permitted split: alignment failure in a token-retry child must not reset it.
    monkeypatch.setattr(qwen_engine, "_MAX_WINDOW_RETRY_DEPTH", 1)
    monkeypatch.setattr(qwen_engine, "speech_windows", lambda *args, **kwargs: [(0, 128000)])
    recognized, aligned = [], []

    def recognize(chunk, params, prompt, **kwargs):
        recognized.append((int(chunk[0]), int(chunk[-1]) + 1))
        if len(chunk) == 128000:
            raise qwen_engine.QwenTokenLimitError("token limit")
        return "child", "English", "en"

    def align(chunk, text, **kwargs):
        aligned.append(len(chunk))
        raise AlignmentError("invalid measured alignment")

    monkeypatch.setattr(engine, "_recognize_chunk", recognize)
    monkeypatch.setattr(engine, "_align_chunk", align)
    info = TranscriptionInfo(8)
    with pytest.raises(AlignmentError, match="下限"):
        next(engine._segments(np.arange(128000), dict(qwen_defaults(), word_timestamps=True), info))
    assert recognized == [(0, 128000), (0, 64000)]
    assert aligned == [64000]
    assert info.language is None
    assert threads.value == 8


@pytest.mark.parametrize("failure", [ValueError("ordinary alignment error"), RuntimeError("CUDA alignment error")])
def test_alignment_retry_does_not_swallow_unrelated_errors(monkeypatch, failure):
    engine, threads = make_engine()
    monkeypatch.setattr("whisper_subtitle.infrastructure.qwen_engine.speech_windows",
                        lambda *args, **kwargs: [(0, 64000)])
    aligned = []

    def align(chunk, text, **kwargs):
        aligned.append(len(chunk))
        raise failure

    monkeypatch.setattr(engine, "_align_chunk", align)
    with pytest.raises(type(failure), match=str(failure)):
        next(engine._segments(np.arange(64000), dict(qwen_defaults(), word_timestamps=True), TranscriptionInfo(4)))
    assert aligned == [64000]
    assert threads.value == 8


def test_persistently_invalid_alignment_is_bounded_and_not_replaced_by_fake_words(monkeypatch):
    from whisper_subtitle.domain.alignment import AlignmentError, aligned_words
    engine, threads = make_engine()
    monkeypatch.setattr("whisper_subtitle.infrastructure.qwen_engine.speech_windows",
                        lambda *args, **kwargs: [(0, 480000)])
    aligned = []

    def align(chunk, text, *, offset, duration):
        aligned.append((offset, duration))
        return aligned_words(text, [], offset=offset, duration=duration)

    monkeypatch.setattr(engine, "_align_chunk", align)
    info = TranscriptionInfo(30)
    with pytest.raises(AlignmentError, match="完整.*下限"):
        next(engine._segments(np.arange(480000), dict(qwen_defaults(), word_timestamps=True), info))
    assert 1 <= len(aligned) <= 6
    assert all(duration >= 1 for _, duration in aligned)
    assert info.language is None
    assert threads.value == 8


def test_cancel_after_invalid_alignment_starts_no_retry_child(monkeypatch):
    import threading
    from whisper_subtitle.domain.alignment import AlignmentError
    cancelled = threading.Event()
    engine, threads = make_engine()
    monkeypatch.setattr("whisper_subtitle.infrastructure.qwen_engine.speech_windows",
                        lambda *args, **kwargs: [(0, 64000)])
    monkeypatch.setattr(engine, "_recognize_chunk", lambda *args, **kwargs: ("hello", "English", "en"))
    aligned = []

    def align(chunk, text, **kwargs):
        aligned.append(len(chunk))
        cancelled.set()
        raise AlignmentError("invalid measured alignment")

    monkeypatch.setattr(engine, "_align_chunk", align)
    with pytest.raises(TranscriptionCancelled):
        next(engine._segments(np.arange(64000), dict(qwen_defaults(), word_timestamps=True),
                              TranscriptionInfo(4), cancelled=cancelled.is_set))
    assert aligned == [64000]
    assert threads.value == 8
