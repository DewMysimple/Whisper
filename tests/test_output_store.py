"""Tests for output planning and atomic storage."""

from __future__ import annotations

from pathlib import Path

import pytest

from whisper_subtitle.infrastructure import output_store
from whisper_subtitle.infrastructure.output_store import (
    atomic_write_text,
    build_output_plan,
    copy_utf8_text,
    prepare_forced_output_directory,
    prepare_output_plan,
    write_desktop_outputs,
    write_primary_outputs,
)


def test_default_output_plan_uses_source_text_directory(tmp_path: Path):
    media = tmp_path / "course.mp4"

    plan = build_output_plan(media)

    assert plan.primary_txt == tmp_path / "Text" / "course.txt"
    assert plan.backup_txt is None
    assert plan.desktop_txt is None
    assert plan.desktop_md is None


def test_forced_and_desktop_output_plan_preserves_historical_paths(tmp_path: Path):
    media = tmp_path / "input" / "course.mp4"
    forced = tmp_path / "forced"
    home = tmp_path / "home"

    plan = build_output_plan(media, forced, desktop=True, home=home)

    assert plan.primary_txt == forced / "course.txt"
    assert plan.backup_txt == media.parent / "Text" / "course.txt"
    desktop_root = home / "Desktop" / "Whisper语音列表"
    assert plan.desktop_txt == desktop_root / "Text" / "course.txt"
    assert plan.desktop_md == desktop_root / "Markdown" / "course.md"


def test_explicit_source_text_directory_does_not_create_duplicate_backup(tmp_path: Path):
    media = tmp_path / "course.wav"
    plan = build_output_plan(media, tmp_path / "Text")
    assert plan.backup_txt is None


def test_prepare_plan_keeps_desktop_creation_deferred(tmp_path: Path):
    plan = build_output_plan(
        tmp_path / "input" / "course.wav",
        tmp_path / "forced",
        desktop=True,
        home=tmp_path / "home",
    )

    prepare_output_plan(plan)

    assert plan.primary_txt.parent.is_dir()
    assert plan.backup_txt is not None and plan.backup_txt.parent.is_dir()
    assert plan.desktop_txt is not None and not plan.desktop_txt.parent.exists()


def test_prepare_forced_output_directory_preserves_dot_sentinel(tmp_path: Path):
    assert prepare_forced_output_directory(".") is None
    forced = tmp_path / "forced"
    assert prepare_forced_output_directory(forced) == forced
    assert forced.is_dir()


def test_primary_backup_and_desktop_outputs_keep_exact_text(tmp_path: Path):
    plan = build_output_plan(
        tmp_path / "input" / "course.wav",
        tmp_path / "forced",
        desktop=True,
        home=tmp_path / "home",
    )
    lines = ["First line.", "第二行。"]

    write_primary_outputs(plan, lines)
    write_desktop_outputs(plan, lines)

    expected = "First line.\n第二行。\n"
    for path in (
        plan.primary_txt,
        plan.backup_txt,
        plan.desktop_txt,
        plan.desktop_md,
    ):
        assert path is not None
        assert path.read_text(encoding="utf-8") == expected


def test_copy_utf8_text_preserves_content_contract(tmp_path: Path):
    source = tmp_path / "source.txt"
    destination = tmp_path / "target.md"
    source.write_text("# 标题\n\nContent.\n", encoding="utf-8")

    assert copy_utf8_text(source, destination) == destination
    assert destination.read_text(encoding="utf-8") == source.read_text(encoding="utf-8")


def test_atomic_write_replaces_existing_file_without_leaving_temp(tmp_path: Path):
    destination = tmp_path / "result.txt"
    destination.write_text("old content", encoding="utf-8")

    assert atomic_write_text(destination, "new content") == destination

    assert destination.read_text(encoding="utf-8") == "new content"
    assert list(tmp_path.glob(".result.txt.*.tmp")) == []


def test_atomic_replace_failure_preserves_existing_file_and_removes_temp(
    tmp_path: Path, monkeypatch
):
    destination = tmp_path / "result.txt"
    destination.write_text("stable", encoding="utf-8")

    def fail_replace(_source, _destination):
        raise PermissionError("replace denied")

    monkeypatch.setattr(output_store.os, "replace", fail_replace)

    with pytest.raises(PermissionError, match="replace denied"):
        atomic_write_text(destination, "new content")

    assert destination.read_text(encoding="utf-8") == "stable"
    assert list(tmp_path.glob(".result.txt.*.tmp")) == []


def test_directory_permission_error_is_propagated(tmp_path: Path, monkeypatch):
    destination = tmp_path / "blocked" / "result.txt"
    original_mkdir = Path.mkdir

    def guarded_mkdir(path, *args, **kwargs):
        if path == destination.parent:
            raise PermissionError("directory denied")
        return original_mkdir(path, *args, **kwargs)

    monkeypatch.setattr(Path, "mkdir", guarded_mkdir)

    with pytest.raises(PermissionError, match="directory denied"):
        atomic_write_text(destination, "content")
