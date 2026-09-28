"""Bounded speech windows with original-media offsets for local ASR backends."""

from __future__ import annotations

from collections.abc import Iterator, Mapping
from typing import Any

from .cuda_runtime import configure_cuda_runtime

SAMPLE_RATE = 16000


def decode_media(path: str):
    # Reuse the established PyAV decoder: every backend accepts the same media.
    configure_cuda_runtime()
    from faster_whisper.audio import decode_audio
    return decode_audio(path, sampling_rate=SAMPLE_RATE)


def speech_windows(audio, *, chunk_length: int, vad_filter: bool,
                   vad_parameters: Mapping[str, Any]) -> Iterator[tuple[int, int]]:
    limit = int(chunk_length * SAMPLE_RATE)
    if limit <= 0:
        raise ValueError("chunk_length must be positive")
    if vad_filter:
        from faster_whisper.vad import VadOptions, get_speech_timestamps
        options = dict(vad_parameters)
        options["max_speech_duration_s"] = min(float(options.get("max_speech_duration_s", chunk_length)), chunk_length)
        spans = get_speech_timestamps(audio, VadOptions(**options), sampling_rate=SAMPLE_RATE)
    else:
        spans = [{"start": 0, "end": len(audio)}]
    previous_end = 0
    for span in spans:
        start, end = max(previous_end, int(span["start"])), min(len(audio), int(span["end"]))
        while start < end:
            stop = min(start + limit, end)
            yield start, stop
            start = stop
        previous_end = end
