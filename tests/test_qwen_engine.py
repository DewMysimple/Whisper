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
