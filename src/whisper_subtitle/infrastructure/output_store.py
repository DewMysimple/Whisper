"""Output path planning and atomic UTF-8 transcript storage."""

from __future__ import annotations

import os
import tempfile
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True, slots=True)
class OutputPlan:
    """All output paths for one media file."""

    primary_txt: Path
    backup_txt: Path | None = None
    desktop_txt: Path | None = None
    desktop_md: Path | None = None


def build_output_plan(
    media_path: Path | str,
    forced_output_dir: Path | str | None = None,
    *,
    desktop: bool = False,
    home: Path | str | None = None,
) -> OutputPlan:
    """Build paths without touching the filesystem."""
    media = Path(media_path)
    text_dir = media.parent / "Text"
    output_dir = Path(forced_output_dir) if forced_output_dir is not None else text_dir
    primary_txt = output_dir / f"{media.stem}.txt"
    backup_txt = text_dir / f"{media.stem}.txt" if output_dir != text_dir else None

    if not desktop:
        return OutputPlan(primary_txt=primary_txt, backup_txt=backup_txt)

    desktop_root = (Path(home) if home is not None else Path.home()) / "Desktop" / "Whisper语音列表"
    return OutputPlan(
        primary_txt=primary_txt,
        backup_txt=backup_txt,
        desktop_txt=desktop_root / "Text" / f"{media.stem}.txt",
        desktop_md=desktop_root / "Markdown" / f"{media.stem}.md",
    )


def prepare_forced_output_directory(output: Path | str) -> Path | None:
    """Resolve the legacy '.' sentinel and prepare an explicit output directory."""
    if str(output) == ".":
        return None
    output_dir = Path(output)
    output_dir.mkdir(parents=True, exist_ok=True)
    return output_dir


def prepare_output_plan(plan: OutputPlan) -> None:
    """Prepare primary and backup directories before transcription starts."""
    plan.primary_txt.parent.mkdir(parents=True, exist_ok=True)
    if plan.backup_txt is not None:
        plan.backup_txt.parent.mkdir(parents=True, exist_ok=True)


def atomic_write_text(path: Path | str, content: str) -> Path:
    """Atomically replace a UTF-8 text file using a sibling temporary file."""
    destination = Path(path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            newline=None,
            prefix=f".{destination.name}.",
            suffix=".tmp",
            dir=destination.parent,
            delete=False,
        ) as stream:
            temporary_path = Path(stream.name)
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary_path, destination)
        temporary_path = None
        return destination
    finally:
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)


def _lines_to_text(lines: Iterable[str]) -> str:
    return "".join(f"{line}\n" for line in lines)


def write_primary_outputs(plan: OutputPlan, lines: Iterable[str]) -> None:
    """Write the primary transcript and optional source-directory backup."""
    content = _lines_to_text(lines)
    atomic_write_text(plan.primary_txt, content)
    if plan.backup_txt is not None:
        atomic_write_text(plan.backup_txt, content)


def copy_utf8_text(source: Path | str, destination: Path | str) -> Path:
    """Copy UTF-8 text through universal-newline decoding and atomic writing."""
    with Path(source).open("r", encoding="utf-8") as stream:
        content = stream.read()
    return atomic_write_text(destination, content)


def write_desktop_outputs(plan: OutputPlan, lines: Iterable[str]) -> None:
    """Write optional desktop TXT and its content-identical Markdown copy."""
    if plan.desktop_txt is None or plan.desktop_md is None:
        return
    atomic_write_text(plan.desktop_txt, _lines_to_text(lines))
    copy_utf8_text(plan.desktop_txt, plan.desktop_md)
