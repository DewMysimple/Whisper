"""Backend boundary regressions without downloads or inference dependencies."""

from __future__ import annotations

import json
import subprocess
import sys
from contextlib import nullcontext
from types import SimpleNamespace

import pytest

from whisper_subtitle.domain.alignment import aligned_words
from whisper_subtitle.domain.backend_parameters import QWEN_PARAMETER_NAMES
from whisper_subtitle.domain.models import ASSETS_BY_ID, DEFAULT_MODEL_ID, SUPPORTED_MODEL_IDS
from whisper_subtitle.domain.presets import derive_preset
from whisper_subtitle.infrastructure.audio_chunks import speech_windows
from whisper_subtitle.infrastructure.torch_hardware import TorchHardwareDetector
from whisper_subtitle.model_files import complete_model_directory
from whisper_subtitle.paths import AppPaths, ModelLocation, ModelNotFoundError
from whisper_subtitle.protocol import CommandMessage, CommandMethod, ProtocolValidationError
from whisper_subtitle.worker.model_cache import ModelCache


QWEN = "qwen3-asr-1.7b"
ALIGNER = "qwen3-forced-aligner-0.6b"


def write_model(path, model_id, *, sharded=False):
    path.mkdir(parents=True)
    for name in ASSETS_BY_ID[model_id].required_files:
        (path / name).write_text("{}", encoding="utf-8")
    (path / "config.json").write_text(json.dumps({"model_type": "qwen3_asr", "architectures": [ASSETS_BY_ID[model_id].config_architecture]}), encoding="utf-8")
    if sharded:
        (path / "model.safetensors.index.json").write_text(json.dumps({"weight_map": {"a": "part1.safetensors", "b": "part2.safetensors"}}))
        (path / "part1.safetensors").write_bytes(b"weights")
    else:
        (path / "model.safetensors").write_bytes(b"weights")


def test_companions_are_shared_and_never_selectable():
    assert DEFAULT_MODEL_ID == "large-v3-turbo"
    assert ALIGNER not in SUPPORTED_MODEL_IDS
    assert ASSETS_BY_ID[QWEN].companion_id == ASSETS_BY_ID["qwen3-asr-0.6b"].companion_id


def test_discovery_requires_complete_companion_and_all_weight_shards(tmp_path):
    location = ModelLocation(tmp_path, tmp_path / "hub")
    write_model(tmp_path / QWEN, QWEN, sharded=True)
    assert location.find_model(QWEN) is None
    (tmp_path / QWEN / "part2.safetensors").write_bytes(b"weights")
    assert location.find_model(QWEN) == tmp_path / QWEN
    assert QWEN not in location.available_models()
    with pytest.raises(ModelNotFoundError, match=ALIGNER):
        location.require_bundle(QWEN)
    write_model(tmp_path / ALIGNER, ALIGNER)
    assert location.require_bundle(QWEN) == tmp_path / QWEN
    assert QWEN in location.available_models()
    (tmp_path / QWEN / "processor_config.json").unlink()
    assert QWEN not in location.available_models()


def test_native_checkpoint_type_and_shard_paths_are_checked(tmp_path):
    write_model(tmp_path / QWEN, QWEN, sharded=True)
    (tmp_path / "outside.safetensors").write_bytes(b"weights")
    index = tmp_path / QWEN / "model.safetensors.index.json"
    index.write_text(json.dumps({"weight_map": {"a": "../outside.safetensors"}}))
    assert not complete_model_directory(tmp_path / QWEN, QWEN)
    (tmp_path / QWEN / "config.json").write_text('{"model_type":"qwen3_asr_thinker"}')
    assert not complete_model_directory(tmp_path / QWEN, QWEN)


def test_explicit_native_directory_resolves_shared_sibling_aligner(tmp_path):
    write_model(tmp_path / QWEN, QWEN)
    write_model(tmp_path / ALIGNER, ALIGNER)
    location = AppPaths.discover(explicit_model_dir=tmp_path / QWEN).model_location
    assert location.require_bundle(QWEN) == tmp_path / QWEN
    assert location.require_model(ALIGNER) == tmp_path / ALIGNER


@pytest.mark.parametrize("model_id", [QWEN, "qwen3-asr-0.6b"])
def test_qwen_parameters_do_not_inherit_whisper_decoding(model_id):
    preset = derive_preset("cn", {}, model_id=model_id)
    assert preset.params["language"] is None
    assert preset.params["initial_prompt"] is None
    assert "temperature" not in preset.params
    assert "beam_size" not in preset.params
    with pytest.raises(ValueError, match="不支持"):
        derive_preset("cn", {"beam_size": 5}, model_id=model_id)
    with pytest.raises(ValueError, match="不支持"):
        derive_preset("cn", {"language": "he"}, model_id=model_id)
    assert derive_preset("cn", {"hotwords": "术语"}, model_id=model_id).params["hotwords"] == "术语"


def test_alignment_preserves_punctuation_spaces_and_absolute_offsets():
    text = "你好，don't stop! Straße."
    tokens = ["你", "好", "dont", "stop", "Straße"]
    stamps = [{"text": word, "start_time": i, "end_time": i + .4} for i, word in enumerate(tokens)]
    words = aligned_words(text, stamps, offset=30, duration=6)
    assert "".join(word.word for word in words) == text
    assert words[0].start == 30
    assert words[-1].end == 34.4
    assert words[2].word == "don't"
    assert words[3].word == " stop!"


@pytest.mark.parametrize("stamps", [[], [{"text":"wrong", "start_time":0, "end_time":1}], [{"text":"hello", "start_time":float("nan"), "end_time":1}]])
def test_alignment_never_fabricates_timestamps(stamps):
    with pytest.raises(ValueError):
        aligned_words("hello", stamps, offset=0, duration=2)


def test_chunk_windows_are_bounded_and_preserve_silence_offsets(monkeypatch):
    vad = SimpleNamespace(
        VadOptions=lambda **options: options,
        get_speech_timestamps=lambda *a, **kw: [
            {"start": 32000, "end": 600000}, {"start": 640000, "end": 660000}],
    )
    monkeypatch.setitem(sys.modules, "faster_whisper.vad", vad)
    audio = [0] * 700000
    assert list(speech_windows(audio, chunk_length=30, vad_filter=True, vad_parameters={})) == [
        (32000, 512000), (512000, 600000), (640000, 660000)]
    assert list(speech_windows(audio, chunk_length=30, vad_filter=False, vad_parameters={})) == [(0,480000),(480000,700000)]


def torch_stub():
    return SimpleNamespace(cuda=SimpleNamespace(
        device_count=lambda: 1, device=lambda _: nullcontext(),
        is_bf16_supported=lambda: True, get_device_name=lambda _: "GPU"),
        version=SimpleNamespace(cuda="12.8"))


def test_qwen_hardware_uses_actual_torch_capabilities():
    detector = TorchHardwareDetector(torch_stub)
    assert detector.resolve({}).compute_type == "bfloat16"
    assert detector.resolve({"device":"cpu"}).compute_type == "float32"
    assert detector.resolve({"device":"cpu", "cpu_threads":0}).cpu_threads == 0
    for options in ({"compute_type":"int8"}, {"device":"cpu", "compute_type":"float16"}, {"device_index":2}):
        with pytest.raises(ValueError):
            detector.resolve(options)


def test_cache_switch_releases_backend_and_freezes_hardware():
    events, closed, loads = [], [], []
    hardware = TorchHardwareDetector(torch_stub).resolve({})
    def load(_hardware, _location, model):
        loads.append((model, _hardware))
        return SimpleNamespace(close=lambda: closed.append(model))
    cache = ModelCache(events.append, runtime_configurer=lambda: None,
                       hardware_detector=lambda: hardware, engine_loader=load, idle_timeout_seconds=30)
    try:
        with cache.acquire(QWEN, hardware=hardware):
            pass
        with cache.acquire(QWEN, hardware=hardware):
            pass
        with cache.acquire(DEFAULT_MODEL_ID, hardware=hardware):
            pass
        assert [m for m,h in loads] == [QWEN, DEFAULT_MODEL_ID]
        assert all(h is hardware for m,h in loads)
        assert closed == [QWEN]
    finally:
        cache.close()


def test_whisper_startup_does_not_import_optional_torch_or_transformers():
    code = "import sys; from whisper_subtitle.worker.runtime import WorkerRuntime; assert 'torch' not in sys.modules; assert 'transformers' not in sys.modules"
    subprocess.run([sys.executable, "-c", code], check=True)


def test_environment_query_accepts_model_and_rejects_companion():
    CommandMessage("env", CommandMethod.SYSTEM_ENVIRONMENT, {"model_id": QWEN})
    with pytest.raises(ProtocolValidationError):
        CommandMessage("env", CommandMethod.SYSTEM_ENVIRONMENT, {"model_id": ALIGNER})
