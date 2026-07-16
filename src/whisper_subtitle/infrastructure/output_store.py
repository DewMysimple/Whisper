"""Output path planning and atomic UTF-8 transcript storage."""

from __future__ import annotations

import os
import tempfile
from collections.abc import Iterable
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, replace
from pathlib import Path


@dataclass(frozen=True, slots=True)
class OutputPlan:
    """All output paths for one media file."""

    primary_txt: Path | None
    backup_txt: Path | None = None
    primary_md: Path | None = None
    desktop_txt: Path | None = None
    desktop_md: Path | None = None

    @property
    def content_paths(self) -> tuple[Path, ...]:
        """Return unique non-desktop destinations in deterministic order."""
        paths = []
        for path in (self.primary_txt, self.backup_txt, self.primary_md):
            if path is not None and path not in paths:
                paths.append(path)
        return tuple(paths)

    @property
    def result_path(self) -> Path:
        """Return the primary artifact used by structured task results."""
        paths = self.content_paths
        if not paths:
            raise ValueError("output plan must contain at least one destination")
        return paths[0]


class OutputConflictError(FileExistsError):
    """Raised when a configured output policy cannot reserve destinations."""


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


def _policy_directory(
    target: Mapping[str, object],
    root: Path | None,
    child: str,
) -> Path | None:
    override = target.get("directory")
    if override is not None:
        return Path(str(override))
    if root is not None:
        return root / child
    return None


def _configured_plan(media: Path, policy: Mapping[str, object]) -> OutputPlan:
    mode = policy.get("mode")
    if mode not in {"compatibility", "custom"}:
        raise ValueError(f"unsupported output mode: {mode!r}")
    txt = policy.get("txt")
    markdown = policy.get("markdown")
    if not isinstance(txt, Mapping) or not isinstance(markdown, Mapping):
        raise TypeError("output txt and markdown targets must be mappings")
    if type(txt.get("enabled")) is not bool or type(markdown.get("enabled")) is not bool:
        raise TypeError("output target enabled flags must be bool")
    if not txt["enabled"] and not markdown["enabled"]:
        raise ValueError("at least one output target must be enabled")

    root_value = policy.get("root_directory")
    root = Path(str(root_value)) if root_value is not None else None
    source_txt = media.parent / "Text" / f"{media.stem}.txt"

    txt_directory = _policy_directory(txt, root, "Text")
    if mode == "compatibility" and txt.get("directory") is None and root is not None:
        # Historical forced-output semantics write TXT directly into the selected
        # directory. Custom mode uses the accepted root/Text layout instead.
        txt_directory = root
    if txt["enabled"]:
        txt_directory = txt_directory or source_txt.parent
        primary_txt = txt_directory / f"{media.stem}.txt"
    else:
        primary_txt = None

    markdown_directory = _policy_directory(markdown, root, "Markdown")
    if markdown["enabled"]:
        if markdown_directory is None:
            if mode == "custom":
                raise ValueError("custom Markdown output requires a directory")
            markdown_directory = media.parent / "Markdown"
        primary_md = markdown_directory / f"{media.stem}.md"
    else:
        primary_md = None

    preserve_source = policy.get("preserve_source_txt")
    if type(preserve_source) is not bool:
        raise TypeError("preserve_source_txt must be bool")
    backup_txt = (
        source_txt
        if preserve_source and primary_txt != source_txt
        else None
    )
    return OutputPlan(
        primary_txt=primary_txt,
        backup_txt=backup_txt,
        primary_md=primary_md,
    )


def _suffixed_path(path: Path | None, index: int) -> Path | None:
    if path is None or index == 1:
        return path
    return path.with_name(f"{path.stem} ({index}){path.suffix}")


def _suffixed_plan(plan: OutputPlan, index: int) -> OutputPlan:
    return replace(
        plan,
        primary_txt=_suffixed_path(plan.primary_txt, index),
        backup_txt=_suffixed_path(plan.backup_txt, index),
        primary_md=_suffixed_path(plan.primary_md, index),
    )


def build_configurable_output_plans(
    media_paths: Sequence[Path | str],
    policy: Mapping[str, object],
    *,
    reserved_paths: Iterable[Path | str] = (),
) -> tuple[OutputPlan, ...]:
    """Plan every task output before inference and apply an explicit conflict rule."""
    conflict_policy = policy.get("conflict_policy")
    if conflict_policy not in {"overwrite", "fail", "auto_rename"}:
        raise ValueError(f"unsupported conflict policy: {conflict_policy!r}")

    reserved: set[str] = {
        str(Path(path).resolve(strict=False)).casefold() for path in reserved_paths
    }
    plans = []
    for value in media_paths:
        base = _configured_plan(Path(value), policy)
        candidate = base
        index = 1
        while True:
            keys = {str(path.resolve(strict=False)).casefold() for path in candidate.content_paths}
            existing = any(path.exists() for path in candidate.content_paths)
            duplicate = bool(keys & reserved)
            if conflict_policy == "overwrite" or (not existing and not duplicate):
                break
            if conflict_policy == "fail":
                paths = ", ".join(str(path) for path in candidate.content_paths)
                raise OutputConflictError(f"output destination conflict: {paths}")
            index += 1
            candidate = _suffixed_plan(base, index)
        reserved.update(
            str(path.resolve(strict=False)).casefold()
            for path in candidate.content_paths
        )
        plans.append(candidate)
    return tuple(plans)


def prepare_forced_output_directory(output: Path | str) -> Path | None:
    """Resolve the legacy '.' sentinel and prepare an explicit output directory."""
    if str(output) == ".":
        return None
    output_dir = Path(output)
    output_dir.mkdir(parents=True, exist_ok=True)
    return output_dir


def prepare_output_plan(plan: OutputPlan) -> None:
    """Prepare primary and backup directories before transcription starts."""
    for path in plan.content_paths:
        path.parent.mkdir(parents=True, exist_ok=True)


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
    """Write every configured TXT/Markdown artifact with identical content."""
    content = _lines_to_text(lines)
    for path in plan.content_paths:
        atomic_write_text(path, content)


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
