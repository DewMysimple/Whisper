"""Compare media inspection over Worker stdio with the checked-in WAV fixture."""

from __future__ import annotations

import argparse
import json
import shutil
import statistics
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

from whisper_subtitle.worker.media_inspector import MediaInspector

from .run_worker_gpu_validation import INPUT_PATH, command, sha256


def summarize(values: list[float]) -> dict:
    return {
        "n": len(values),
        "median_ms": statistics.median(values),
        "min_ms": min(values),
        "max_ms": max(values),
        "p95_ms": (
            statistics.quantiles(values, n=100, method="inclusive")[94]
            if len(values) >= 30 else None
        ),
        "samples_ms": values,
    }


def inspect_worker(executable: Path | None, copied: list[Path]) -> dict[str, float]:
    program = (
        [str(executable.resolve())] if executable else
        [sys.executable, "-m", "whisper_subtitle", "worker"]
    )
    started = time.perf_counter()
    with subprocess.Popen(
        program, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
        text=True, encoding="utf-8", bufsize=1,
    ) as child:
        watchdog = threading.Timer(20, child.kill)
        watchdog.start()
        assert child.stdin is not None and child.stdout is not None

        def receive() -> dict:
            line = child.stdout.readline()
            if not line:
                raise RuntimeError("Worker exited before benchmark command completed")
            return json.loads(line)

        def send(request_id: str, method: str, params: dict) -> tuple[float, dict, float]:
            began = time.perf_counter()
            first_progress_ms = None
            child.stdin.write(command(request_id, method, params) + "\n")
            child.stdin.flush()
            while True:
                message = receive()
                if message.get("request_id") != request_id:
                    continue
                if message["type"] == "error":
                    raise RuntimeError(message.get("code", "unknown Worker error"))
                if message["event"] == "media.inspection_progress" and first_progress_ms is None:
                    first_progress_ms = (time.perf_counter() - began) * 1000
                if message["event"] == "command.completed":
                    elapsed = (time.perf_counter() - began) * 1000
                    first = elapsed if first_progress_ms is None else first_progress_ms
                    return elapsed, message["data"]["result"], first

        try:
            if receive().get("event") != "worker.ready":
                raise RuntimeError("Worker did not start")
            ready = (time.perf_counter() - started) * 1000
            _, health, _ = send("health", "system.health", {})
            progressive = health.get("media_inspection_version") == 1
            metrics = {"process_to_ready": ready, "progressive": progressive}
            for name, paths in (
                ("first_probe", [INPUT_PATH]),
                ("cache_hit", [INPUT_PATH]),
                ("uncached_copies", copied),
            ):
                params = {"paths": [str(path) for path in paths]}
                if progressive:
                    params["progressive"] = True
                elapsed, result, first = send(name, "media.inspect", params)
                if len(result["items"]) != len(paths) or not all(
                    entry["readable"] and abs(entry["duration_seconds"] - 5.32263) < 0.00001
                    for entry in result["items"]
                ):
                    raise RuntimeError(f"{name} returned incorrect media metadata")
                if progressive and name == "cache_hit" and not result["items"][0]["cache_hit"]:
                    raise RuntimeError("same-process repeat missed cache")
                metrics[name] = elapsed
                if name == "uncached_copies":
                    metrics["first_item_in_copies"] = first
            send("shutdown", "worker.shutdown", {})
            if child.wait(timeout=10) != 0:
                raise RuntimeError("Worker exited with a nonzero code")
            return metrics
        finally:
            watchdog.cancel()
            if child.poll() is None:
                child.kill()


def measure_slots(paths: list[Path], repetitions: int, slots: int) -> list[float]:
    times = []
    for run in range(repetitions):
        inspector = MediaInspector(None, workers=slots)
        try:
            # Each helper opens one WAV before the timed uncached paths.
            warm_paths = paths[:slots]
            inspector.inspect(warm_paths)
            began = time.perf_counter()
            inspections = inspector.inspect(paths[2:])
            times.append((time.perf_counter() - began) * 1000)
            if not all(entry.result.readable for entry in inspections):
                raise RuntimeError(f"slot comparison failed on run {run}")
        finally:
            inspector.close()
    return times


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline-worker", type=Path)
    parser.add_argument("--worker-executable", type=Path)
    parser.add_argument("--samples", type=int, default=30)
    parser.add_argument("--copies", type=int, default=32)
    parser.add_argument("--slot-samples", type=int, default=10)
    args = parser.parse_args()
    if args.samples < 1 or args.copies < 2 or args.slot_samples < 0:
        parser.error("requires at least one sample, two copies and nonnegative slot repetitions")

    versions = [("candidate", args.worker_executable)]
    if args.baseline_worker:
        versions.insert(0, ("baseline", args.baseline_worker))
    results = {name: [] for name, _ in versions}
    with tempfile.TemporaryDirectory(prefix="whisper-media-bench-") as directory:
        workspace = Path(directory)
        copies = []
        for index in range(args.copies + 2):
            dest = workspace / f"短音频 # {index}.wav"
            shutil.copyfile(INPUT_PATH, dest)
            copies.append(dest)
        for index in range(args.samples):
            for name, executable in versions[::1 if index % 2 == 0 else -1]:
                results[name].append(inspect_worker(executable, copies[2:]))
        report = {
            "fixture": INPUT_PATH.name,
            "fixture_sha256": sha256(INPUT_PATH),
            "fixture_bytes": INPUT_PATH.stat().st_size,
            "fixture_duration_seconds": 5.32263,
            "copy_count": args.copies,
            "worker_round_trips": {
                name: {
                    "progressive": samples[0]["progressive"],
                    **{field: summarize([sample[field] for sample in samples]) for field in (
                        "process_to_ready", "first_probe", "cache_hit",
                        "first_item_in_copies", "uncached_copies",
                    )},
                }
                for name, samples in results.items()
            },
        }
        if args.slot_samples:
            report["warmed_probe_slots"] = {
                slots: summarize(measure_slots(copies, args.slot_samples, slots))
                for slots in (1, 2)
            }
        print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
