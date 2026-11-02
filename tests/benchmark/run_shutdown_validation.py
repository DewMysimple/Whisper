"""Explicit real-model shutdown regression; never launched by the unit suite.

Runs each backend in its own Worker, transcribes the fixed short fixture, then
measures graceful command/EOF exit, idle CPU, memory, threads and descendants.
Only processes created by this tool are inspected or cleaned up. Reports remain
under --output-dir, including diagnostics when a case fails.
"""

from __future__ import annotations

import argparse
import ctypes
from dataclasses import asdict
import json
import os
from pathlib import Path
import queue
import subprocess
import sys
import threading
import time

import psutil

from whisper_subtitle.domain.subtitles import SubtitleOptions
from whisper_subtitle.protocol import parse_protocol_line


ROOT = Path(__file__).resolve().parents[2]
MODELS = ("large-v3-turbo", "qwen3-asr-0.6b", "qwen3-asr-1.7b")
WINDOWS = os.name == "nt"


def _wait_for_windows_handle(handle: int, timeout: float) -> bool:
    """Check kernel teardown, which can lag behind GetExitCodeProcess."""
    from ctypes import wintypes

    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    wait = kernel32.WaitForSingleObject
    wait.argtypes = (wintypes.HANDLE, wintypes.DWORD)
    wait.restype = wintypes.DWORD
    result = wait(handle, min(0xFFFFFFFE, max(0, int(timeout * 1000))))
    if result == 0:  # WAIT_OBJECT_0: all process threads finished teardown.
        return True
    if result == 258:  # WAIT_TIMEOUT
        return False
    raise ctypes.WinError(ctypes.get_last_error())


def wait_for_exit(process: subprocess.Popen, timeout: float) -> bool:
    """Do not treat poll()/an exit code as proof of Windows process removal."""
    if WINDOWS:
        # Popen owns this handle until its object is released. No PID lookup or
        # OpenProcess race can accidentally target a reused/unrelated process.
        signaled = _wait_for_windows_handle(int(process._handle), timeout)
        if signaled:
            process.poll()
        return signaled
    try:
        process.wait(timeout=timeout)
        return True
    except subprocess.TimeoutExpired:
        return False


def cleanup_worker(process: subprocess.Popen, errors: list[str]) -> dict:
    """Bound cleanup and retain evidence even if kernel teardown rejects kill."""
    diagnostics = {}
    try:
        signaled = wait_for_exit(process, 0)
        diagnostics["worker_exit_signaled_before_cleanup"] = signaled
        if not signaled:
            errors.append("Worker process handle remained unsignaled after shutdown")
            try:
                process.kill()
            except Exception as exc:
                errors.append(f"Worker kill failed: {type(exc).__name__}: {exc}")
            signaled = wait_for_exit(process, 2)
        diagnostics["worker_exit_signaled_after_cleanup"] = signaled
        diagnostics["worker_remaining_after_cleanup"] = not signaled
        diagnostics["return_code"] = process.returncode
        if not signaled:
            errors.append("Worker kernel teardown remained incomplete after bounded cleanup")
    except Exception as exc:
        errors.append(f"Worker cleanup failed: {type(exc).__name__}: {exc}")
        diagnostics["worker_remaining_after_cleanup"] = None
    return diagnostics


def run_case(args, model: str, exit_method: str) -> dict:
    output = args.output_dir / f"{model}-{exit_method}"
    output.mkdir(parents=True, exist_ok=True)
    command = (
        [str(args.worker_executable.resolve())]
        if args.worker_executable
        else [sys.executable, "-m", "whisper_subtitle", "worker"]
    )
    env = dict(
        os.environ,
        PYTHONIOENCODING="utf-8",
        PYTHONUNBUFFERED="1",
        HF_HUB_OFFLINE="1",
        TRANSFORMERS_OFFLINE="1",
        WHISPER_SUBTITLE_MODEL_DIR=str(args.model_dir.resolve()),
    )
    process = subprocess.Popen(
        command, cwd=output, env=env, stdin=subprocess.PIPE,
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
        encoding="utf-8", bufsize=1,
        creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
    )
    worker = psutil.Process(process.pid)
    descendants: dict[int, psutil.Process] = {}
    samples = []
    events = []
    errors = []
    lines: queue.Queue[str | None] = queue.Queue()
    stderr: list[str] = []
    stop_sampling = threading.Event()
    started = time.monotonic()
    phase = "transcription"

    def read_stdout():
        try:
            for line in process.stdout:
                lines.put(line)
        finally:
            lines.put(None)

    def sample():
        previous = time.monotonic()
        while not stop_sampling.is_set():
            now = time.monotonic()
            snapshot = {
                "seconds": round(now - started, 4), "phase": phase,
                "sample_gap_seconds": round(now - previous, 4),
                "system_cpu_percent": psutil.cpu_percent(),
                "system_available_memory_bytes": psutil.virtual_memory().available,
            }
            previous = now
            try:
                with worker.oneshot():
                    cpu = worker.cpu_times()
                    snapshot.update(
                        worker_cpu_seconds=cpu.user + cpu.system,
                        worker_rss_bytes=worker.memory_info().rss,
                        worker_threads=worker.num_threads(),
                    )
                for child in worker.children(recursive=True):
                    descendants.setdefault(child.pid, child)
            except psutil.NoSuchProcess:
                pass
            except psutil.AccessDenied as exc:
                snapshot["sample_error"] = str(exc)
            samples.append(snapshot)
            stop_sampling.wait(0.1)

    stdout_reader = threading.Thread(target=read_stdout, daemon=True)
    stderr_reader = threading.Thread(target=lambda: stderr.extend(process.stderr), daemon=True)
    sampler = threading.Thread(target=sample, daemon=True)
    stdout_reader.start()
    stderr_reader.start()
    sampler.start()

    def receive(deadline: float) -> dict:
        try:
            line = lines.get(timeout=max(0.001, deadline - time.monotonic()))
        except queue.Empty as exc:
            raise TimeoutError("Worker event deadline exceeded") from exc
        if line is None:
            raise RuntimeError("Worker stdout closed before the expected event")
        parse_protocol_line(line)
        event = json.loads(line)
        events.append(event)
        if event.get("type") == "error":
            raise RuntimeError(str(event))
        return event

    def send(request: str, method: str, params: dict):
        process.stdin.write(json.dumps({
            "schema_version": 1, "type": "command", "request_id": request,
            "method": method, "params": params,
        }, ensure_ascii=False) + "\n")
        process.stdin.flush()

    report = {"model": model, "exit_method": exit_method, "worker_pid": process.pid}
    shutdown_cpu_baseline: float | None = None
    try:
        deadline = time.monotonic() + args.task_timeout
        if receive(deadline).get("event") != "worker.ready":
            raise RuntimeError("Expected worker.ready")
        send("transcribe", "transcription.start", {
            "model_id": model,
            "inputs": [{"path": str(ROOT / "tests/fixtures/chinese_short.wav"),
                        "kind": "file", "origin": "manual"}],
            "profile": {"base_preset_id": "cn", "overrides": {}},
            "output": {
                "mode": "custom", "root_directory": str(output),
                "txt": {"enabled": True}, "markdown": {"enabled": False},
                "srt": {"enabled": model != "large-v3-turbo"},
                "subtitle": asdict(SubtitleOptions()),
                "preserve_source_txt": False, "conflict_policy": "overwrite",
            },
        })
        while True:
            event = receive(deadline)
            if event.get("event") in {"task.completed", "task.failed", "task.cancelled"}:
                if event["event"] != "task.completed" or event["data"]["failure_count"]:
                    raise RuntimeError(str(event))
                if event["data"]["success_count"] != 1:
                    raise RuntimeError("No successful media")
                break
        report["transcription_seconds"] = round(time.monotonic() - started, 4)
        phase = "idle"
        cpu_before = worker.cpu_times()
        idle_started = time.monotonic()
        stop_sampling.wait(args.idle_seconds)
        cpu_after = worker.cpu_times()
        report["idle_cpu_core_percent"] = round(
            100 * (cpu_after.user + cpu_after.system - cpu_before.user - cpu_before.system)
            / (time.monotonic() - idle_started), 3,
        )
        phase = "shutdown"
        cpu = worker.cpu_times()
        shutdown_cpu_baseline = cpu.user + cpu.system
        shutdown_started = time.monotonic()
        if exit_method == "command":
            send("stop", "worker.shutdown", {})
        else:
            process.stdin.close()
        signaled = wait_for_exit(process, args.shutdown_timeout)
        report["worker_exit_signaled"] = signaled
        # Retain the potentially misleading exit code alongside the independent
        # kernel-handle result so incomplete teardown remains diagnosable.
        report["reported_exit_code"] = process.poll()
        report["return_code"] = process.returncode
        if not signaled:
            errors.append(f"Shutdown exceeded {args.shutdown_timeout} seconds")
        report["shutdown_seconds"] = round(time.monotonic() - shutdown_started, 4)
        if process.returncode not in {None, 0}:
            errors.append(f"Worker exited with {process.returncode}")
        if exit_method == "command" and signaled and process.returncode == 0:
            stdout_reader.join(timeout=2)
            while not lines.empty():
                line = lines.get_nowait()
                if line is not None:
                    parse_protocol_line(line)
                    events.append(json.loads(line))
            if not any(e.get("event") == "command.completed" and e.get("request_id") == "stop" for e in events):
                errors.append("Shutdown acknowledgement missing")
    except Exception as exc:
        errors.append(f"{type(exc).__name__}: {exc}")
    finally:
        report.update(cleanup_worker(process, errors))
        stop_sampling.set()
        sampler.join(timeout=2)
        stdout_reader.join(timeout=2)
        stderr_reader.join(timeout=2)
        survivors = []
        for child in descendants.values():
            try:
                if child.is_running():
                    survivors.append(child)
            except Exception as exc:
                errors.append(f"Descendant {child.pid} inspection failed: {exc}")
        report["observed_descendant_pids"] = sorted(descendants)
        report["remaining_descendant_pids"] = [child.pid for child in survivors]
        if survivors:
            errors.append("Worker descendants remained after shutdown")
            for child in survivors:
                try:
                    child.kill()
                except psutil.NoSuchProcess:
                    pass
                except Exception as exc:
                    errors.append(f"Descendant {child.pid} kill failed: {exc}")
            # is_running checks existence, whereas wait()/exit codes alone can
            # report success while a Windows kernel teardown thread remains.
            deadline = time.monotonic() + 2
            while survivors and time.monotonic() < deadline:
                try:
                    survivors = [child for child in survivors if child.is_running()]
                except Exception as exc:
                    errors.append(f"Descendant cleanup inspection failed: {exc}")
                    break
                if survivors:
                    time.sleep(0.05)
        report["remaining_descendant_pids_after_cleanup"] = [child.pid for child in survivors]
        report["peak_worker_rss_bytes"] = max((s.get("worker_rss_bytes", 0) for s in samples), default=0)
        report["peak_worker_threads"] = max((s.get("worker_threads", 0) for s in samples), default=0)
        shutdown_samples = [s for s in samples if s["phase"] == "shutdown"]
        observed_cpu = [s["worker_cpu_seconds"] for s in shutdown_samples if "worker_cpu_seconds" in s]
        report["shutdown_cpu_seconds_observed"] = (
            round(max(0, max(observed_cpu) - shutdown_cpu_baseline), 4)
            if observed_cpu and shutdown_cpu_baseline is not None else None
        )
        report["peak_shutdown_worker_rss_bytes"] = max((s.get("worker_rss_bytes", 0) for s in shutdown_samples), default=0)
        report["peak_shutdown_worker_threads"] = max((s.get("worker_threads", 0) for s in shutdown_samples), default=0)
        report["minimum_shutdown_available_memory_bytes"] = min((s["system_available_memory_bytes"] for s in shutdown_samples), default=None)
        report["max_shutdown_sample_gap_seconds"] = max((s["sample_gap_seconds"] for s in shutdown_samples), default=0)
        report["errors"] = errors
        (output / "stderr.log").write_text("".join(stderr), encoding="utf-8")
        (output / "events.json").write_text(json.dumps(events, ensure_ascii=False, indent=2), encoding="utf-8")
        (output / "samples.json").write_text(json.dumps(samples, indent=2), encoding="utf-8")
        (output / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--model-dir", type=Path, required=True)
    parser.add_argument("--worker-executable", type=Path)
    parser.add_argument("--models", nargs="+", choices=MODELS, default=list(MODELS))
    parser.add_argument("--exit-methods", nargs="+", choices=("command", "eof"), default=["command", "eof"])
    parser.add_argument("--task-timeout", type=float, default=300)
    parser.add_argument("--shutdown-timeout", type=float, default=15)
    parser.add_argument("--idle-seconds", type=float, default=2)
    args = parser.parse_args()
    for name in ("task_timeout", "shutdown_timeout", "idle_seconds"):
        if getattr(args, name) <= 0:
            parser.error(f"--{name.replace('_', '-')} must be positive")
    args.output_dir = args.output_dir.resolve()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    reports = []
    for model in args.models:
        for method in args.exit_methods:
            report = run_case(args, model, method)
            reports.append(report)
            print(json.dumps(report, ensure_ascii=False), flush=True)
            (args.output_dir / "shutdown-validation.json").write_text(
                json.dumps(reports, ensure_ascii=False, indent=2), encoding="utf-8",
            )
            if report["errors"]:
                # A stuck teardown may already be consuming a kernel core.
                # Never accumulate more real-model processes after failure.
                return 1
    return 1 if any(report["errors"] for report in reports) else 0


if __name__ == "__main__":
    raise SystemExit(main())
