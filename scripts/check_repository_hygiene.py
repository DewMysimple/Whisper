#!/usr/bin/env python3
"""Check durable repository layout rules without third-party dependencies."""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path
from urllib.parse import unquote


PROJECT_ROOT = Path(__file__).resolve().parents[1]
GENERATED_PREFIXES = (
    "build/",
    "dist/",
    "models/",
    "node_modules/",
    "whisper_env/",
    "apps/web/dist/",
    "apps/web/test-results/",
    "apps/web/playwright-report/",
    "apps/desktop/src-tauri/target/",
    "apps/desktop/src-tauri/gen/",
)
IGNORE_PROBES = (
    "build/.repository-hygiene-probe",
    "dist/release/.repository-hygiene-probe",
    "models/.repository-hygiene-probe",
    "node_modules/.repository-hygiene-probe",
    "whisper_env/.repository-hygiene-probe",
    "apps/web/dist/.repository-hygiene-probe",
    "apps/web/test-results/.repository-hygiene-probe",
    "apps/web/playwright-report/.repository-hygiene-probe",
    "apps/desktop/src-tauri/target/.repository-hygiene-probe",
    "apps/desktop/src-tauri/gen/.repository-hygiene-probe",
    "Whisper.lnk",
)
README_EXCLUDED_PREFIXES = (
    "docs/archive/",
    "wiki-memory/历史归档/",
)
MARKDOWN_LINK = re.compile(r"\[[^\]]*\]\(([^)]+)\)")


def _run_git(*arguments: str) -> subprocess.CompletedProcess[bytes]:
    return subprocess.run(
        ["git", *arguments],
        cwd=PROJECT_ROOT,
        capture_output=True,
        check=False,
    )


def tracked_paths() -> tuple[str, ...]:
    result = _run_git("-c", "core.quotepath=false", "ls-files", "-z")
    if result.returncode != 0:
        raise RuntimeError(result.stderr.decode(errors="replace").strip())
    return tuple(
        item.decode("utf-8").replace("\\", "/")
        for item in result.stdout.split(b"\0")
        if item
    )


def _is_generated_artifact(path: str) -> bool:
    return (
        path.lower().endswith((".lnk", ".pyc", ".pyo"))
        or "__pycache__" in Path(path).parts
        or any(path.startswith(prefix) for prefix in GENERATED_PREFIXES)
    )


def _readme_paths(paths: tuple[str, ...]) -> tuple[Path, ...]:
    return tuple(
        PROJECT_ROOT / path
        for path in paths
        if path.endswith("README.md")
        and not any(path.startswith(prefix) for prefix in README_EXCLUDED_PREFIXES)
    )


def _markdown_link_errors(source: Path) -> list[str]:
    text = source.read_text(encoding="utf-8")
    text = re.sub(r"```.*?```", "", text, flags=re.DOTALL)
    errors = []
    for match in MARKDOWN_LINK.finditer(text):
        raw_target = match.group(1).strip().strip("<>")
        if not raw_target or raw_target.startswith("#"):
            continue
        if re.match(r"^[A-Za-z][A-Za-z0-9+.-]*:", raw_target):
            continue
        target = unquote(raw_target.split("#", 1)[0])
        resolved = (source.parent / target).resolve()
        try:
            resolved.relative_to(PROJECT_ROOT)
        except ValueError:
            errors.append(f"{source.relative_to(PROJECT_ROOT)}: link escapes repository: {raw_target}")
            continue
        if not resolved.exists():
            errors.append(f"{source.relative_to(PROJECT_ROOT)}: broken link: {raw_target}")
    return errors


def collect_errors() -> list[str]:
    errors: list[str] = []
    try:
        paths = tracked_paths()
    except RuntimeError as error:
        return [f"cannot inspect tracked files: {error}"]

    forbidden = sorted(path for path in paths if _is_generated_artifact(path))
    errors.extend(f"tracked generated or machine-local artifact: {path}" for path in forbidden)

    for probe in IGNORE_PROBES:
        result = _run_git("check-ignore", "--no-index", "--quiet", "--", probe)
        if result.returncode != 0:
            errors.append(f"missing ignore coverage: {probe}")

    requirements = PROJECT_ROOT / "requirements.txt"
    declarations = [
        line.strip()
        for line in requirements.read_text(encoding="utf-8").splitlines()
        if line.strip() and not line.lstrip().startswith("#")
    ]
    if declarations != ["-e .[dev]"]:
        errors.append("requirements.txt must delegate to pyproject.toml via '-e .[dev]'")

    for readme in _readme_paths(paths):
        errors.extend(_markdown_link_errors(readme))
    return errors


def main() -> int:
    errors = collect_errors()
    if errors:
        print(f"Repository hygiene check found {len(errors)} issue(s):", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1
    print("Repository hygiene check passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
