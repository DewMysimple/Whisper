"""Compare Qwen serial and microbatched windows on the repository's WAV fixtures."""

from __future__ import annotations

import argparse
import hashlib
import itertools
import json
import logging
import os
from pathlib import Path
import platform
import statistics
import time
from typing import Any
import wave

from whisper_subtitle.application.transcribe import TranscriptionService
from whisper_subtitle.bootstrap import configure_runtime
from whisper_subtitle.domain.backend_parameters import QWEN_LANGUAGES
from whisper_subtitle.domain.contracts import TranscriptionRequest
from whisper_subtitle.domain.presets import derive_preset
from whisper_subtitle.domain.transcription import TranscriptionCancelled
from whisper_subtitle.infrastructure.engines import hardware_detector
from whisper_subtitle.infrastructure.output_store import OutputPlan
from whisper_subtitle.infrastructure.qwen_engine import QwenASREngine, QwenTokenLimitError

from .quality_metrics import srt_cues, text_metrics, timing_metrics


ROOT = Path(__file__).resolve().parents[2]
FIXTURES = (
    ("chinese_short.wav", "今天天气很好，我们一起测试中文语音转录。"),
    ("english_short.wav", "Hello, this is a whisper transcription regression test. The quick brown fox jumps over the lazy dog."),
)
LOGGER = logging.getLogger(__name__)


class QwenMicrobatchExperiment(QwenASREngine):
    """Opt-in harness only. The desktop and CLI still load QwenASREngine."""

    batch_size = 1
    fallback_count = 0
    batch_calls = 0

    def _recognize_batch(self, chunks, params, prompt, *, cancelled, timings):
        with self._inference_threads(), timings.measure("prepare_inputs"):
            # The Qwen processor pads text on the left and emits audio/text masks.
            inputs = self._processor.apply_transcription_request(
                audio=chunks,
                language=QWEN_LANGUAGES.get(params["language"]),
                prompt=prompt,
            ).to(self._model.device, self._model.dtype)
        self._check_cancelled(cancelled)
        with self._inference_threads():
            generated = self._generate(inputs, params, cancelled=cancelled, timings=timings)
        # Read back once for the batch. Later rows can be padded after their EOS.
        with timings.measure("decode_generated"):
            generated = generated.cpu()
            eos = self._model.generation_config.eos_token_id
            eos_ids = {eos} if isinstance(eos, int) else set(eos or ())
            results = []
            for i, tokens in enumerate(generated.tolist()):
                stop = next((j + 1 for j, token in enumerate(tokens) if token in eos_ids), len(tokens))
                try:
                    results.append(self._parse_generation(generated[i:i + 1, :stop], params))
                except QwenTokenLimitError as exc:
                    results.append(QwenTokenLimitError(str(exc)))
        return results

    def _segments(self, audio, params, info, *, cancelled=None):
        if self.batch_size == 1:
            yield from super()._segments(audio, params, info, cancelled=cancelled)
            return
        self._check_cancelled(cancelled)
        # Match the production prompt and window ordering exactly.
        prompt = "\n".join(str(params[key]) for key in ("initial_prompt", "hotwords") if params.get(key)) or None
        windows = self._speech_windows(audio, params, info)
        while group := list(itertools.islice(windows, self.batch_size)):
            self._check_cancelled(cancelled)
            recognitions: list[Any] = [None] * len(group)
            if len(group) > 1:
                self.batch_calls += 1
                try:
                    recognitions = self._recognize_batch([audio[start:end] for start, end in group],
                                                         params, prompt, cancelled=cancelled,
                                                         timings=info.inference_timings)
                except TranscriptionCancelled:
                    raise
                except (RuntimeError, ValueError) as exc:
                    self.fallback_count += 1
                    LOGGER.warning("Qwen batch %d reverted to serial windows (%s)", len(group), type(exc).__name__)
                # The failed tensors' traceback is gone before serial retry.
            for (start, end), recognition in zip(group, recognitions, strict=True):
                yield from self._window_segments(audio, start, end, params, prompt, info,
                                                 cancelled=cancelled, recognition=recognition)


def make_media(path: Path, repeats: int, fixture: str) -> tuple[float, str]:
    fixtures = {
        "mandarin": FIXTURES[:1],
        "english": FIXTURES[1:],
        "alternating": FIXTURES,
    }[fixture]
    references = []
    with wave.open(str(path), "wb") as output:
        for name, reference in fixtures * repeats:
            with wave.open(str(ROOT / "tests" / "fixtures" / name), "rb") as source:
                if not references:
                    output.setparams(source.getparams())
                elif (output.getframerate(), output.getnchannels(), output.getsampwidth()) != (
                    source.getframerate(), source.getnchannels(), source.getsampwidth(),
                ):
                    raise ValueError("WAV fixture formats must match")
                output.writeframesraw(source.readframes(source.getnframes()))
                # Enough space for the existing VAD to yield separate natural windows.
                output.writeframesraw(bytes(2 * source.getframerate() * source.getsampwidth() * source.getnchannels()))
                references.append(reference)
        duration = output.getnframes() / output.getframerate()
    return duration, " ".join(references)


def sample(engine, media, reference, preset, directory, size, *, srt):
    engine.batch_size = size
    engine.batch_calls = engine.fallback_count = 0
    timing = {}
    plan = OutputPlan(directory / "transcript.txt", primary_md=directory / "transcript.md",
                      primary_srt=directory / "transcript.srt" if srt else None)
    torch = engine._torch
    device = engine._model.device
    torch.cuda.synchronize(device)
    torch.cuda.reset_peak_memory_stats(device)
    started = time.monotonic()
    TranscriptionService(timing=timing.update).transcribe_file(
        TranscriptionRequest(media, preset.id), engine, preset=preset,
        output_plan=plan, model_id=engine.model_name,
    )
    torch.cuda.synchronize(device)
    elapsed = time.monotonic() - started
    transcript = plan.primary_txt.read_text(encoding="utf-8")
    subtitle_metrics = None
    if plan.primary_srt is not None:
        cues = srt_cues(plan.primary_srt.read_text(encoding="utf-8"))
        subtitle_metrics = {
            **timing_metrics([], cues),
            "cue_count": len(cues),
            "overlap_count": sum(previous["end"] > current["start"] for previous, current in itertools.pairwise(cues)),
            "invalid_duration_count": sum(cue["end"] <= cue["start"] for cue in cues),
        }
    return {
        "batch_size": size,
        "batch_calls": engine.batch_calls,
        "batch_fallbacks": engine.fallback_count,
        "synchronized_file_seconds": elapsed,
        "torch_peak_allocated_mib": torch.cuda.max_memory_allocated(device) / 1024**2,
        "torch_peak_reserved_mib": torch.cuda.max_memory_reserved(device) / 1024**2,
        "output_sha256": {path.suffix: hashlib.sha256(path.read_bytes()).hexdigest() for path in plan.content_paths},
        "quality": text_metrics(reference, transcript),
        "srt": subtitle_metrics,
        "timing": timing,
    }


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, required=True, help="Use a new directory for each run")
    parser.add_argument("--model-dir", type=Path, required=True)
    parser.add_argument("--model", choices=("qwen3-asr-1.7b", "qwen3-asr-0.6b"), default="qwen3-asr-1.7b")
    parser.add_argument("--fixture", choices=("mandarin", "english", "alternating"), default="alternating")
    parser.add_argument("--repeat-fixture", type=int, default=4)
    parser.add_argument("--runs-per-batch", type=int, default=3)
    parser.add_argument("--preset", default="cn")
    parser.add_argument("--srt", action="store_true")
    args = parser.parse_args(argv)
    if args.repeat_fixture < 2 or args.runs_per_batch < 1:
        parser.error("Use at least two fixture repetitions and one run per batch")

    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    args.output_dir.mkdir(parents=True, exist_ok=False)
    media = args.output_dir / "fixtures-with-silence.wav"
    duration, reference = make_media(media, args.repeat_fixture, args.fixture)
    preset = derive_preset(args.preset, {}, model_id=args.model)
    started = time.monotonic()
    location = configure_runtime(model_dir=args.model_dir)
    hardware = hardware_detector(args.model).resolve({"device": "cuda"})
    hardware_seconds = time.monotonic() - started
    engine = QwenMicrobatchExperiment.load(hardware, location, model_name=args.model)
    engine._torch.cuda.synchronize(engine._model.device)
    load_seconds = time.monotonic() - started - hardware_seconds
    report = {
        "model_id": args.model,
        "preset_id": preset.id,
        "parameters": {**preset.transcription_options(), "word_timestamps": args.srt},
        "platform": platform.platform(),
        "torch_version": engine._torch.__version__,
        "transformers_version": engine._transformers.__version__,
        "gpu": hardware.gpu_name,
        "compute_type": hardware.compute_type,
        "fixture": args.fixture,
        "fixture_repetitions": args.repeat_fixture,
        "media_seconds": duration,
        "input_sha256": hashlib.sha256(media.read_bytes()).hexdigest(),
        "runtime_and_hardware_seconds": hardware_seconds,
        "model_load_seconds": load_seconds,
        "resident": [],
    }
    report_file = args.output_dir / "qwen-window-timing.json"
    try:
        report["first_after_load"] = sample(engine, media, reference, preset, args.output_dir / "cold", 1, srt=args.srt)
        orders = itertools.cycle(((1, 2, 4), (4, 2, 1), (2, 1, 4)))
        for round_number in range(args.runs_per_batch):
            for size in next(orders):
                try:
                    row = sample(engine, media, reference, preset, args.output_dir / f"resident-{round_number}-{size}", size, srt=args.srt)
                except Exception as exc:
                    report["resident"].append({"batch_size": size, "round": round_number + 1,
                                               "error_type": type(exc).__name__})
                    raise
                report["resident"].append(row)
                print(f"resident {round_number + 1} · batch {size} · {row['synchronized_file_seconds']:.3f} s", flush=True)
        report["summary"] = {}
        serial = report["resident"][0]["output_sha256"]
        for size in (1, 2, 4):
            rows = [row for row in report["resident"] if row["batch_size"] == size]
            seconds = [row["synchronized_file_seconds"] for row in rows]
            report["summary"][str(size)] = {
                "median_seconds": statistics.median(seconds),
                "range_seconds": [min(seconds), max(seconds)],
                "matches_serial_outputs": all(row["output_sha256"] == serial for row in rows),
            }
    finally:
        report_file.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        engine.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
