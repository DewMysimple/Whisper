"""Exercise the production inspection process and the opt-in Worker lifecycle."""

import shutil
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Event
from time import monotonic

import pytest

from whisper_subtitle.protocol import CommandMessage, CommandMethod, EventCode
from whisper_subtitle.worker import WorkerRuntime
from whisper_subtitle.worker.media_inspector import MediaInspector, ProbeProcess


FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "chinese_short.wav"


def test_real_probe_caches_media_and_classifies_paths(tmp_path):
    readable = tmp_path / "本地 media #验收.wav"
    shutil.copyfile(FIXTURE, readable)
    unreadable = tmp_path / "damaged.wav"
    unreadable.write_text("not a container", encoding="utf-8")
    unsupported = tmp_path / "extension.txt"
    unsupported.touch()
    missing = tmp_path / "absent.wav"
    inspector = MediaInspector(None)
    try:
        first, second, invalid, unsupported_file, missing_file = inspector.inspect(
            [readable, readable, unreadable, unsupported, missing]
        )
        assert first.result.duration == pytest.approx(5.32263)
        assert second.result == first.result
        assert first.cache_hit != second.cache_hit
        assert invalid.result.code == "media.unreadable"
        assert unsupported_file.result.code == "media.unsupported"
        assert missing_file.result.code == "media.not_found"
        assert not inspector.inspect([unreadable])[0].cache_hit
        assert inspector.inspect([readable])[0].cache_hit
    finally:
        inspector.close()


def test_video_container_without_an_audio_track_has_distinct_error(tmp_path):
    import av

    video = tmp_path / "video-only.mp4"
    with av.open(str(video), mode="w") as output:
        track = output.add_stream("mpeg4", rate=1)
        track.width = track.height = 32
        track.pix_fmt = "yuv420p"
        frame = av.VideoFrame(32, 32, "yuv420p")
        for plane in frame.planes:
            plane.update(bytes(plane.buffer_size))
        for packet in track.encode(frame) + track.encode():
            output.mux(packet)
    inspector = MediaInspector(None)
    try:
        assert inspector.inspect([video])[0].result.code == "media.no_audio"
    finally:
        inspector.close()


@pytest.mark.parametrize("cancel", [False, True], ids=["deadline", "user_cancel"])
def test_fault_injected_process_is_reaped_before_next_probe(tmp_path, cancel):
    # This fault is deliberately injected. The next command exercises the same
    # reusable slot after the unresponsive helper was terminated.
    script = """
import json, sys, time
from pathlib import Path
for input in sys.stdin:
    path = Path(json.loads(input))
    if path.name == 'slow.wav':
        path.touch()
        time.sleep(60)
    print(json.dumps([True, 3.5, None, None]), flush=True)
"""
    process = ProbeProcess(command=[sys._base_executable, "-c", script], timeout=1.5)
    stop = Event()
    slow = tmp_path / "slow.wav"
    assert process.probe(tmp_path / "warm.wav", stop.is_set).readable
    child = process._child
    assert child is not None
    try:
        with ThreadPoolExecutor(max_workers=1) as pool:
            check = pool.submit(process.probe, slow, stop.is_set)
            if cancel:
                until = monotonic() + 1
                while not slow.is_file() and monotonic() < until:
                    stop.wait(0.01)
                assert slow.is_file()
                stop.set()
            assert check.result(timeout=3).code == (
                "media.cancelled" if cancel else "media.timeout"
            )
        assert child.poll() is not None
        stop.clear()
        assert process.probe(tmp_path / "other.wav", stop.is_set).duration == 3.5
        assert process._child is not child
    finally:
        assert process.close()


def test_progress_and_control_stay_responsive_and_old_cancel_is_request_scoped(tmp_path):
    slow = tmp_path / "slow.wav"
    fast = tmp_path / "fast.wav"
    for path in [slow, fast]:
        path.touch()
    release, entered, fast_visible, legacy_ended, retry_ended = (Event() for _ in range(5))
    events = []

    def probe(path):
        if path == slow:
            entered.set()
            assert release.wait(3)
        return True, None, None

    def consume(event):
        events.append(event)
        if event.event is EventCode.MEDIA_INSPECTION_PROGRESS and event.request_id == "inspect-a":
            if any(item["item"]["path"] == str(fast) for item in event.data["items"]):
                fast_visible.set()
        if event.event is EventCode.COMMAND_COMPLETED:
            if event.request_id == "inspect-a":
                legacy_ended.set()
            if event.request_id == "inspect-b":
                retry_ended.set()

    with ThreadPoolExecutor(max_workers=1) as pool:
        runtime = WorkerRuntime(consume, media_duration_probe=probe)
        try:
            runtime.handle_command(CommandMessage(
                "inspect-a", CommandMethod.MEDIA_INSPECT,
                {"paths": [str(slow), str(fast)], "progressive": True},
            ))
            assert entered.wait(1)
            assert fast_visible.wait(1)
            health = pool.submit(runtime.handle_command, CommandMessage("health", CommandMethod.SYSTEM_HEALTH))
            assert health.result(timeout=1) is False
            runtime.handle_command(CommandMessage(
                "cancel-a", CommandMethod.MEDIA_CANCEL_INSPECTION, {"inspection_request_id": "inspect-a"},
            ))
            runtime.handle_command(CommandMessage(
                "inspect-b", CommandMethod.MEDIA_INSPECT, {"paths": [str(slow)], "progressive": True},
            ))
            release.set()
            assert legacy_ended.wait(1)
            assert retry_ended.wait(1)
            result_a = next(event.data["result"] for event in events if event.request_id == "inspect-a" and event.event is EventCode.COMMAND_COMPLETED)
            result_b = next(event.data["result"] for event in events if event.request_id == "inspect-b" and event.event is EventCode.COMMAND_COMPLETED)
            assert result_a["cancelled"]
            assert result_a["items"][0]["error_code"] == "media.cancelled"
            assert not result_b["cancelled"]
            assert result_b["items"][0]["readable"]
            assert result_b["items"][0]["duration_seconds"] is None
        finally:
            release.set()
            runtime.close(timeout=5)
