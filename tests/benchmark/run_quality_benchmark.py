"""Explicit offline corpus evaluation via the production Worker, beside existing goldens.

Run as python -m tests.benchmark.run_quality_benchmark --help. Never writes inputs.
"""
from __future__ import annotations

import argparse
from dataclasses import asdict
import hashlib
from importlib.metadata import PackageNotFoundError, version
import json
import os
from pathlib import Path
import platform
import queue
import re
import subprocess
import sys
import threading
import time
import wave

import psutil
import pynvml

from tests.benchmark.quality_metrics import compare_reports, srt_cues, text_metrics, timing_metrics
from tests.benchmark.run_benchmark import process_tree_rss, gpu_process_memory
from tests.benchmark.run_worker_gpu_validation import command
from tests.benchmark.run_shutdown_validation import wait_for_exit
from whisper_subtitle.domain.models import ASSETS_BY_ID, SUPPORTED_MODEL_IDS
from whisper_subtitle.domain.presets import derive_preset
from whisper_subtitle.domain.subtitles import SubtitleOptions
from whisper_subtitle.paths import AppPaths
from whisper_subtitle.protocol import parse_protocol_line
from whisper_subtitle.worker.media import default_media_duration_probe

ROOT = Path(__file__).resolve().parents[2]


def digest(path: Path) -> str:
    sha = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024*1024), b""):
            sha.update(block)
    return sha.hexdigest()


def load_samples(path: Path) -> list[dict]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if value.get("schema_version") != 1 or not isinstance(value.get("samples"), list):
        raise ValueError("Invalid corpus manifest")
    seen = set()
    for sample in value["samples"]:
        name = sample["id"]
        if not re.fullmatch(r"[a-z0-9-]+", name) or name in seen:
            raise ValueError("Sample IDs must be unique safe slugs")
        seen.add(name)
        if sample.get("reference_text") is not None and not isinstance(sample["reference_text"], str):
            raise ValueError("reference_text must be text or null")
        seconds = sample.get("generate_silence_seconds")
        if seconds is not None and (type(seconds) is not int or not 1 <= seconds <= 10800):
            raise ValueError("Generated silence must be 1..10800 seconds")
        if sample.get("path"):
            sample["resolved_path"] = (path.parent / sample["path"]).resolve()
    return value["samples"]


def checkpoint_fingerprint(model_dir: Path, model: str) -> dict:
    location = AppPaths.discover(explicit_model_dir=model_dir).model_location
    assets = [model]
    if ASSETS_BY_ID[model].companion_id:
        assets.append(ASSETS_BY_ID[model].companion_id)
    return {asset: {file.name: digest(file) for file in sorted(location.require_model(asset).iterdir())
                    if file.is_file() and file.suffix in {".json", ".bin", ".safetensors", ".jinja"}}
            for asset in assets}


def run_sample(args, sample: dict, model: str, output: Path, gpu) -> dict:
    output.mkdir(parents=True, exist_ok=False)
    media = sample.get("resolved_path")
    if sample.get("generate_silence_seconds"):
        media = output / "silence.wav"
        with wave.open(str(media), "wb") as wav:
            wav.setparams((1, 2, 16000, 0, "NONE", "not compressed"))
            for _ in range(sample["generate_silence_seconds"]):
                wav.writeframes(bytes(32000))
    if media is None or not media.is_file():
        return {"sample_id": sample["id"], "model_id": model, "status": "blocked",
                "reason": "Missing authorized corpus media"}
    reference = sample.get("reference_text")
    preset = derive_preset(sample["preset_id"], {}, model_id=model)
    _valid_media, duration, _duration_error = default_media_duration_probe(media)
    result = {"sample_id": sample["id"], "model_id": model, "category": sample["category"],
              "input_sha256": digest(media), "reference_sha256": hashlib.sha256(
                  json.dumps([reference, sample.get("reference_spans", [])], ensure_ascii=False).encode()).hexdigest(),
              "preset_id": preset.id, "parameters": {**preset.transcription_options(), "word_timestamps": True},
              "subtitle_options": asdict(SubtitleOptions()), "status": "failed"}
    env = dict(os.environ, PYTHONIOENCODING="utf-8", PYTHONUNBUFFERED="1", HF_HUB_OFFLINE="1",
               TRANSFORMERS_OFFLINE="1", WHISPER_SUBTITLE_MODEL_DIR=str(args.model_dir.resolve()))
    cmd = [str(args.worker_executable.resolve())] if args.worker_executable else [sys.executable, "-m", "whisper_subtitle", "worker"]
    started = time.monotonic()
    stderr_file = (output / "worker.log").open("w", encoding="utf-8")
    process = subprocess.Popen(cmd, cwd=output, env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                               stderr=stderr_file, text=True, encoding="utf-8",
                               creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
    lines = queue.Queue()
    peak = {"rss": 0, "device_gpu": None, "process_gpu": None}
    stop = threading.Event()
    def read():
        for line in process.stdout:
            lines.put(line)
        lines.put(None)
    def sample_resources():
        worker = psutil.Process(process.pid)
        while not stop.is_set():
            try:
                peak["rss"] = max(peak["rss"], process_tree_rss(worker))
                if gpu is not None:
                    peak["device_gpu"] = max(peak["device_gpu"] or 0, pynvml.nvmlDeviceGetMemoryInfo(gpu).used)
                    used = gpu_process_memory(gpu, {worker.pid, *(child.pid for child in worker.children(recursive=True))})
                    if used is not None:
                        peak["process_gpu"] = max(peak["process_gpu"] or 0, used)
            except (psutil.Error, pynvml.NVMLError):
                pass
            stop.wait(.05)
    reader = threading.Thread(target=read, daemon=True)
    sampler = threading.Thread(target=sample_resources, daemon=True)
    reader.start()
    sampler.start()
    deadline = started + args.timeout
    def receive():
        line = lines.get(timeout=max(.001, deadline-time.monotonic()))
        if line is None:
            raise RuntimeError("Worker closed stdout; see local worker.log")
        parse_protocol_line(line)
        message = json.loads(line)
        if message.get("type") == "error":
            raise RuntimeError(str(message))
        return message
    def send(request, method, params):
        process.stdin.write(command(request, method, params) + "\n")
        process.stdin.flush()
    try:
        if receive().get("event") != "worker.ready":
            raise RuntimeError("Worker handshake failed")
        send("quality", "transcription.start", {"model_id": model,
            "inputs": [{"path": str(media), "kind": "file", "origin": "manual"}],
            "profile": {"base_preset_id": preset.id, "overrides": {}},
            "output": {"mode": "custom", "root_directory": str(output),
                       "txt": {"enabled": True}, "markdown": {"enabled": True},
                       "srt": {"enabled": True}, "subtitle": asdict(SubtitleOptions()),
                       "preserve_source_txt": False, "conflict_policy": "fail"}})
        while True:
            event = receive()
            if event.get("event") in {"task.completed", "task.failed", "task.cancelled"}:
                if event["event"] != "task.completed" or event["data"]["failure_count"]:
                    raise RuntimeError(str(event))
                break
        elapsed = time.monotonic()-started
        paths = [Path(p) for p in event["data"]["outputs"]]
        if {p.suffix for p in paths} != {".txt", ".md", ".srt"}:
            raise RuntimeError("Incomplete output formats")
        text = next(p for p in paths if p.suffix == ".txt").read_text(encoding="utf-8")
        cues = srt_cues(next(p for p in paths if p.suffix == ".srt").read_text(encoding="utf-8"))
        result.update(status="completed", transcript=text, metrics={
            **text_metrics(reference, text), **timing_metrics(sample.get("reference_spans", []), cues),
            "duration_seconds": duration, "total_seconds": elapsed,
            "audio_seconds_per_wall_second": duration/elapsed if duration else None,
            "peak_rss_mib": peak["rss"]/1024**2,
            "peak_gpu_process_mib": peak["process_gpu"]/1024**2 if peak["process_gpu"] is not None else None,
            "peak_gpu_device_mib": peak["device_gpu"]/1024**2 if peak["device_gpu"] is not None else None})
    except Exception as exc:
        result["reason"] = str(exc)
    finally:
        try:
            send("shutdown", "worker.shutdown", {})
        except (OSError, ValueError):
            pass
        if not wait_for_exit(process, 30):
            # Contain only this explicit benchmark child after a bounded graceful exit.
            process.kill()
            result.update(status="failed", reason="Worker shutdown timed out")
            if not wait_for_exit(process, 10):
                raise RuntimeError("Worker teardown stuck; stop benchmark and preserve diagnostics")
        stop.set()
        sampler.join(2)
        reader.join(2)
        stderr_file.close()
    return result


def markdown(report: dict) -> str:
    rows = ["# Audio quality benchmark", "", "Cold Worker per sample; includes model load. Lower error/offset is better.",
            "GPU device peak includes other applications; unavailable metrics are null, not zero.", "",
            "| Sample | Model | Status | CER | WER | Unexpected text units | Seconds | RSS MiB |",
            "| --- | --- | --- | --- | --- | --- | --- | --- |"]
    for row in report["results"]:
        metrics = row.get("metrics", {})
        values = [row["sample_id"], row["model_id"], row["status"], *(
            metrics.get(k) for k in ("cer", "wer", "unexpected_text_units", "total_seconds", "peak_rss_mib"))]
        rows.append("| " + " | ".join("unmeasured" if v is None else f"{v:.4f}" if isinstance(v, float) else str(v) for v in values) + " |")
    rows.extend(["", "## Per-sample comparison", "", "```json", json.dumps(report.get("comparison", []), ensure_ascii=False, indent=2), "```", ""])
    return "\n".join(rows)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=ROOT / "tests/benchmark/quality_corpus.json")
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--model-dir", type=Path, required=True)
    parser.add_argument("--worker-executable", type=Path)
    parser.add_argument("--models", nargs="+", choices=SUPPORTED_MODEL_IDS, default=["large-v3-turbo", "qwen3-asr-0.6b", "qwen3-asr-1.7b"])
    parser.add_argument("--baseline", type=Path)
    parser.add_argument("--timeout", type=float, default=1800)
    args = parser.parse_args()
    if args.timeout <= 0:
        parser.error("--timeout must be positive")
    samples = load_samples(args.manifest)
    args.output_dir = args.output_dir.resolve()
    args.output_dir.mkdir(parents=True, exist_ok=False)
    packages = {}
    for package in ("faster-whisper", "ctranslate2", "torch", "transformers", "av"):
        try:
            packages[package] = version(package)
        except PackageNotFoundError:
            packages[package] = None
    report = {"schema_version": 1, "code_revision": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(),
              "dirty_worktree": bool(subprocess.check_output(["git", "status", "--porcelain", "--untracked-files=no"], cwd=ROOT)),
              "environment": {"scope": "benchmark runner; frozen Worker dependencies are identified by worker_sbom_sha256",
                              "python": platform.python_version(), "platform": platform.platform(), "packages": packages},
              "model_fingerprints": {}, "worker_sha256": digest(args.worker_executable) if args.worker_executable else None,
              "results": []}
    if args.worker_executable:
        sbom = args.worker_executable.resolve().parents[1] / "distribution/sbom-python.cdx.json"
        report["worker_sbom_sha256"] = digest(sbom) if sbom.is_file() else None
    gpu = None
    initialized = False
    try:
        try:
            pynvml.nvmlInit()
            initialized = True
            gpu = pynvml.nvmlDeviceGetHandleByIndex(0)
            report["environment"].update(gpu_name=pynvml.nvmlDeviceGetName(gpu), driver=pynvml.nvmlSystemGetDriverVersion())
        except pynvml.NVMLError:
            pass
        for model in args.models:
            model_error = None
            try:
                report["model_fingerprints"][model] = checkpoint_fingerprint(args.model_dir, model)
            except FileNotFoundError:
                model_error = "Missing complete local model or shared aligner"
            for sample in samples:
                row = ({"sample_id": sample["id"], "model_id": model, "status": "blocked", "reason": model_error}
                       if model_error else run_sample(args, sample, model, args.output_dir / model / sample["id"], gpu))
                report["results"].append(row)
                if args.baseline:
                    report["comparison"] = compare_reports(json.loads(args.baseline.read_text(encoding="utf-8")), report)
                (args.output_dir / "quality.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
                (args.output_dir / "quality.md").write_text(markdown(report), encoding="utf-8")
                print(f"{model} {sample['id']}: {row['status']}", flush=True)
                if row["status"] == "failed":
                    return 1
    finally:
        if initialized:
            pynvml.nvmlShutdown()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
