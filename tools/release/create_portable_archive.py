"""Create a ZIP whose root is the content of the portable application folder."""

from __future__ import annotations

import argparse
import os
import zipfile
from pathlib import Path


STORE_THRESHOLD = 128 * 1024 * 1024


def create_archive(source: Path, output: Path) -> None:
    source = source.resolve()
    output = output.resolve()
    if not source.is_dir():
        raise ValueError(f"portable source directory does not exist: {source}")
    if output == source or source in output.parents:
        raise ValueError("archive output must be outside the portable source directory")

    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_name(f"{output.name}.tmp")
    temporary.unlink(missing_ok=True)
    try:
        with zipfile.ZipFile(temporary, "w", allowZip64=True) as archive:
            for path in sorted(source.rglob("*")):
                if not path.is_file():
                    continue
                relative = path.relative_to(source).as_posix()
                if path.stat().st_size >= STORE_THRESHOLD:
                    archive.write(path, relative, compress_type=zipfile.ZIP_STORED)
                else:
                    archive.write(
                        path,
                        relative,
                        compress_type=zipfile.ZIP_DEFLATED,
                        compresslevel=6,
                    )
        os.replace(temporary, output)
    finally:
        temporary.unlink(missing_ok=True)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    create_archive(args.source, args.output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
