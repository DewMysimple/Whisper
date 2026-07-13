"""Tests for the shared media discovery adapter."""

from __future__ import annotations

from pathlib import Path

import pytest

from whisper_subtitle.infrastructure.media_files import (
    SUPPORTED_MEDIA_EXTENSIONS,
    MediaDiscoveryError,
    discover_media_files,
    is_supported_media_file,
)


def test_supported_extension_contract_is_complete_and_immutable():
    assert isinstance(SUPPORTED_MEDIA_EXTENSIONS, frozenset)
    assert SUPPORTED_MEDIA_EXTENSIONS == {
        ".mp4", ".mkv", ".avi", ".mov", ".wmv", ".flv", ".webm",
        ".m4v", ".mpeg", ".mpg", ".mp3", ".wav", ".m4a", ".aac",
        ".ogg",
    }


def test_single_file_accepts_extension_case_insensitively(tmp_path: Path):
    media = tmp_path / "lecture.WAV"
    media.write_bytes(b"fixture")

    assert is_supported_media_file(media)
    assert discover_media_files(media) == [media]


def test_directory_discovery_is_recursive_filtered_and_sorted(tmp_path: Path):
    expected = [
        tmp_path / "A.mp4",
        tmp_path / "b.wav",
        tmp_path / "nested" / "c.OGG",
    ]
    for path in reversed(expected):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"fixture")
    (tmp_path / "ignore.txt").write_text("ignore", encoding="utf-8")

    assert discover_media_files(tmp_path) == sorted(expected)


@pytest.mark.parametrize(
    ("kind", "message"),
    [
        ("missing", "输入路径不存在"),
        ("unsupported", "不支持的文件格式 .txt"),
        ("empty", "未找到媒体文件，支持格式:"),
    ],
)
def test_discovery_errors_preserve_cli_messages(tmp_path: Path, kind: str, message: str):
    if kind == "missing":
        target = tmp_path / "missing.wav"
    elif kind == "unsupported":
        target = tmp_path / "notes.txt"
        target.write_text("notes", encoding="utf-8")
    else:
        target = tmp_path / "empty"
        target.mkdir()

    with pytest.raises(MediaDiscoveryError, match=message):
        discover_media_files(target)
