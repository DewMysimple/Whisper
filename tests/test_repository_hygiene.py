"""Guards for repository layout, generated artifacts, and current README links."""

from __future__ import annotations

import runpy
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
HYGIENE_SCRIPT = PROJECT_ROOT / "scripts" / "check_repository_hygiene.py"


def test_repository_hygiene_policy_is_satisfied():
    module = runpy.run_path(str(HYGIENE_SCRIPT), run_name="repository_hygiene")
    assert module["collect_errors"]() == []
