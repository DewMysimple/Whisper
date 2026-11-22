"""Read build metadata embedded alongside the frozen Worker modules."""

import json
from pathlib import Path


def _read_worker_build() -> dict[str, str] | None:
    try:
        stamp = json.loads(Path(__file__).with_name("worker-build.json").read_text(encoding="utf-8"))
        if isinstance(stamp, dict) and all(isinstance(stamp.get(key), str) for key in ("revision", "builtAt")):
            return stamp
    except (OSError, ValueError):
        pass
    return None


WORKER_BUILD = _read_worker_build()
