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

ROOT = Path(__file__).resolve().parents[2]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--model-dir", required=True, type=Path)
    parser.add_argument("--worker-executable", type=Path)
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
                            "outputs":[str(p) for p in paths]})
            print(json.dumps(results[-1], ensure_ascii=False), flush=True)
        ready = [m for m in observed if m.get("event") == "model.ready"]
        expected_loads = []
        for model, *_ in cases:
            if not expected_loads or expected_loads[-1] != model:
                expected_loads.append(model)
        assert [m["data"]["model_id"] for m in ready] == expected_loads
        send("stop", "worker.shutdown", {})
        while receive().get("request_id") != "stop":
            pass
        assert process.wait(timeout=30) == 0
    finally:
        if process.poll() is None:
            process.kill()
            process.wait(timeout=10)
        reader.join(timeout=2)
        (output / "worker-stderr.log").write_text("".join(stderr), encoding="utf-8")
        (output / "events.json").write_text(json.dumps(observed, ensure_ascii=False, indent=2), encoding="utf-8")
    (output / "backend-validation.json").write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
