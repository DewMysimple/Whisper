"""Worker-local media probing and structured input expansion."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

from ..infrastructure.media_files import MediaDiscoveryError, discover_media_files
from ..protocol import ErrorCode
from .runtime_types import WorkerCommandError


def default_media_duration_probe(
    path: Path,
) -> tuple[bool, float | None, str | None]:
    """Read container metadata through the PyAV runtime bundled with the Worker."""
    try:
        import av

        with av.open(str(path), mode="r") as container:
            duration: float | None = None
            if container.duration is not None and container.duration > 0:
                duration = float(container.duration) / float(av.time_base)
            if duration is None:
                stream_durations = [
                    float(stream.duration * stream.time_base)
                    for stream in container.streams
                    if stream.duration is not None
                    and stream.time_base is not None
                    and stream.duration > 0
                ]
                if stream_durations:
                    duration = max(stream_durations)
        return True, duration, None
    except Exception as exc:
        return False, None, str(exc) or type(exc).__name__


def normalize_input_path(value: str) -> Path:
    """Normalize one structured path without shell parsing or tokenization."""
    normalized = value.strip()
    if len(normalized) >= 2 and normalized.startswith('"') and normalized.endswith('"'):
        normalized = normalized[1:-1]
    if not normalized:
        raise ValueError("input path is empty")
    return Path(normalized).resolve(strict=False)


def path_key(path: Path) -> str:
    return str(path.resolve(strict=False)).casefold()


def expand_input_sources(inputs: Sequence[Mapping[str, Any]]) -> tuple[Path, ...]:
    """Expand files/directories in source order and deduplicate Windows-style."""
    media_paths: list[Path] = []
    seen: set[str] = set()
    issues: list[dict[str, str]] = []

    for index, source in enumerate(inputs):
        raw_path = source.get("path")
        kind = source.get("kind")
        try:
            if not isinstance(raw_path, str):
                raise ValueError("path must be a string")
            path = normalize_input_path(raw_path)
            if kind == "file" and not path.is_file():
                raise ValueError("declared file does not exist or is not a file")
            if kind == "directory" and not path.is_dir():
                raise ValueError("declared directory does not exist or is not a directory")
            if kind not in {"file", "directory"}:
                raise ValueError("unsupported input kind")
            discovered = discover_media_files(path)
        except (MediaDiscoveryError, OSError, ValueError) as exc:
            issues.append(
                {
                    "index": str(index),
                    "path": str(raw_path),
                    "reason": str(exc),
                }
            )
            continue

        for media_path in discovered:
            key = path_key(media_path)
            if key not in seen:
                seen.add(key)
                media_paths.append(media_path)

    if issues:
        raise WorkerCommandError(
            ErrorCode.REQUEST_INVALID,
            "one or more input sources are invalid",
            data={"inputs": issues},
        )
    if not media_paths:
        raise WorkerCommandError(
            ErrorCode.REQUEST_INVALID,
            "input sources did not produce supported media",
        )
    return tuple(media_paths)
