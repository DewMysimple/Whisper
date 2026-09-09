from __future__ import annotations

import runpy
import subprocess
import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
MEMORY_LINT_PATH = PROJECT_ROOT / "wiki-memory" / "工具" / "memory_lint.py"


def _memory_lint_namespace() -> dict[str, object]:
    return runpy.run_path(str(MEMORY_LINT_PATH), run_name="memory_lint_test")


def test_memory_lint_check_passes() -> None:
    result = subprocess.run(
        [sys.executable, str(MEMORY_LINT_PATH), "check"],
        cwd=PROJECT_ROOT,
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0, result.stdout + result.stderr


def test_log_goal_supports_heading_style_logs() -> None:
    namespace = _memory_lint_namespace()
    page_type = namespace["Page"]
    log_goal = namespace["log_goal"]
    page = page_type(
        Path("日志/示例.md"),
        {"type": "log"},
        "# 示例\n\n## 目标\n\n完成定期维护。\n\n## 变更\n\n- 示例",
    )

    assert log_goal(page) == "完成定期维护。"


def test_memory_lint_rejects_unknown_importance(tmp_path: Path) -> None:
    namespace = _memory_lint_namespace()
    load_pages = namespace["load_pages"]
    validate_pages = namespace["validate_pages"]
    state_dir = tmp_path / "当前状态"
    state_dir.mkdir()
    (state_dir / "示例.md").write_text(
        """---
type: state
status: active
kind: maintenance
importance: normal
updated: 2026-09-09
topic: example
source_logs: []
---

# 示例
""",
        encoding="utf-8",
    )

    errors = validate_pages(tmp_path, load_pages(tmp_path))

    assert "当前状态/示例.md: invalid importance 'normal'" in errors
