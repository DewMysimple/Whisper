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


def start_params(preset_id: str, output_root: Path) -> dict:
    return {
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


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--timeout", type=float, default=300.0)
    parser.add_argument("--worker-executable", type=Path)
    parser.add_argument("--model-dir", type=Path)
    args = parser.parse_args()
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
    started = time.perf_counter()
    timed_out = threading.Event()

    def kill_on_timeout() -> None:
        timed_out.set()
        if process.poll() is None:
            process.kill()

    watchdog = threading.Timer(args.timeout, kill_on_timeout)
    watchdog.daemon = True
    watchdog.start()

    def receive() -> dict:
        line = process.stdout.readline()
        if not line:
            if timed_out.is_set():
                raise TimeoutError("GPU validation timed out")
            raise RuntimeError("Worker stdout closed before validation completed")
        message = json.loads(line)
        observed.append(message)
        if message.get("type") == "error":
            raise RuntimeError(f"Worker command error: {message}")
        return message

    def send(request_id: str, method: str, params: dict) -> None:
        process.stdin.write(command(request_id, method, params) + "\n")
        process.stdin.flush()

    results = []
    try:
        ready = receive()
        if ready.get("event") != "worker.ready":
            raise RuntimeError(f"expected worker.ready, received {ready}")

        for preset_id, golden in GOLDENS.items():
            request_id = f"gpu-{preset_id}"
            preset_output = output_dir / preset_id
            send(
                request_id,
                "transcription.start",
                start_params(preset_id, preset_output),
            )
            task_id = None
            while True:
                message = receive()
                if message.get("event") == "task.queued" and message.get(
                    "request_id"
                ) == request_id:
                    task_id = message["task_id"]
                if task_id and message.get("task_id") == task_id and message.get(
                    "event"
                ) in {"task.completed", "task.failed", "task.cancelled"}:
                    if message["event"] != "task.completed":
                        raise RuntimeError(f"task did not complete: {message}")
                    break
            transcript = preset_output / "Text" / f"{INPUT_PATH.stem}.txt"
            actual_hash = normalized_text_sha256(transcript)
            expected_hash = normalized_text_sha256(golden)
            if actual_hash != expected_hash:
                raise RuntimeError(
                    f"{preset_id} golden mismatch: actual={actual_hash}, "
                    f"expected={expected_hash}"
                )
            results.append(
                {
                    "preset_id": preset_id,
                    "task_id": task_id,
                    "output": str(transcript),
                    "normalized_sha256": actual_hash,
                    "raw_sha256": sha256(transcript),
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

    report = {
        "python": sys.version,
        "worker_command": worker_command,
        "worker_pid": ready["data"]["pid"],
        "device": model_ready[0]["data"]["device"],
        "compute_type": model_ready[0]["data"]["compute_type"],
        "model_loading_events": len(model_loading),
        "model_ready_events": len(model_ready),
        "tasks": results,
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
