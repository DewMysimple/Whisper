"""Validate persistent Worker model reuse with real CUDA inference."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys
import threading
import time
import wave
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[2]
INPUT_PATH = PROJECT_ROOT / "tests" / "fixtures" / "chinese_short.wav"
GOLDENS = {
    "cn": PROJECT_ROOT / "tests" / "golden" / "cn_real_output.txt",
    "cn2": PROJECT_ROOT / "tests" / "golden" / "cn2_real_output.txt",
}


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest().upper()


def normalized_text_sha256(path: Path) -> str:
    text = path.read_text(encoding="utf-8")
    return hashlib.sha256(text.encode("utf-8")).hexdigest().upper()


def command(request_id: str, method: str, params: dict) -> str:
    return json.dumps(
        {
            "schema_version": 1,
            "type": "command",
            "request_id": request_id,
            "method": method,
            "params": params,
        },
        ensure_ascii=False,
        separators=(",", ":"),
    )


def start_params(preset_id: str, output_root: Path, model_id: str | None = None) -> dict:
    params = {
        "inputs": [
            {"path": str(INPUT_PATH), "kind": "file", "origin": "manual"}
        ],
        "profile": {"base_preset_id": preset_id, "overrides": {}},
        "output": {
            "mode": "custom",
            "root_directory": str(output_root),
            "txt": {"enabled": True},
            "markdown": {"enabled": False},
            "preserve_source_txt": False,
            "conflict_policy": "overwrite",
        },
    }
    if model_id is not None:
        params["model_id"] = model_id
    return params


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--timeout", type=float, default=300.0)
    parser.add_argument("--worker-executable", type=Path)
    parser.add_argument("--model-dir", type=Path)
    parser.add_argument("--model-id", choices=("large-v3-turbo", "qwen3-asr-0.6b", "qwen3-asr-1.7b"))
    parser.add_argument("--repeat-cn", type=int, help="Repeat the same Mandarin task within one process")
    preparation = parser.add_mutually_exclusive_group()
    preparation.add_argument("--preload", action="store_true", help="Measure explicit model.load before the first task")
    preparation.add_argument("--cancel-first-start", action="store_true", help="Cancel a cold start before task creation")
    args = parser.parse_args()
    if args.repeat_cn is not None and args.repeat_cn < 2:
        parser.error("--repeat-cn requires at least 2 tasks")
    if args.model_id is not None and args.model_id.startswith("qwen") and args.repeat_cn is None:
        parser.error("Use --repeat-cn for Qwen Mandarin timing")
    presets = ["cn"] * args.repeat_cn if args.repeat_cn is not None else list(GOLDENS)
    output_dir = args.output_dir.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    environment = os.environ.copy()
    environment["PYTHONIOENCODING"] = "utf-8"
    environment["PYTHONUNBUFFERED"] = "1"
    environment["HF_HUB_OFFLINE"] = "1"
    environment["TRANSFORMERS_OFFLINE"] = "1"
    if args.model_dir is not None:
        environment["WHISPER_SUBTITLE_MODEL_DIR"] = str(args.model_dir.resolve())
    worker_command = (
        [str(args.worker_executable.resolve())]
        if args.worker_executable is not None
        else [
            sys.executable,
            "-m",
            "whisper_subtitle",
            "worker",
            "--model-idle-timeout",
            "3600",
        ]
    )
    started = time.perf_counter()
    process = subprocess.Popen(
        worker_command,
        cwd=output_dir,
        env=environment,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        errors="strict",
        bufsize=1,
    )
    assert process.stdin is not None
    assert process.stdout is not None
    assert process.stderr is not None
    stderr_lines: list[str] = []

    def read_stderr() -> None:
        stderr_lines.extend(process.stderr)

    stderr_reader = threading.Thread(target=read_stderr, daemon=True)
    stderr_reader.start()
    observed: list[dict] = []
    timed_out = threading.Event()

    def kill_on_timeout() -> None:
        timed_out.set()
        if process.poll() is None:
            process.kill()

    watchdog = threading.Timer(args.timeout, kill_on_timeout)
    watchdog.daemon = True
    watchdog.start()

    def receive(*, expected_error_request: str | None = None) -> dict:
        line = process.stdout.readline()
        if not line:
            if timed_out.is_set():
                raise TimeoutError("GPU validation timed out")
            raise RuntimeError("Worker stdout closed before validation completed")
        message = json.loads(line)
        observed.append(message)
        if message.get("type") == "error" and (
            expected_error_request is None or message.get("request_id") != expected_error_request
        ):
            raise RuntimeError(f"Worker command error: {message}")
        return message

    def send(request_id: str, method: str, params: dict) -> None:
        process.stdin.write(command(request_id, method, params) + "\n")
        process.stdin.flush()

    results = []
    try:
        ready = receive()
        process_to_ready = time.perf_counter() - started
        if ready.get("event") != "worker.ready":
            raise RuntimeError(f"expected worker.ready, received {ready}")

        preload_seconds = None
        cancelled_preparation = None
        first_residency = "process_first_task"
        if args.preload:
            first_residency = "prewarmed_first_task"
            preload_started = time.perf_counter()
            send("gpu-preload", "model.load", {"model_id": args.model_id} if args.model_id else {})
            while True:
                preloaded = receive()
                if preloaded.get("event") == "command.completed" and preloaded.get("request_id") == "gpu-preload":
                    preload_seconds = time.perf_counter() - preload_started
                    break
        if args.cancel_first_start:
            first_residency = "first_task_after_cancelled_preparation"
            pending = "gpu-cold-start-cancelled"
            cancelled_output = output_dir / "cancelled-preparation"
            send(pending, "transcription.start", start_params("cn", cancelled_output, args.model_id))
            while True:
                message = receive()
                if message.get("event") == "model.loading" and message.get("request_id") == pending:
                    break
            cancelled_at = time.perf_counter()
            send("gpu-cancel-start", "transcription.cancel_start", {"start_request_id": pending})
            acknowledged_at = stopped_at = None
            while acknowledged_at is None or stopped_at is None:
                message = receive(expected_error_request=pending)
                if message.get("request_id") == "gpu-cancel-start" and message.get("event") == "command.completed":
                    if message["data"]["result"].get("accepted") is not True:
                        raise RuntimeError(f"start cancellation was rejected: {message}")
                    acknowledged_at = time.perf_counter()
                if message.get("request_id") == pending:
                    if message.get("event") == "task.queued":
                        raise RuntimeError("cancelled preparation created a task")
                    if message.get("type") == "error":
                        if message.get("data", {}).get("exception") != "StartCancelled":
                            raise RuntimeError(f"unexpected preparation failure: {message}")
                        stopped_at = time.perf_counter()
            if cancelled_output.exists():
                raise RuntimeError("cancelled preparation created an output directory")
            cancelled_preparation = {
                "acknowledgement_seconds": acknowledged_at - cancelled_at,
                "safe_boundary_seconds": stopped_at - cancelled_at,
            }

        for index, preset_id in enumerate(presets):
            golden = GOLDENS[preset_id]
            request_id = f"gpu-{preset_id}-{index}"
            preset_output = output_dir / (f"{preset_id}-{index}" if args.repeat_cn else preset_id)
            request_started = time.perf_counter()
            send(
                request_id,
                "transcription.start",
                start_params(preset_id, preset_output, args.model_id),
            )
            task_id = None
            events: dict[str, float] = {}
            while True:
                message = receive()
                elapsed = time.perf_counter() - request_started
                name = message.get("event")
                if message.get("request_id") == request_id:
                    if name in {"model.loading", "model.ready", "task.queued"}:
                        events.setdefault(name, elapsed)
                    if name == "task.queued":
                        task_id = message["task_id"]
                if task_id is None or message.get("task_id") != task_id:
                    continue
                if name == "task.progress":
                    data = message["data"]
                    events.setdefault(f"progress.{data['stage']}", elapsed)
                    if data["stage"] == "transcription.running" and data.get("media_progress_percent", 0) > 0:
                        events.setdefault("first_segment_progress", elapsed)
                if name in {"task.completed", "task.failed", "task.cancelled"}:
                    if name != "task.completed":
                        raise RuntimeError(f"task did not complete: {message}")
                    events[name] = elapsed
                    break
            if message["data"]["failure_count"] or message["data"]["success_count"] != 1:
                raise RuntimeError(f"media did not complete successfully: {message}")
            transcript = next(
                Path(path) for path in message["data"]["outputs"]
                if Path(path).suffix.lower() == ".txt"
            )
            actual_hash = normalized_text_sha256(transcript)
            expected_hash = normalized_text_sha256(golden)
            if actual_hash != expected_hash:
                raise RuntimeError(
                    f"{preset_id} golden mismatch: actual={actual_hash}, "
                    f"expected={expected_hash}"
                )
            results.append(
                {
                    "residency": first_residency if index == 0 else "model_resident",
                    "preset_id": preset_id,
                    "task_id": task_id,
                    "output": str(transcript),
                    "normalized_sha256": actual_hash,
                    "raw_sha256": sha256(transcript),
                    "request_to_observed_event_seconds": events,
                }
            )

        send("gpu-health", "system.health", {})
        while True:
            health = receive()
            if health.get("event") == "command.completed" and health.get(
                "request_id"
            ) == "gpu-health":
                break
        health_result = health["data"]["result"]
        if not health_result.get("model_loaded"):
            raise RuntimeError(f"model was not retained between tasks: {health}")

        send("gpu-stop", "worker.shutdown", {})
        while True:
            stopped = receive()
            if stopped.get("event") == "command.completed" and stopped.get(
                "request_id"
            ) == "gpu-stop":
                break
        return_code = process.wait(timeout=30)
        if return_code != 0:
            raise RuntimeError(f"Worker exited with {return_code}")
    finally:
        watchdog.cancel()
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)
        stderr_reader.join(timeout=2)
        (output_dir / "worker-gpu-stderr.log").write_text("".join(stderr_lines), encoding="utf-8")
        (output_dir / "worker-gpu-events.json").write_text(json.dumps(observed, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    model_loading = [
        message for message in observed if message.get("event") == "model.loading"
    ]
    model_ready = [
        message for message in observed if message.get("event") == "model.ready"
    ]
    if len(model_loading) != 1 or len(model_ready) != 1:
        raise RuntimeError(
            "expected exactly one model load for consecutive tasks; "
            f"loading={len(model_loading)}, ready={len(model_ready)}"
        )
    if model_ready[0]["data"]["device"] != "cuda":
        raise RuntimeError(f"Worker did not select CUDA: {model_ready[0]}")

    timings_by_task: dict[str, dict] = {}
    for line in stderr_lines:
        _, marker, value = line.partition(" INFO timing ")
        if not marker:
            continue
        timing = json.loads(value)
        if timing.get("stage") == "transcription.file":
            timings_by_task[timing["task_id"]] = timing
    for row in results:
        row["worker_transcription_timing"] = timings_by_task.get(row["task_id"])
    with wave.open(str(INPUT_PATH), "rb") as media:
        media_seconds = media.getnframes() / media.getframerate()
    report = {
        "python": sys.version,
        "worker_command": worker_command,
        "worker_sha256": sha256(args.worker_executable) if args.worker_executable else None,
        "worker_pid": ready["data"]["pid"],
        "device": model_ready[0]["data"]["device"],
        "model_id": args.model_id or "large-v3-turbo",
        "compute_type": model_ready[0]["data"]["compute_type"],
        "model_loading_events": len(model_loading),
        "model_ready_events": len(model_ready),
        "tasks": results,
        "media_seconds": media_seconds,
        "process_to_worker_ready_seconds": process_to_ready,
        "preload_seconds": preload_seconds,
        "cancelled_preparation": cancelled_preparation,
        "fixture_sha256": sha256(INPUT_PATH),
        "duration_seconds": round(time.perf_counter() - started, 4),
        "stderr": "".join(stderr_lines),
    }
    report_path = output_dir / "worker-gpu-validation.json"
    report_path.write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
