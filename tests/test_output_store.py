"""Tests for output planning and atomic storage."""

from __future__ import annotations

from pathlib import Path

import pytest

from whisper_subtitle.infrastructure import output_store
from whisper_subtitle.infrastructure.output_store import (
    OutputConflictError,
    atomic_write_text,
    build_configurable_output_plans,
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


def test_primary_backup_and_desktop_outputs_keep_format_specific_text(tmp_path: Path):
    plan = build_output_plan(
        tmp_path / "input" / "course.wav",
        tmp_path / "forced",
        desktop=True,
        home=tmp_path / "home",
    )
    txt_content = "First line.\n第二行。\n"
    markdown_content = "First line. 第二行。\n"

    write_primary_outputs(plan, txt_content, markdown_content=markdown_content)
    write_desktop_outputs(plan, txt_content, markdown_content=markdown_content)

    for path in (
        plan.primary_txt,
        plan.backup_txt,
        plan.desktop_txt,
    ):
        assert path is not None
        assert path.read_text(encoding="utf-8") == txt_content
    assert plan.desktop_md is not None
    assert plan.desktop_md.read_text(encoding="utf-8") == markdown_content


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


def custom_policy(
    root: Path, *, conflict="fail", preserve_txt=True, preserve_markdown=True
):
    return {
        "mode": "custom",
        "root_directory": str(root),
        "txt": {"enabled": True},
        "markdown": {"enabled": True},
        "preserve_source_txt": preserve_txt,
        "preserve_source_markdown": preserve_markdown,
        "conflict_policy": conflict,
    }


def test_custom_plan_writes_all_formats_directly_to_shared_root_and_source_backup(tmp_path):
    media = tmp_path / "input" / "course.wav"

    plan = build_configurable_output_plans(
        [media], custom_policy(tmp_path / "output")
    )[0]

    assert plan.primary_txt == tmp_path / "output" / "course.txt"
    assert plan.primary_md == tmp_path / "output" / "course.md"
    assert plan.backup_txt == tmp_path / "input" / "Text" / "course.txt"
    assert plan.backup_md == tmp_path / "input" / "Markdown" / "course.md"


def test_default_plan_writes_each_format_directly_to_media_adjacent_folder(tmp_path):
    media = tmp_path / "input" / "course.wav"
    policy = {
        "mode": "compatibility",
        "txt": {"enabled": True},
        "markdown": {"enabled": True},
        "preserve_source_txt": True,
        "preserve_source_markdown": True,
        "conflict_policy": "fail",
    }

    plan = build_configurable_output_plans([media], policy)[0]

    assert plan.primary_txt == media.parent / "Text" / "course.txt"
    assert plan.primary_md == media.parent / "Markdown" / "course.md"
    assert plan.backup_txt is None
    assert plan.backup_md is None


def test_custom_markdown_copy_is_independent_from_txt_copy(tmp_path):
    media = tmp_path / "input" / "course.wav"
    policy = {
        "mode": "custom",
        "root_directory": str(tmp_path / "output"),
        "txt": {"enabled": False},
        "markdown": {"enabled": True},
        "preserve_source_txt": True,
        "preserve_source_markdown": True,
        "conflict_policy": "fail",
    }

    plan = build_configurable_output_plans([media], policy)[0]

    assert plan.primary_txt is None
    assert plan.backup_txt is None
    assert plan.primary_md == tmp_path / "output" / "course.md"
    assert plan.backup_md == media.parent / "Markdown" / "course.md"


def test_custom_target_directories_override_shared_root(tmp_path):
    policy = custom_policy(
        tmp_path / "shared", preserve_txt=False, preserve_markdown=False
    )
    policy["txt"]["directory"] = str(tmp_path / "txt-only")
    policy["markdown"]["directory"] = str(tmp_path / "md-only")

    plan = build_configurable_output_plans([tmp_path / "a.wav"], policy)[0]

    assert plan.primary_txt == tmp_path / "txt-only" / "a.txt"
    assert plan.primary_md == tmp_path / "md-only" / "a.md"
    assert plan.backup_txt is None
    assert plan.backup_md is None


def test_fail_conflict_is_detected_before_writing_any_output(tmp_path):
    destination = tmp_path / "output" / "same.txt"
    destination.parent.mkdir(parents=True)
    destination.write_text("existing", encoding="utf-8")

    with pytest.raises(OutputConflictError) as captured:
        build_configurable_output_plans(
            [tmp_path / "input" / "same.wav"],
            custom_policy(
                tmp_path / "output", preserve_txt=False, preserve_markdown=False
            ),
        )

    assert captured.value.paths == (destination,)
    assert destination.read_text(encoding="utf-8") == "existing"


def test_fail_conflict_reports_all_disk_and_reserved_targets(tmp_path):
    root = tmp_path / "output"
    txt = root / "same.txt"
    markdown = root / "same.md"
    txt.parent.mkdir(parents=True)
    txt.write_text("existing", encoding="utf-8")

    with pytest.raises(OutputConflictError) as captured:
        build_configurable_output_plans(
            [tmp_path / "same.wav"],
            custom_policy(
                root,
                preserve_txt=False,
                preserve_markdown=False,
            ),
            reserved_paths=[markdown],
        )

    assert captured.value.paths == (txt, markdown)
    assert captured.value.media_paths == (tmp_path / "same.wav",)
    assert captured.value.conflicts[0].media_path == tmp_path / "same.wav"
    assert captured.value.conflicts[0].paths == (txt, markdown)


def test_skip_policy_removes_the_whole_conflicting_media_and_keeps_the_rest(tmp_path):
    root = tmp_path / "output"
    conflicting_media = tmp_path / "input" / "same.wav"
    clean_media = tmp_path / "input" / "clean.wav"
    existing = root / "same.txt"
    existing.parent.mkdir(parents=True)
    existing.write_text("existing", encoding="utf-8")

    selection = output_store.select_configurable_outputs(
        [conflicting_media, clean_media],
        custom_policy(
            root,
            conflict="skip",
            preserve_txt=False,
            preserve_markdown=False,
        ),
    )

    assert selection.media_paths == (clean_media,)
    assert len(selection.plans) == 1
    assert selection.plans[0].primary_txt == root / "clean.txt"
    assert selection.plans[0].primary_md == root / "clean.md"
    assert len(selection.skipped) == 1
    assert selection.skipped[0].media_path == conflicting_media
    assert selection.skipped[0].paths == (existing,)
    assert existing.read_text(encoding="utf-8") == "existing"


def test_auto_rename_reserves_txt_and_markdown_with_one_suffix(tmp_path):
    root = tmp_path / "output"
    existing = root / "same.txt"
    existing.parent.mkdir(parents=True)
    existing.write_text("existing", encoding="utf-8")

    plan = build_configurable_output_plans(
        [tmp_path / "same.wav"],
        custom_policy(
            root,
            conflict="auto_rename",
            preserve_txt=False,
            preserve_markdown=False,
        ),
    )[0]

    assert plan.primary_txt == root / "same (2).txt"
    assert plan.primary_md == root / "same (2).md"


def test_srt_plan_writes_only_the_subtitle_file_when_txt_is_disabled(tmp_path):
    media = tmp_path / "input" / "lesson.wav"
    media.parent.mkdir()
    media.write_bytes(b"fixture")
    policy = {
        "mode": "compatibility",
        "txt": {"enabled": False},
        "markdown": {"enabled": False},
        "srt": {"enabled": True},
        "preserve_source_txt": True,
        "conflict_policy": "overwrite",
    }

    plan = output_store.build_configurable_output_plans([media], policy)[0]

    assert plan.primary_srt == media.parent / "SRT" / "lesson.srt"
    assert plan.primary_srt_txt is None
    assert plan.primary_txt is None
    assert plan.backup_txt is None


def test_srt_and_txt_targets_are_planned_independently(tmp_path):
    root = tmp_path / "output"
    root.mkdir()
    (root / "lesson.txt").write_text("existing", encoding="utf-8")
    media = tmp_path / "lesson.wav"
    media.write_bytes(b"fixture")
    policy = {
        "mode": "custom",
        "root_directory": str(root),
        "txt": {"enabled": True},
        "markdown": {"enabled": False},
        "srt": {"enabled": True},
        "preserve_source_txt": False,
        "conflict_policy": "auto_rename",
    }

    plan = output_store.build_configurable_output_plans([media], policy)[0]

    assert plan.primary_srt == root / "lesson (2).srt"
    assert plan.primary_srt_txt is None
    assert plan.primary_txt == root / "lesson (2).txt"
