"""Console argument parsing and rendering for transcription use cases."""

from __future__ import annotations

import json

from ..application.transcribe import TranscriptionService
from ..domain.contracts import ProgressEvent, TranscriptionRequest
from ..domain.transcription import TranscriptionEngine


class ConsoleProgressRenderer:
    """Render transport-neutral progress events using historical CLI text."""

    def __call__(self, event: ProgressEvent) -> None:
        print(event.message)


def progress_event_payload(event: ProgressEvent) -> dict[str, object]:
    """Return the stable, JSON-serializable representation of an event."""
    return {
        "type": "progress",
        "stage": event.stage,
        "message": event.message,
        "current": event.current,
        "total": event.total,
        "preset_id": event.preset_id,
        "input_path": str(event.input_path) if event.input_path is not None else None,
    }


class JsonLinesProgressRenderer:
    """Render one machine-readable progress object per output line."""

    def __call__(self, event: ProgressEvent) -> None:
        print(json.dumps(progress_event_payload(event), ensure_ascii=False))


def progress_renderer(format_name: str):
    """Select a presentation transport without changing the application service."""
    if format_name == "text":
        return ConsoleProgressRenderer()
    if format_name == "jsonl":
        return JsonLinesProgressRenderer()
    raise ValueError(f"unknown progress format: {format_name}")


def run_transcription_request(
    request: TranscriptionRequest,
    *,
    progress_format: str = "text",
    engine: TranscriptionEngine | None = None,
) -> int:
    """Run one typed request through the unified application service."""
    batch = TranscriptionService(progress=progress_renderer(progress_format)).run(
        request,
        engine=engine,
    )
    return batch.exit_code
