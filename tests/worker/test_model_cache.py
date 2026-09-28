"""Deterministic lifecycle checks, including callbacks already past cancel()."""

from types import SimpleNamespace

import pytest

from whisper_subtitle.domain.execution import HardwareInfo
from whisper_subtitle.worker.model_cache import ModelCache


class ManualTimer:
    def __init__(self, interval, function, args=()):
        self.function = function
        self.args = args
        self.cancelled = False

    def start(self):
        pass

    def cancel(self):
        self.cancelled = True

    def fire(self):
        # Simulate a callback that entered before cancellation and was waiting
        # for the cache lock: it still runs even after cancel() returns.
        self.function(*self.args)


@pytest.mark.parametrize("replacement", ["large-v3-turbo", "qwen3-asr-0.6b"])
def test_cancelled_timer_cannot_release_reused_or_replaced_model(monkeypatch, replacement):
    monkeypatch.setattr("whisper_subtitle.worker.model_cache.threading.Timer", ManualTimer)
    closed = []
    cache = ModelCache(
        lambda event: None,
        runtime_configurer=lambda: None,
        hardware_detector=lambda: HardwareInfo("cpu", "float32", False, None, None, 4),
        engine_loader=lambda h, loc, model: SimpleNamespace(close=lambda: closed.append(model)),
    )
    try:
        cache.load("large-v3-turbo")
        stale = cache._timer
        with cache.acquire(replacement):
            stale.fire()
            assert cache.loaded
        current = cache._timer
        assert stale.cancelled
        assert current is not stale
        stale.fire()
        assert cache.loaded
        assert cache.model_id == replacement
        assert cache._timer is current
        current.fire()
        assert not cache.loaded
        assert closed == (["large-v3-turbo"] if replacement == "large-v3-turbo"
                          else ["large-v3-turbo", replacement])
    finally:
        cache.close()


def test_hardware_compatibility_import_is_the_same_contract():
    from whisper_subtitle.infrastructure.hardware import HardwareInfo as LegacyHardwareInfo

    assert LegacyHardwareInfo is HardwareInfo
