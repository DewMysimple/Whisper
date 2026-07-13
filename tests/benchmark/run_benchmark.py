"""Generate golden transcripts and a reproducible four-preset benchmark."""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import threading
import time
from datetime import datetime
from pathlib import Path

import psutil
import pynvml

from whisper_subtitle.core.presets import get_preset


PROJECT_ROOT = Path(__file__).resolve().parents[2]
INPUT_PATH = PROJECT_ROOT / "Log" / "执行2" / "baseline" / "regression_input.wav"
BENCHMARK_DIR = PROJECT_ROOT / "tests" / "benchmark"
RUNS_DIR = BENCHMARK_DIR / "runs"
GOLDEN_DIR = PROJECT_ROOT / "tests" / "golden"
BASELINE_PATH = BENCHMARK_DIR / "baseline.json"
PARAMETERS_PATH = GOLDEN_DIR / "parameters.json"
CLI_PATH = PROJECT_ROOT / "whisper_env" / "Scripts" / "whisper-subtitle.exe"

PRESET_IDS = {
    "en": "en_v1",
    "en2": "en_v2",
    "cn": "cn",
    "cn2": "cn2",
}


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest().upper()


def process_tree_rss(process: psutil.Process) -> int:
    total = 0
    for current in [process, *process.children(recursive=True)]:
        try:
            total += current.memory_info().rss
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue
    return total


def gpu_process_memory(handle, pids: set[int]) -> int | None:
    """Return process VRAM bytes when NVML exposes it under the Windows driver."""
    query = None
    for name in (
        "nvmlDeviceGetComputeRunningProcesses_v3",
        "nvmlDeviceGetComputeRunningProcesses_v2",
        "nvmlDeviceGetComputeRunningProcesses",
    ):
        query = getattr(pynvml, name, None)
        if query is not None:
            break
    if query is None:
        return None

    try:
        values = []
        unavailable = getattr(pynvml, "NVML_VALUE_NOT_AVAILABLE", None)
        for info in query(handle):
            if info.pid not in pids:
                continue
            used = getattr(info, "usedGpuMemory", None)
            if used is None or used == unavailable or used < 0:
                return None
            values.append(int(used))
        return sum(values) if values else None
    except pynvml.NVMLError:
        return None


def run_preset(preset_name: str, handle) -> dict:
    run_dir = RUNS_DIR / preset_name
    if run_dir.exists():
        shutil.rmtree(run_dir)
    run_dir.mkdir(parents=True)

    command = [
        str(CLI_PATH),
        "transcribe",
        str(INPUT_PATH),
        "-o",
        str(run_dir),
        "--preset",
        preset_name,
    ]
    environment = os.environ.copy()
    environment["PYTHONIOENCODING"] = "utf-8"
    environment["PYTHONUNBUFFERED"] = "1"

    baseline_gpu = int(pynvml.nvmlDeviceGetMemoryInfo(handle).used)
    started = time.perf_counter()
    process = subprocess.Popen(
        command,
        cwd=PROJECT_ROOT,
        env=environment,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
        bufsize=1,
    )
    ps_process = psutil.Process(process.pid)
    stop_sampling = threading.Event()
    samples = {
        "peak_rss": 0,
        "peak_device_gpu": baseline_gpu,
        "peak_process_gpu": None,
    }

    def sample_resources() -> None:
        while not stop_sampling.is_set():
            try:
                samples["peak_rss"] = max(
                    samples["peak_rss"], process_tree_rss(ps_process)
                )
                device_used = int(pynvml.nvmlDeviceGetMemoryInfo(handle).used)
                samples["peak_device_gpu"] = max(
                    samples["peak_device_gpu"], device_used
                )
                pids = {process.pid}
                try:
                    pids.update(child.pid for child in ps_process.children(recursive=True))
                except (psutil.NoSuchProcess, psutil.AccessDenied):
                    pass
                process_used = gpu_process_memory(handle, pids)
                if process_used is not None:
                    samples["peak_process_gpu"] = max(
                        samples["peak_process_gpu"] or 0, process_used
                    )
            except (psutil.NoSuchProcess, pynvml.NVMLError):
                pass
            stop_sampling.wait(0.05)

    sampler = threading.Thread(target=sample_resources, daemon=True)
    sampler.start()

    events: dict[str, float] = {}
    output_lines: list[str] = []
    assert process.stdout is not None
    for line in process.stdout:
        now = time.perf_counter()
        output_lines.append(line)
        if "正在加载 Whisper" in line and "model_load_start" not in events:
            events["model_load_start"] = now
        elif "模型加载完成" in line and "model_load_end" not in events:
            events["model_load_end"] = now
        elif "正在处理:" in line and "transcription_start" not in events:
            events["transcription_start"] = now
        elif "完成输出:" in line and "output_written" not in events:
            events["output_written"] = now

    return_code = process.wait()
    finished = time.perf_counter()
    stop_sampling.set()
    sampler.join(timeout=2)
    (run_dir / "benchmark.log").write_text("".join(output_lines), encoding="utf-8")

    if return_code != 0:
        raise RuntimeError(
            f"preset {preset_name} exited with {return_code}; "
            f"see {run_dir / 'benchmark.log'}"
        )
    required_events = {
        "model_load_start",
        "model_load_end",
        "transcription_start",
        "output_written",
    }
    missing = required_events.difference(events)
    if missing:
        raise RuntimeError(f"preset {preset_name} missing log events: {sorted(missing)}")

    transcript = run_dir / f"{INPUT_PATH.stem}.txt"
    if not transcript.is_file() or transcript.stat().st_size == 0:
        raise RuntimeError(f"preset {preset_name} produced no transcript")
    golden = GOLDEN_DIR / f"{preset_name}_output.txt"
    shutil.copyfile(transcript, golden)

    peak_process_gpu = samples["peak_process_gpu"]
    peak_device_delta = max(0, samples["peak_device_gpu"] - baseline_gpu)
    if peak_process_gpu is not None:
        peak_gpu = peak_process_gpu
        gpu_method = "NVML compute-process usedGpuMemory"
    else:
        peak_gpu = peak_device_delta
        gpu_method = "NVML device-used delta (process metric unavailable)"

    preset = get_preset(PRESET_IDS[preset_name])
    return {
        "preset_id": preset["id"],
        "script": preset["script"],
        "model": "Whisper Large-V3-Turbo",
        "params": preset["params"],
        "postprocess": preset["postprocess"],
        "metrics": {
            "startup_to_model_load_start_seconds": round(
                events["model_load_start"] - started, 4
            ),
            "startup_to_model_ready_seconds": round(
                events["model_load_end"] - started, 4
            ),
            "model_load_seconds": round(
                events["model_load_end"] - events["model_load_start"], 4
            ),
            "transcription_to_output_seconds": round(
                events["output_written"] - events["transcription_start"], 4
            ),
            "total_process_seconds": round(finished - started, 4),
            "peak_process_memory_mib": round(samples["peak_rss"] / 1024**2, 2),
            "peak_gpu_memory_mib": round(peak_gpu / 1024**2, 2),
            "peak_gpu_device_used_mib": round(
                samples["peak_device_gpu"] / 1024**2, 2
            ),
            "gpu_baseline_used_mib": round(baseline_gpu / 1024**2, 2),
            "gpu_measurement_method": gpu_method,
        },
        "output": {
            "path": golden.relative_to(PROJECT_ROOT).as_posix(),
            "bytes": golden.stat().st_size,
            "sha256": sha256(golden),
        },
    }


def main() -> int:
    if not CLI_PATH.is_file():
        raise FileNotFoundError(f"CLI not found: {CLI_PATH}")
    if not INPUT_PATH.is_file():
        raise FileNotFoundError(f"input not found: {INPUT_PATH}")

    GOLDEN_DIR.mkdir(parents=True, exist_ok=True)
    RUNS_DIR.mkdir(parents=True, exist_ok=True)
    pynvml.nvmlInit()
    try:
        handle = pynvml.nvmlDeviceGetHandleByIndex(0)
        gpu_name = pynvml.nvmlDeviceGetName(handle)
        if isinstance(gpu_name, bytes):
            gpu_name = gpu_name.decode("utf-8", errors="replace")
        results = {}
        for preset_name in PRESET_IDS:
            print(f"benchmarking {preset_name}...", flush=True)
            results[preset_name] = run_preset(preset_name, handle)

        document = {
            "schema_version": 1,
            "generated_at": datetime.now().astimezone().isoformat(timespec="seconds"),
            "input": {
                "path": INPUT_PATH.relative_to(PROJECT_ROOT).as_posix(),
                "bytes": INPUT_PATH.stat().st_size,
                "sha256": sha256(INPUT_PATH),
            },
            "environment": {
                "gpu": str(gpu_name),
                "measurement_runs_per_preset": 1,
                "resource_sample_interval_seconds": 0.05,
            },
            "presets": results,
        }
        BASELINE_PATH.write_text(
            json.dumps(document, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        PARAMETERS_PATH.write_text(
            json.dumps(
                {
                    name: {
                        "preset_id": data["preset_id"],
                        "script": data["script"],
                        "model": data["model"],
                        "params": data["params"],
                        "postprocess": data["postprocess"],
                    }
                    for name, data in results.items()
                },
                ensure_ascii=False,
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )
    finally:
        pynvml.nvmlShutdown()

    print(f"wrote {BASELINE_PATH}")
    print(f"wrote {PARAMETERS_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
