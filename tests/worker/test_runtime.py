"""Runtime tests for the persistent headless Worker."""

from __future__ import annotations

import threading
import time
from pathlib import Path
from types import SimpleNamespace

import pytest

from whisper_subtitle.infrastructure.hardware import HardwareInfo
from whisper_subtitle.protocol import (
    CommandMessage,
    CommandMethod,
    ErrorCode,
    EventCode,
    EventMessage,
    validate_task_event_sequence,
)
from whisper_subtitle.worker.runtime import (
    ModelCache,
    WorkerCommandError,
    WorkerRuntime,
    expand_input_sources,
)


def output_policy(*, mode="compatibility", root=None, conflict="overwrite"):
    policy = {
        "mode": mode,
        "txt": {"enabled": True},
        "markdown": {"enabled": False},
        "preserve_source_txt": True,
        "conflict_policy": conflict,
    }
    if root is not None:
        policy["root_directory"] = str(root)
    return policy


def start_command(
    request_id,
    *paths,
    overrides=None,
    policy=None,
    model_id=None,
    hardware_preference=None,
):
    params = {
        "inputs": [
            {"path": str(path), "kind": "file", "origin": "dialog"}
            for path in paths
        ],
        "profile": {
            "base_preset_id": "en_v1",
            "overrides": overrides or {},
        },
        "output": policy or output_policy(),
    }
    if model_id is not None:
        params["model_id"] = model_id
    if hardware_preference is not None:
        params["hardware"] = hardware_preference
    return CommandMessage(
        request_id,
        CommandMethod.TRANSCRIPTION_START,
        params,
    )


def make_media(directory: Path, name: str) -> Path:
    path = directory / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"fixture")
    return path


class FakeEngine:
    def __init__(self, *, started=None, release=None, fail_calls=(), texts=None):
        self.started = started
        self.release = release
        self.fail_calls = set(fail_calls)
        self.texts = texts or ("worker transcript.",)
        self.calls = []

    def transcribe(self, media_path, **options):
        self.calls.append((Path(media_path), options))
        call_number = len(self.calls)
        if call_number in self.fail_calls:
            raise RuntimeError(f"inference failure {call_number}")

        def segments():
            if self.started is not None:
                self.started.set()
            if self.release is not None:
                assert self.release.wait(3), "test did not release fake inference"
            for index, text in enumerate(self.texts):
                yield SimpleNamespace(
                    text=text,
                    start=float(index),
                    end=float(index) + 1.0,
                )

        info = SimpleNamespace(language="en", language_probability=0.99)
        return segments(), info


def hardware():
    return HardwareInfo(
        device="cuda",
        compute_type="float16",
        cuda_available=True,
        gpu_name="Test GPU",
        cuda_version="driver 555.0",
        cpu_threads=0,
    )


def make_runtime(events, engine, load_calls, task_ids):
    def load(_hardware, _location, model_id):
        load_calls.append(model_id)
        return engine

    ids = iter(task_ids)
    return WorkerRuntime(
        events.append,
        environment_checker=lambda: [],
        runtime_configurer=lambda: SimpleNamespace(),
        hardware_detector=hardware,
        engine_loader=load,
        idle_timeout_seconds=60,
        task_id_factory=lambda: next(ids),
    )


def task_events(events, task_id):
    return [
        event
        for event in events
        if isinstance(event, EventMessage)
        and event.task_id == task_id
        and event.event.value.startswith("task.")
    ]


def test_consecutive_tasks_reuse_one_model_and_keep_valid_lifecycles(tmp_path):
    first = make_media(tmp_path, "first.wav")
    second = make_media(tmp_path, "second.wav")
    events = []
    engine = FakeEngine()
    load_calls = []
    runtime = make_runtime(events, engine, load_calls, ["task-1", "task-2"])
    try:
        runtime.handle_command(start_command("req-1", first, overrides={"beam_size": 7}))
        runtime.handle_command(start_command("req-2", second))

        assert runtime.wait_until_idle()
    finally:
        assert runtime.close(timeout=3)

    assert load_calls == ["large-v3-turbo"]
    assert len(engine.calls) == 2
    assert engine.calls[0][1]["beam_size"] == 7
    assert (tmp_path / "Text" / "first.txt").read_text(encoding="utf-8") == (
        "Worker transcript.\n"
    )
    assert (tmp_path / "Text" / "second.txt").is_file()
    for task_id in ("task-1", "task-2"):
        validate_task_event_sequence(task_events(events, task_id))


def test_mixed_model_queue_freezes_each_task_without_interrupting_active_work(tmp_path):
    first = make_media(tmp_path, "first-model.wav")
    second = make_media(tmp_path, "second-model.wav")
    started = threading.Event()
    release = threading.Event()
    events = []
    load_calls = []
    runtime = make_runtime(
        events,
        FakeEngine(started=started, release=release),
        load_calls,
        ["task-turbo", "task-medium"],
    )
    try:
        runtime.handle_command(
            start_command("req-turbo", first, model_id="large-v3-turbo")
        )
        assert started.wait(3)
        runtime.handle_command(start_command("req-medium", second, model_id="medium"))
        release.set()
        assert runtime.wait_until_idle()
    finally:
        release.set()
        assert runtime.close(timeout=3)

    assert load_calls == ["large-v3-turbo", "medium"]
    queued_events = [
        event
        for event in events
        if isinstance(event, EventMessage) and event.event is EventCode.TASK_QUEUED
    ]
    assert [event.data["model_id"] for event in queued_events] == [
        "large-v3-turbo",
        "medium",
    ]


def test_mixed_hardware_queue_freezes_and_switches_at_task_boundaries(tmp_path):
    first = make_media(tmp_path, "first-hardware.wav")
    second = make_media(tmp_path, "second-hardware.wav")
    events = []
    engine = FakeEngine()
    detected = []
    loaded = []

    def detect(preference=None):
        selected = dict(preference or {})
        detected.append(selected)
        if selected.get("mode") == "cpu":
            return HardwareInfo(
                device="cpu",
                compute_type=str(selected["cpu_compute_type"]),
                cuda_available=False,
                gpu_name=None,
                cuda_version=None,
                cpu_threads=int(selected["cpu_threads"]),
            )
        return HardwareInfo(
            device="cuda",
            compute_type=str(selected.get("cuda_compute_type") or "float16"),
            cuda_available=True,
            gpu_name="Test GPU",
            cuda_version="driver 555.0",
            cpu_threads=0,
            device_index=int(selected.get("gpu_device_index") or 0),
        )

    def load(resolved_hardware, _location, model_id):
        loaded.append((model_id, resolved_hardware.device, resolved_hardware.compute_type))
        return engine

    runtime = WorkerRuntime(
        events.append,
        environment_checker=lambda: [],
        runtime_configurer=lambda: SimpleNamespace(),
        hardware_detector=detect,
        engine_loader=load,
        idle_timeout_seconds=60,
        task_id_factory=iter(["task-cuda", "task-cpu"]).__next__,
    )
    cuda_preference = {
        "mode": "cuda",
        "gpu_device_index": 0,
        "cuda_compute_type": "int8_float16",
        "cpu_compute_type": "int8",
        "cpu_threads": 4,
    }
    cpu_preference = {
        "mode": "cpu",
        "gpu_device_index": 0,
        "cuda_compute_type": "float16",
        "cpu_compute_type": "float32",
        "cpu_threads": 6,
    }
    try:
        runtime.handle_command(
            start_command(
                "req-cuda", first, hardware_preference=cuda_preference
            )
        )
        runtime.handle_command(
            start_command("req-cpu", second, hardware_preference=cpu_preference)
        )
        assert runtime.wait_until_idle()
    finally:
        assert runtime.close(timeout=3)

    assert loaded == [
        ("large-v3-turbo", "cuda", "int8_float16"),
        ("large-v3-turbo", "cpu", "float32"),
    ]
    queued_events = [
        event
        for event in events
        if isinstance(event, EventMessage) and event.event is EventCode.TASK_QUEUED
    ]
    assert [dict(event.data["hardware"]) for event in queued_events] == [
        {
            "device": "cuda",
            "device_index": 0,
            "compute_type": "int8_float16",
            "cpu_threads": 0,
        },
        {
            "device": "cpu",
            "device_index": 0,
            "compute_type": "float32",
            "cpu_threads": 6,
        },
    ]
    assert cuda_preference in detected
    assert cpu_preference in detected


def test_system_metrics_returns_read_only_machine_snapshot():
    events = []
    runtime = WorkerRuntime(
        events.append,
        environment_checker=lambda: [],
        performance_sampler=lambda: {
            "timestamp_ms": 1234,
            "cpu_percent": 25.0,
            "memory_percent": 40.0,
            "memory_used_gib": 12.0,
            "memory_total_gib": 32.0,
            "memory_available_gib": 20.0,
            "worker_rss_gib": 0.2,
            "gpu_percent": 70.0,
            "vram_used_gib": 8.0,
            "vram_total_gib": 16.0,
            "gpu_name": "Test GPU",
        },
    )
    try:
        runtime.handle_command(
            CommandMessage("req-metrics", CommandMethod.SYSTEM_METRICS, {})
        )
    finally:
        assert runtime.close(timeout=3)

    completed = next(
        event
        for event in events
        if isinstance(event, EventMessage)
        and event.event is EventCode.COMMAND_COMPLETED
    )
    assert completed.data["method"] == "system.metrics"
    assert completed.data["result"]["gpu_percent"] == 70.0
    assert completed.data["result"]["memory_available_gib"] == 20.0


def test_active_task_can_be_cancelled_and_model_unload_is_busy(tmp_path):
    media = make_media(tmp_path, "blocked.wav")
    started = threading.Event()
    release = threading.Event()
    events = []
    runtime = make_runtime(
        events,
        FakeEngine(started=started, release=release),
        [],
        ["task-cancel"],
    )
    try:
        runtime.handle_command(start_command("req-start", media))
        assert started.wait(3)

        with pytest.raises(WorkerCommandError) as captured:
            runtime.handle_command(
                CommandMessage("req-unload", CommandMethod.MODEL_UNLOAD, {})
            )
        assert captured.value.code is ErrorCode.WORKER_BUSY

        runtime.handle_command(
            CommandMessage(
                "req-cancel",
                CommandMethod.TRANSCRIPTION_CANCEL,
                {"task_id": "task-cancel"},
            )
        )
        release.set()
        assert runtime.wait_until_idle()
    finally:
        release.set()
        assert runtime.close(timeout=3)

    sequence = task_events(events, "task-cancel")
    validate_task_event_sequence(sequence)
    assert sequence[-1].event is EventCode.TASK_CANCELLED
    assert not (tmp_path / "Text" / "blocked.txt").exists()


def test_one_failed_inference_does_not_crash_dispatcher_or_reload_model(tmp_path):
    first = make_media(tmp_path, "bad.wav")
    second = make_media(tmp_path, "good.wav")
    events = []
    load_calls = []
    runtime = make_runtime(
        events,
        FakeEngine(fail_calls={1}),
        load_calls,
        ["task-bad", "task-good"],
    )
    try:
        runtime.handle_command(start_command("req-bad", first))
        runtime.handle_command(start_command("req-good", second))
        assert runtime.wait_until_idle()
        runtime.handle_command(
            CommandMessage("req-health", CommandMethod.SYSTEM_HEALTH, {})
        )
    finally:
        assert runtime.close(timeout=3)

    assert load_calls == ["large-v3-turbo"]
    bad_terminal = task_events(events, "task-bad")[-1]
    good_terminal = task_events(events, "task-good")[-1]
    assert bad_terminal.event is EventCode.TASK_COMPLETED
    assert bad_terminal.data["failure_count"] == 1
    assert good_terminal.data["success_count"] == 1
    assert any(
        event.event is EventCode.COMMAND_COMPLETED
        and event.request_id == "req-health"
        for event in events
    )


def test_model_cache_releases_after_idle_timeout():
    events = []
    load_calls = []

    def load(_hardware, _location, model_id):
        load_calls.append(model_id)
        return object()

    cache = ModelCache(
        events.append,
        runtime_configurer=lambda: SimpleNamespace(),
        hardware_detector=hardware,
        engine_loader=load,
        idle_timeout_seconds=0.03,
    )
    cache.load("large-v3-turbo", request_id="req-load")
    deadline = time.monotonic() + 2
    while cache.loaded and time.monotonic() < deadline:
        time.sleep(0.01)

    assert load_calls == ["large-v3-turbo"]
    assert not cache.loaded
    cache.close()


def test_input_sources_strip_one_quote_layer_expand_and_deduplicate(tmp_path):
    media = make_media(tmp_path, "中文 音频.wav")

    expanded = expand_input_sources(
        [
            {"path": f'"{media}"', "kind": "file", "origin": "paste"},
            {"path": str(tmp_path), "kind": "directory", "origin": "dialog"},
        ]
    )

    assert expanded == (media.resolve(),)


def test_invalid_source_is_not_silently_dropped(tmp_path):
    valid = make_media(tmp_path, "valid.wav")

    with pytest.raises(WorkerCommandError) as captured:
        expand_input_sources(
            [
                {"path": str(valid), "kind": "file", "origin": "dialog"},
                {
                    "path": str(tmp_path / "missing.wav"),
                    "kind": "file",
                    "origin": "dialog",
                },
            ]
        )

    assert captured.value.code is ErrorCode.REQUEST_INVALID
    assert captured.value.data["inputs"][0]["path"].endswith("missing.wav")


def test_worker_writes_custom_txt_lines_and_markdown_paragraphs(tmp_path):
    media = make_media(tmp_path / "input", "custom.wav")
    root = tmp_path / "outputs"
    policy = {
        "mode": "custom",
        "root_directory": str(root),
        "txt": {"enabled": True},
        "markdown": {"enabled": True},
        "preserve_source_txt": True,
        "preserve_source_markdown": True,
        "conflict_policy": "fail",
    }
    events = []
    runtime = make_runtime(
        events,
        FakeEngine(texts=("first.", "second.", "third.", "fourth.")),
        [],
        ["task-custom"],
    )
    try:
        runtime.handle_command(
            start_command("req-custom", media, policy=policy)
        )
        assert runtime.wait_until_idle()
    finally:
        assert runtime.close(timeout=3)

    txt = root / "custom.txt"
    markdown = root / "custom.md"
    assert txt.read_text(encoding="utf-8") == "First.\nSecond.\nThird.\nFourth.\n"
    assert markdown.read_text(encoding="utf-8") == (
        "First. Second. Third.\n\nFourth.\n"
    )
    assert (media.parent / "Text" / "custom.txt").read_text(
        encoding="utf-8"
    ) == txt.read_text(encoding="utf-8")
    assert (media.parent / "Markdown" / "custom.md").read_text(
        encoding="utf-8"
    ) == markdown.read_text(encoding="utf-8")


def test_worker_writes_timestamped_srt_from_existing_model_segments(tmp_path):
    media = make_media(tmp_path / "input", "subtitle.wav")
    root = tmp_path / "outputs"
    policy = {
        "mode": "custom",
        "root_directory": str(root),
        "txt": {"enabled": False},
        "markdown": {"enabled": False},
        "srt": {"enabled": True},
        "subtitle": {
            "max_characters_per_line": 42,
            "max_lines_per_cue": 2,
            "min_cue_duration_ms": 800,
            "max_cue_duration_ms": 7000,
            "max_characters_per_second": 20,
            "cue_gap_ms": 80,
        },
        "preserve_source_txt": False,
        "conflict_policy": "fail",
    }
    events = []
    runtime = make_runtime(events, FakeEngine(), [], ["task-srt"])
    try:
        runtime.handle_command(start_command("req-srt", media, policy=policy))
        assert runtime.wait_until_idle()
    finally:
        assert runtime.close(timeout=3)

    srt = root / "subtitle.srt"
    assert srt.read_text(encoding="utf-8") == (
        "1\n00:00:00,000 --> 00:00:01,000\nWorker transcript.\n"
    )
    assert not (root / "Text" / "subtitle.txt").exists()


def test_output_conflict_fails_before_model_loading(tmp_path):
    media = make_media(tmp_path / "input", "same.wav")
    root = tmp_path / "outputs"
    destination = root / "same.txt"
    destination.parent.mkdir(parents=True)
    destination.write_text("existing", encoding="utf-8")
    policy = {
        "mode": "custom",
        "root_directory": str(root),
        "txt": {"enabled": True},
        "markdown": {"enabled": False},
        "preserve_source_txt": False,
        "conflict_policy": "fail",
    }
    events = []
    load_calls = []
    runtime = make_runtime(events, FakeEngine(), load_calls, ["task-conflict"])
    try:
        with pytest.raises(WorkerCommandError) as captured:
            runtime.handle_command(
                start_command("req-conflict", media, policy=policy)
            )
    finally:
        assert runtime.close(timeout=3)

    assert captured.value.code is ErrorCode.OUTPUT_FAILED
    assert captured.value.data == {
        "exception": "OutputConflictError",
        "paths": [str(destination)],
    }
    assert load_calls == []
    assert destination.read_text(encoding="utf-8") == "existing"


def test_fail_policy_detects_an_active_task_reserved_output(tmp_path):
    media = make_media(tmp_path / "input", "reserved.wav")
    root = tmp_path / "outputs"
    started = threading.Event()
    release = threading.Event()
    events = []
    runtime = make_runtime(
        events,
        FakeEngine(started=started, release=release),
        [],
        ["task-reserved"],
    )
    first_policy = output_policy(mode="custom", root=root, conflict="overwrite")
    second_policy = output_policy(mode="custom", root=root, conflict="fail")
    try:
        runtime.handle_command(start_command("req-first", media, policy=first_policy))
        assert started.wait(3)
        with pytest.raises(WorkerCommandError) as captured:
            runtime.handle_command(
                start_command("req-second", media, policy=second_policy)
            )
    finally:
        release.set()
        assert runtime.wait_until_idle()
        assert runtime.close(timeout=3)

    assert captured.value.code is ErrorCode.OUTPUT_FAILED
    assert captured.value.data["paths"] == [
        str(root / "reserved.txt"),
        str(media.parent / "Text" / "reserved.txt"),
    ]
