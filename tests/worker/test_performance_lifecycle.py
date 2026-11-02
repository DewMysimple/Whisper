"""Performance resources belong only to the runtime's default sampler."""

import threading
from types import SimpleNamespace

import pytest

from whisper_subtitle.protocol import CommandMessage, CommandMethod
from whisper_subtitle.worker import runtime as runtime_module


class Monitor:
    def __init__(self, calls):
        self.calls = calls

    def __call__(self):
        self.calls.append("sample")
        return {"timestamp_ms": 1000}

    def close(self):
        self.calls.append("monitor.close")


@pytest.mark.parametrize("model_cleanup_fails", [False, True])
def test_default_monitor_closes_after_model_even_when_model_cleanup_fails(monkeypatch, model_cleanup_fails):
    calls = []
    monitor = Monitor(calls)
    monkeypatch.setattr(runtime_module, "PerformanceMonitor", lambda: monitor)

    def close_model():
        calls.append("model.close")
        if model_cleanup_fails:
            raise RuntimeError("model cleanup failed")

    runtime = runtime_module.WorkerRuntime(
        lambda event: None, model_cache=SimpleNamespace(close=close_model),
    )
    runtime.handle_command(CommandMessage("metrics-1", CommandMethod.SYSTEM_METRICS, {}))
    runtime.handle_command(CommandMessage("metrics-2", CommandMethod.SYSTEM_METRICS, {}))
    if model_cleanup_fails:
        with pytest.raises(RuntimeError, match="model cleanup failed"):
            runtime.close(timeout=2)
    else:
        assert runtime.close(timeout=2)
    assert calls == ["sample", "sample", "model.close", "monitor.close"]


def test_injected_sampler_is_never_constructed_or_closed_by_runtime(monkeypatch):
    calls = []
    sampler = Monitor(calls)

    def construct_default():
        raise AssertionError("an injected sampler must not construct another owner")

    monkeypatch.setattr(runtime_module, "PerformanceMonitor", construct_default)
    runtime = runtime_module.WorkerRuntime(
        lambda event: None, performance_sampler=sampler,
        model_cache=SimpleNamespace(close=lambda: calls.append("model.close")),
    )
    try:
        runtime.handle_command(CommandMessage("metrics", CommandMethod.SYSTEM_METRICS, {}))
    finally:
        assert runtime.close(timeout=2)
    assert calls == ["sample", "model.close"]


def test_timed_out_dispatcher_keeps_monitor_alive_until_final_close(monkeypatch):
    calls = []
    entered, release = threading.Event(), threading.Event()
    monkeypatch.setattr(runtime_module, "PerformanceMonitor", lambda: Monitor(calls))
    runtime = runtime_module.WorkerRuntime(
        lambda event: None,
        model_cache=SimpleNamespace(close=lambda: calls.append("model.close")),
    )

    def execute(task):
        entered.set()
        assert release.wait(2)

    monkeypatch.setattr(runtime, "_execute_task", execute)
    task = SimpleNamespace(cancel=threading.Event(), output_plans=())
    with runtime._condition:
        runtime._queue.append(task)
        runtime._condition.notify_all()
    try:
        assert entered.wait(2)
        assert not runtime.close(timeout=0.01)
        assert task.cancel.is_set()
        assert calls == []
    finally:
        release.set()
        assert runtime.close(timeout=2)
    assert calls == ["model.close", "monitor.close"]
