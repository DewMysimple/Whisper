"""Measure repository file bytes without following dependency links or junctions."""

from __future__ import annotations

import argparse
from collections import defaultdict
import json
import os
from pathlib import Path


def linked(path: Path) -> bool:
    return path.is_symlink() or getattr(os.path, "isjunction", lambda _: False)(path)


def measure(root: Path) -> dict:
    totals: dict[str, int] = defaultdict(int)
    count = 0

    def failed(error: OSError) -> None:
        raise error

    for parent, dirs, files in os.walk(root, followlinks=False, onerror=failed):
        dirs[:] = [name for name in dirs if not linked(Path(parent) / name)]
        for name in files:
            path = Path(parent) / name
            if linked(path):
                continue
            totals[path.relative_to(root).parts[0]] += path.stat().st_size
            count += 1
    return {"bytes": sum(totals.values()), "files": count,
            "directories": dict(sorted(totals.items(), key=lambda row: -row[1]))}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    result = measure(Path(__file__).resolve().parents[2])
    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        print(f"Total: {result['bytes']:,} bytes ({result['bytes'] / 2**30:.2f} GiB), {result['files']:,} files")
        for name, size in result["directories"].items():
            if size >= 1024**2:
                print(f"{size / 2**30:8.2f} GiB  {name}")
