"""Real offline Worker regression across Qwen/Whisper model transitions.

Run explicitly, never as part of the unit suite. All generated media and outputs
stay under --output-dir. The fixed source audio and old goldens remain read-only.
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import queue
import re
import subprocess
import sys
import threading
import time
import wave
from dataclasses import asdict

from whisper_subtitle.protocol import parse_protocol_line
from whisper_subtitle.domain.subtitles import SubtitleOptions
from whisper_subtitle.domain.models import DECODING_DIAGNOSTIC_MODEL_IDS

if __package__:
    from .run_shutdown_validation import wait_for_exit
else:
    from run_shutdown_validation import wait_for_exit

ROOT = Path(__file__).resolve().parents[2]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--model-dir", required=True, type=Path)
    parser.add_argument("--worker-executable", type=Path)
    parser.add_argument("--cancel-qwen", action="store_true", help="Cancel three real Qwen tasks, then verify model reuse")
    parser.add_argument("--qwen-first", action="store_true",
                        help="Exercise Qwen startup before any Whisper CUDA initialization")
    args = parser.parse_args()
    output = args.output_dir.resolve()
    output.mkdir(parents=True, exist_ok=True)
    # Three repetitions separated by 12 s silence exercise offsets beyond 30 s.
    source = ROOT / "tests/fixtures/chinese_short.wav"
    long_media = output / "long-chinese.wav"
    with wave.open(str(source), "rb") as wav:
        params, frames = wav.getparams(), wav.readframes(wav.getnframes())
    with wave.open(str(long_media), "wb") as wav:
        wav.setparams(params)
        wav.writeframes((frames + bytes(params.framerate * params.sampwidth * params.nchannels * 12)) * 3)

    env = dict(os.environ, PYTHONIOENCODING="utf-8", PYTHONUNBUFFERED="1",
               HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1",
               WHISPER_SUBTITLE_MODEL_DIR=str(args.model_dir.resolve()))
    command = [str(args.worker_executable.resolve())] if args.worker_executable else [sys.executable, "-m", "whisper_subtitle", "worker"]
    process = subprocess.Popen(command, cwd=output, env=env, stdin=subprocess.PIPE,
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding="utf-8")
    lines = queue.Queue()
    stderr = []
    observed = []
    def read_stdout():
        for line in process.stdout:
            lines.put(line)
        lines.put(None)
    threading.Thread(target=read_stdout, daemon=True).start()
    reader = threading.Thread(target=lambda: stderr.extend(process.stderr), daemon=True)
    reader.start()
    def receive(timeout=180):
        line = lines.get(timeout=timeout)
        if line is None:
            raise RuntimeError("Worker closed stdout: " + "".join(stderr)[-4000:])
        parse_protocol_line(line)
        message = json.loads(line)
        observed.append(message)
        if message.get("type") == "error":
            raise RuntimeError(str(message))
        return message
    def send(request, method, params):
        process.stdin.write(json.dumps({"schema_version":1, "type":"command", "request_id":request,
                                       "method":method, "params":params}, ensure_ascii=False) + "\n")
        process.stdin.flush()
    results = []
    try:
        assert receive()["event"] == "worker.ready"
        cases = [("large-v3-turbo", "cn", source, False),
                 ("qwen3-asr-1.7b", "cn", source, True),
                 ("qwen3-asr-1.7b", "en_v1", ROOT / "tests/fixtures/english_short.wav", True),
                 ("qwen3-asr-0.6b", "cn", long_media, True),
                 ("large-v3-turbo", "cn2", source, False)]
        if args.qwen_first:
            cases = cases[1:] + cases[:1]
        for number, (model, preset, media, srt) in enumerate(cases):
            request = f"backend-{number}"
            target = output / request
            started = time.monotonic()
            send(request, "transcription.start", {
                "model_id":model,
                "inputs":[{"path":str(media), "kind":"file", "origin":"manual"}],
                "profile":{"base_preset_id":preset, "overrides":{}},
                "output":{"mode":"custom", "root_directory":str(target),
                          "txt":{"enabled":True}, "markdown":{"enabled":True}, "srt":{"enabled":srt},
                          "subtitle":asdict(SubtitleOptions()),
                          "preserve_source_txt":False, "conflict_policy":"overwrite"}})
            task_id = None
            deadline = time.monotonic() + 240
            while time.monotonic() < deadline:
                message = receive()
                if message.get("event") == "task.queued" and message.get("request_id") == request:
                    task_id = message["task_id"]
                if task_id and message.get("task_id") == task_id and message.get("event") in {"task.completed", "task.failed", "task.cancelled"}:
                    assert message["event"] == "task.completed", message
                    assert message["data"]["success_count"] == 1 and message["data"]["failure_count"] == 0, "".join(stderr)[-4000:]
                    break
            else:
                raise TimeoutError(request)
            paths = [Path(p) for p in message["data"]["outputs"]]
            quality_events = [
                item for item in observed
                if item.get("task_id") == task_id
                and "quality_diagnostics" in item.get("data", {})
            ]
            assert quality_events, "Worker did not report recognition diagnostics"
            quality_event = quality_events[-1]
            diagnostics = quality_event["data"]["quality_diagnostics"]
            assert diagnostics["detected_language"], "Detected language was lost"
            if model in DECODING_DIAGNOSTIC_MODEL_IDS:
                assert "需复核" in quality_event.get("message", "")
                assert "当前模型未提供" not in quality_event.get("message", "")
            else:
                assert "当前模型未提供这些解码质量指标" in quality_event.get("message", "")
                assert "需复核 0" not in quality_event.get("message", "")
                assert "温度回退 0" not in quality_event.get("message", "")
                assert diagnostics["language_probability"] is None, "Qwen confidence was fabricated"
            assert {p.suffix for p in paths} == ({".txt", ".md", ".srt"} if srt else {".txt", ".md"})
            assert all(p.is_file() and p.stat().st_size for p in paths)
            text = next(p for p in paths if p.suffix == ".txt").read_text(encoding="utf-8")
            if model == "large-v3-turbo":
                assert text == (ROOT / f"tests/golden/{preset}_real_output.txt").read_text(encoding="utf-8"), "Whisper golden changed"
            if srt:
                subtitle = next(p for p in paths if p.suffix == ".srt").read_text(encoding="utf-8")
                times = re.findall(r"(\d\d):(\d\d):(\d\d),(\d\d\d)", subtitle)
                seconds = [int(h)*3600 + int(m)*60 + int(s) + int(ms)/1000 for h,m,s,ms in times]
                assert seconds and all(a <= b for a,b in zip(seconds, seconds[1:])), subtitle
                if media == long_media:
                    assert seconds[-1] > 35, subtitle
                    assert text.count("今天天气很好") == 3, text
            results.append({"model":model, "preset":preset, "media":media.name,
                            "elapsed_seconds":round(time.monotonic()-started,3), "text":text,
                            "decoding_diagnostics_available":model in DECODING_DIAGNOSTIC_MODEL_IDS,
                            "diagnostic_message":quality_event.get("message"),
                            "outputs":[str(p) for p in paths]})
            print(json.dumps(results[-1], ensure_ascii=False), flush=True)
        ready = [m for m in observed if m.get("event") == "model.ready"]
        expected_loads = []
        for model, *_ in cases:
            if not expected_loads or expected_loads[-1] != model:
                expected_loads.append(model)
        assert [m["data"]["model_id"] for m in ready] == expected_loads
        if args.cancel_qwen:
            for number in range(4):
                request = f"cancel-check-{number}"
                target = output / request
                send(request, "transcription.start", {
                    "model_id": "qwen3-asr-1.7b",
                    "inputs": [{"path": str(long_media if number < 3 else source), "kind": "file", "origin": "manual"}],
                    "profile": {"base_preset_id": "cn", "overrides": {}},
                    "output": {"mode": "custom", "root_directory": str(target), "txt": {"enabled": True},
                               "markdown": {"enabled": True}, "srt": {"enabled": True}, "subtitle": asdict(SubtitleOptions()),
                               "preserve_source_txt": False, "conflict_policy": "fail"}})
                task_id, cancel_at = None, None
                while True:
                    message = receive()
                    if message.get("event") == "task.queued" and message.get("request_id") == request:
                        task_id = message["task_id"]
                    if message.get("task_id") != task_id or task_id is None:
                        continue
                    if number < 3 and cancel_at is None and message.get("event") == "task.progress" and message.get("data", {}).get("media_status") == "running":
                        time.sleep(.25)
                        cancel_at = time.monotonic()
                        send(f"cancel-{number}", "transcription.cancel", {"task_id": task_id})
                    if message.get("event") in {"task.completed", "task.failed", "task.cancelled"}:
                        expected = "task.cancelled" if number < 3 else "task.completed"
                        assert message["event"] == expected, message
                        if number < 3:
                            assert cancel_at is not None and not list(target.glob("*.*")), "Cancelled task left official outputs"
                        else:
                            assert message["data"]["failure_count"] == 0
                            assert {Path(p).suffix for p in message["data"]["outputs"]} == {".txt", ".md", ".srt"}
                        results.append({"model": "qwen3-asr-1.7b", "case": request, "terminal": expected,
                                        "cancel_to_terminal_seconds": time.monotonic()-cancel_at if cancel_at else None})
                        print(json.dumps(results[-1]), flush=True)
                        break
        send("stop", "worker.shutdown", {})
        while receive().get("request_id") != "stop":
            pass
        assert wait_for_exit(process, 30) and process.returncode == 0
    finally:
        if process.poll() is None:
            try:
                send("cleanup-stop", "worker.shutdown", {})
            except (OSError, ValueError):
                pass
            if not wait_for_exit(process, 30):
                process.kill()
                assert wait_for_exit(process, 10), "Worker teardown stuck; preserve diagnostics"
        reader.join(timeout=2)
        (output / "worker-stderr.log").write_text("".join(stderr), encoding="utf-8")
        (output / "events.json").write_text(json.dumps(observed, ensure_ascii=False, indent=2), encoding="utf-8")
    (output / "backend-validation.json").write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
