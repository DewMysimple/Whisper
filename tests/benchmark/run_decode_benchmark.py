"""Explicit decode-only scaling probe with generated PCM, not long-media ASR acceptance."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import subprocess
import sys
import time
import wave

import psutil
from tests.benchmark.run_benchmark import process_tree_rss


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path)
    parser.add_argument("--seconds", nargs="+", type=int, default=[1800, 3600, 10800])
    parser.add_argument("--child", type=Path)
    parser.add_argument("--result", type=Path)
    args = parser.parse_args()
    if args.child:
        from whisper_subtitle.infrastructure.audio_chunks import decode_media
        started = time.monotonic()
        audio = decode_media(str(args.child))
        args.result.write_text(json.dumps({"decode_seconds": time.monotonic()-started,
            "array_bytes": audio.nbytes, "decoded_samples": len(audio),
            "silence_verified": bool((audio == 0).all())}), encoding="utf-8")
        return
    if not args.output_dir or any(not 1 <= s <= 10800 for s in args.seconds):
        parser.error("output-dir required; duration must be 1..10800 seconds")
    output = args.output_dir.resolve()
    output.mkdir(parents=True, exist_ok=False)
    reports = []
    for seconds in args.seconds:
        media = output / f"silence-{seconds}.wav"
        with wave.open(str(media), "wb") as wav:
            wav.setparams((1, 2, 16000, 0, "NONE", "not compressed"))
            for _ in range(seconds):
                wav.writeframes(bytes(32000))
        target = output / f"decode-{seconds}.json"
        process = subprocess.Popen([sys.executable, "-m", "tests.benchmark.run_decode_benchmark", "--child", str(media), "--result", str(target)])
        worker, peak = psutil.Process(process.pid), 0
        while process.poll() is None:
            try:
                peak = max(peak, process_tree_rss(worker))
            except psutil.NoSuchProcess:
                pass
            time.sleep(.02)
        if process.returncode:
            raise RuntimeError("Decode probe failed; preserve diagnostics")
        row = {"media_seconds": seconds, **json.loads(target.read_text(encoding="utf-8")),
               "peak_process_tree_rss_mib": peak/1024**2,
               "gpu_memory": None, "asr_elapsed": None, "scope": "generated-silence-decode-only"}
        reports.append(row)
        (output / "decode.json").write_text(json.dumps(reports, indent=2), encoding="utf-8")
        print(json.dumps(row), flush=True)


if __name__ == "__main__":
    main()
