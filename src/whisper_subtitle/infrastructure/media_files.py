"""Media-file discovery without model or user-interface dependencies."""

from __future__ import annotations

from pathlib import Path


SUPPORTED_MEDIA_EXTENSIONS = frozenset(
    {
        ".mp4",
        ".mkv",
        ".avi",
        ".mov",
        ".wmv",
        ".flv",
        ".webm",
        ".m4v",
        ".mpeg",
        ".mpg",
        ".mp3",
        ".wav",
        ".m4a",
        ".aac",
        ".ogg",
    }
)


class MediaDiscoveryError(ValueError):
    """Raised when an input path cannot produce a supported media list."""


def is_supported_media_file(path: Path | str) -> bool:
    candidate = Path(path)
    return candidate.is_file() and candidate.suffix.lower() in SUPPORTED_MEDIA_EXTENSIONS


def discover_media_files(input_path: Path | str) -> list[Path]:
    """Return supported media in the historical recursive sorted order."""
    candidate = Path(input_path)
    if candidate.is_file():
        if candidate.suffix.lower() not in SUPPORTED_MEDIA_EXTENSIONS:
            raise MediaDiscoveryError(
                f"❌ 错误: 不支持的文件格式 {candidate.suffix}"
            )
        return [candidate]

    if candidate.is_dir():
        media_files = sorted(
            path
            for path in candidate.rglob("*")
            if is_supported_media_file(path)
        )
        if media_files:
            return media_files
        supported = ", ".join(sorted(SUPPORTED_MEDIA_EXTENSIONS))
        raise MediaDiscoveryError(f"❌ 未找到媒体文件，支持格式: {supported}")

    raise MediaDiscoveryError(f"❌ 错误: 输入路径不存在 {candidate}")
