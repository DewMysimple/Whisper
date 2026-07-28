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
    backup_md: Path | None = None
    primary_srt: Path | None = None
    primary_srt_txt: Path | None = None
    desktop_txt: Path | None = None
    desktop_md: Path | None = None

    @property
    def content_paths(self) -> tuple[Path, ...]:
        """Return unique non-desktop destinations in deterministic order."""
        paths = []
        for path in (
            self.primary_txt,
            self.backup_txt,
            self.primary_md,
            self.backup_md,
            self.primary_srt,
            self.primary_srt_txt,
        ):
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


@dataclass(frozen=True, slots=True)
class OutputConflict:
    """Conflicting destinations grouped by their source media."""

    media_path: Path
    paths: tuple[Path, ...]


@dataclass(frozen=True, slots=True)
class OutputSelection:
    """Media and output plans retained after applying a conflict policy."""

    media_paths: tuple[Path, ...]
    plans: tuple[OutputPlan, ...]
    skipped: tuple[OutputConflict, ...] = ()


class OutputConflictError(FileExistsError):
    """Raised when a configured output policy cannot reserve destinations."""

    def __init__(
        self,
        paths: Iterable[Path | str],
        *,
        conflicts: Iterable[OutputConflict] = (),
        media_paths: Iterable[Path | str] = (),
    ) -> None:
        unique = tuple(dict.fromkeys(Path(path) for path in paths))
        self.paths = unique
        self.conflicts = tuple(conflicts)
        self.media_paths = tuple(Path(path) for path in media_paths)
        rendered = ", ".join(str(path) for path in unique)
        super().__init__(f"output destination conflict: {rendered}")


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
    *,
    direct_root: bool = False,
) -> Path | None:
    override = target.get("directory")
    if override is not None:
        return Path(str(override))
    if root is not None:
        return root if direct_root else root / child
    return None


def _configured_plan(media: Path, policy: Mapping[str, object]) -> OutputPlan:
    mode = policy.get("mode")
    if mode not in {"compatibility", "custom"}:
        raise ValueError(f"unsupported output mode: {mode!r}")
    txt = policy.get("txt")
    markdown = policy.get("markdown")
    srt = policy.get("srt", {"enabled": False})
    if not isinstance(txt, Mapping) or not isinstance(markdown, Mapping) or not isinstance(srt, Mapping):
        raise TypeError("output txt, markdown and srt targets must be mappings")
    if any(type(target.get("enabled")) is not bool for target in (txt, markdown, srt)):
        raise TypeError("output target enabled flags must be bool")
    if not txt["enabled"] and not markdown["enabled"] and not srt["enabled"]:
        raise ValueError("at least one output target must be enabled")

    root_value = policy.get("root_directory")
    root = Path(str(root_value)) if root_value is not None else None
    source_txt = media.parent / "Text" / f"{media.stem}.txt"
    source_md = media.parent / "Markdown" / f"{media.stem}.md"

    txt_directory = _policy_directory(txt, root, "Text", direct_root=mode == "custom")
    if mode == "compatibility" and txt.get("directory") is None and root is not None:
        # Historical forced-output semantics write TXT directly into the selected
        # directory. Custom mode uses the accepted root/Text layout instead.
        txt_directory = root
    if txt["enabled"]:
        txt_directory = txt_directory or source_txt.parent
        primary_txt = txt_directory / f"{media.stem}.txt"
    else:
        primary_txt = None

    markdown_directory = _policy_directory(
        markdown, root, "Markdown", direct_root=mode == "custom"
    )
    if markdown["enabled"]:
        if markdown_directory is None:
            if mode == "custom":
                raise ValueError("custom Markdown output requires a directory")
            markdown_directory = media.parent / "Markdown"
        primary_md = markdown_directory / f"{media.stem}.md"
    else:
        primary_md = None

    srt_directory = _policy_directory(srt, root, "SRT", direct_root=mode == "custom")
    if srt["enabled"]:
        if srt_directory is None:
            srt_directory = media.parent / "SRT"
        primary_srt = srt_directory / f"{media.stem}.srt"
        primary_srt_txt = srt_directory / f"{media.stem}.txt"
    else:
        primary_srt = None
        primary_srt_txt = None

    preserve_source_txt = policy.get("preserve_source_txt")
    preserve_source_markdown = policy.get("preserve_source_markdown", False)
    if type(preserve_source_txt) is not bool:
        raise TypeError("preserve_source_txt must be bool")
    if type(preserve_source_markdown) is not bool:
        raise TypeError("preserve_source_markdown must be bool")
    backup_txt = (
        source_txt
        if preserve_source_txt
        and primary_txt is not None
        and primary_txt != source_txt
        else None
    )
    backup_md = (
        source_md
        if preserve_source_markdown
        and primary_md is not None
        and primary_md != source_md
        else None
    )
    return OutputPlan(
        primary_txt=primary_txt,
        backup_txt=backup_txt,
        primary_md=primary_md,
        backup_md=backup_md,
        primary_srt=primary_srt,
        primary_srt_txt=primary_srt_txt,
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
        backup_md=_suffixed_path(plan.backup_md, index),
        primary_srt=_suffixed_path(plan.primary_srt, index),
        primary_srt_txt=_suffixed_path(plan.primary_srt_txt, index),
    )


def build_configurable_output_plans(
    media_paths: Sequence[Path | str],
    policy: Mapping[str, object],
    *,
    reserved_paths: Iterable[Path | str] = (),
) -> tuple[OutputPlan, ...]:
    """Plan every task output before inference and apply an explicit conflict rule."""
    return select_configurable_outputs(
        media_paths,
        policy,
        reserved_paths=reserved_paths,
    ).plans


def select_configurable_outputs(
    media_paths: Sequence[Path | str],
    policy: Mapping[str, object],
    *,
    reserved_paths: Iterable[Path | str] = (),
) -> OutputSelection:
    """Plan outputs and optionally skip whole media items with conflicts."""
    conflict_policy = policy.get("conflict_policy")
    if conflict_policy not in {"overwrite", "fail", "auto_rename", "skip"}:
        raise ValueError(f"unsupported conflict policy: {conflict_policy!r}")

    reserved: set[str] = {
        str(Path(path).resolve(strict=False)).casefold() for path in reserved_paths
    }
    plans: list[OutputPlan] = []
    selected_media: list[Path] = []
    conflicts: list[Path] = []
    conflict_groups: list[OutputConflict] = []
    skipped: list[OutputConflict] = []
    for value in media_paths:
        media_path = Path(value)
        base = _configured_plan(media_path, policy)
        candidate = base
        index = 1
        while True:
            keys = {str(path.resolve(strict=False)).casefold() for path in candidate.content_paths}
            conflicting_paths = tuple(
                path
                for path in candidate.content_paths
                if path.exists()
                or str(path.resolve(strict=False)).casefold() in reserved
            )
            existing = any(path.exists() for path in candidate.content_paths)
            duplicate = bool(keys & reserved)
            if conflict_policy == "overwrite" or (not existing and not duplicate):
                break
            if conflict_policy == "fail":
                conflicts.extend(conflicting_paths)
                conflict_groups.append(OutputConflict(media_path, conflicting_paths))
                break
            if conflict_policy == "skip":
                skipped.append(OutputConflict(media_path, conflicting_paths))
                candidate = None
                break
            index += 1
            candidate = _suffixed_plan(base, index)
        if candidate is None:
            continue
        reserved.update(
            str(path.resolve(strict=False)).casefold()
            for path in candidate.content_paths
        )
        selected_media.append(media_path)
        plans.append(candidate)
    if conflicts:
        raise OutputConflictError(
            conflicts,
            conflicts=conflict_groups,
            media_paths=media_paths,
        )
    return OutputSelection(tuple(selected_media), tuple(plans), tuple(skipped))


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


def write_primary_outputs(
    plan: OutputPlan,
    txt_content: str,
    *,
    markdown_content: str | None = None,
    srt_content: str | None = None,
) -> None:
    """Write configured transcript artifacts and an optional SRT artifact."""
    if not isinstance(txt_content, str):
        raise TypeError("txt_content must be str")
    resolved_markdown = txt_content if markdown_content is None else markdown_content
    if not isinstance(resolved_markdown, str):
        raise TypeError("markdown_content must be str")
    for path in (plan.primary_txt, plan.backup_txt):
        if path is None:
            continue
        atomic_write_text(path, txt_content)
    for path in (plan.primary_md, plan.backup_md):
        if path is None:
            continue
        atomic_write_text(path, resolved_markdown)
    if plan.primary_srt is not None or plan.primary_srt_txt is not None:
        if srt_content is None:
            raise ValueError("SRT output requires timestamped subtitle content")
        if plan.primary_srt is not None:
            atomic_write_text(plan.primary_srt, srt_content)
        if plan.primary_srt_txt is not None:
            atomic_write_text(plan.primary_srt_txt, srt_content)


def copy_utf8_text(source: Path | str, destination: Path | str) -> Path:
    """Copy UTF-8 text through universal-newline decoding and atomic writing."""
    with Path(source).open("r", encoding="utf-8") as stream:
        content = stream.read()
    return atomic_write_text(destination, content)


def write_desktop_outputs(
    plan: OutputPlan, txt_content: str, *, markdown_content: str | None = None
) -> None:
    """Write optional desktop TXT and independently laid out Markdown."""
    if plan.desktop_txt is None or plan.desktop_md is None:
        return
    resolved_markdown = txt_content if markdown_content is None else markdown_content
    atomic_write_text(plan.desktop_txt, txt_content)
    atomic_write_text(plan.desktop_md, resolved_markdown)
