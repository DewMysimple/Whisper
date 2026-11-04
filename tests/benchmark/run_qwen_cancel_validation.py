"""Explicit real CUDA WorkerRuntime cancellation after three generated tokens.

The test-only criterion sends the normal cancel command; production criteria then
observe the same task Event. No production hook or inference parameter is added.
"""
from __future__ import annotations

import argparse
from dataclasses import asdict
import json
import os
from pathlib import Path
import time

from whisper_subtitle.bootstrap import configure_runtime
from whisper_subtitle.domain.subtitles import SubtitleOptions
from whisper_subtitle.infrastructure.engines import load_engine
from whisper_subtitle.protocol import CommandMessage, CommandMethod, EventCode, EventMessage, validate_task_event_sequence
from whisper_subtitle.worker.runtime import WorkerRuntime

ROOT = Path(__file__).resolve().parents[2]


def run_model(model, model_dir, output):
    events, loads = [], []
    state = {"task": "", "cancel": True, "tokens": 0, "cancel_at": None}
    def emit(message):
        events.append(message)
    def load(hardware, location, model_id):
        loads.append(model_id)
        if hardware.device != "cuda":
            raise RuntimeError("This acceptance requires a real CUDA device")
        engine = load_engine(hardware, location, model_id)
        original = engine._model.generate
        class TriggerCancel(engine._transformers.StoppingCriteria):
            def __call__(self, input_ids, scores, **kwargs):
                state["tokens"] += 1
                if state["tokens"] == 3:
                    state["cancel_at"] = time.monotonic()
                    runtime.handle_command(CommandMessage("cancel", CommandMethod.TRANSCRIPTION_CANCEL, {"task_id": state["task"]}))
                return engine._torch.full((input_ids.shape[0],), False, dtype=engine._torch.bool, device=input_ids.device)
        def generate(**kwargs):
            if state["cancel"]:
                kwargs["stopping_criteria"].append(TriggerCancel())
            return original(**kwargs)
        engine._model.generate = generate
        return engine
    ids = iter(f"{model}-{i}" for i in range(4))
    runtime = WorkerRuntime(emit, runtime_configurer=lambda: configure_runtime(model_dir=model_dir),
                            engine_loader=load, task_id_factory=lambda: next(ids), idle_timeout_seconds=300)
    reports = []
    try:
        for i in range(4):
            target = output / f"{model}-{i}"
            target.mkdir(parents=True, exist_ok=False)
            state.update(task=f"{model}-{i}", cancel=i < 3, tokens=0, cancel_at=None)
            runtime.handle_command(CommandMessage(f"start-{i}", CommandMethod.TRANSCRIPTION_START, {
                "model_id": model,
                "inputs": [{"path": str(ROOT / "tests/fixtures/chinese_short.wav"), "kind": "file", "origin": "manual"}],
                "profile": {"base_preset_id": "cn", "overrides": {}},
                "output": {"mode": "custom", "root_directory": str(target), "txt": {"enabled": True},
                    "markdown": {"enabled": True}, "srt": {"enabled": True}, "subtitle": asdict(SubtitleOptions()),
                    "preserve_source_txt": False, "conflict_policy": "fail"}}))
            if not runtime.wait_until_idle(timeout=180):
                raise RuntimeError("Qwen cancellation task did not become idle")
            sequence = [e for e in events if isinstance(e, EventMessage) and e.task_id == state["task"] and e.event.value.startswith("task.")]
            validate_task_event_sequence(sequence)
            expected = EventCode.TASK_CANCELLED if i < 3 else EventCode.TASK_COMPLETED
            if sequence[-1].event is not expected:
                raise RuntimeError(f"Wrong terminal event: {sequence[-1]}")
            paths = [p for p in target.iterdir() if p.is_file()]
            if i < 3:
                assert state["cancel_at"] is not None and state["tokens"] <= 4
                assert not paths, "Cancelled generation produced official partial outputs"
            else:
                assert sequence[-1].data["failure_count"] == 0
                assert {p.suffix for p in paths} == {".txt", ".md", ".srt"}
            row = {"model": model, "case": i, "terminal": sequence[-1].event.value,
                   "token_stop_checks": state["tokens"],
                   "cancel_to_idle_seconds": time.monotonic()-state["cancel_at"] if state["cancel_at"] else None,
                   "output_count": len(paths), "model_load_count": len(loads)}
            reports.append(row)
            print(json.dumps(row), flush=True)
        assert loads == [model], "The next task should reuse a healthy model"
    finally:
        if not runtime.close(timeout=30):
            raise RuntimeError("WorkerRuntime cleanup did not finish")
        (output / f"{model}.json").write_text(json.dumps(reports, indent=2), encoding="utf-8")
    return reports


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model-dir", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    os.environ.update(HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1")
    output = args.output_dir.resolve()
    output.mkdir(parents=True, exist_ok=False)
    for model in ("qwen3-asr-0.6b", "qwen3-asr-1.7b"):
        run_model(model, args.model_dir.resolve(), output)


if __name__ == "__main__":
    main()
