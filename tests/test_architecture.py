"""Mechanical guards for the post-refactor architecture baseline."""

from __future__ import annotations

import ast
import importlib.util
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
PACKAGE_ROOT = PROJECT_ROOT / "src" / "whisper_subtitle"


def _module_name(path: Path) -> str:
    relative = path.relative_to(PROJECT_ROOT / "src").with_suffix("")
    parts = list(relative.parts)
    if parts[-1] == "__init__":
        parts.pop()
    return ".".join(parts)


def _resolved_internal_imports(path: Path) -> set[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    package = _module_name(path)
    if path.name != "__init__.py":
        package = package.rsplit(".", 1)[0]
    imports = set()
    for node in ast.walk(tree):
        if not isinstance(node, ast.ImportFrom):
            continue
        name = "." * node.level + (node.module or "")
        resolved = importlib.util.resolve_name(name, package) if node.level else name
        if resolved == "whisper_subtitle" or resolved.startswith(
            "whisper_subtitle."
        ):
            imports.add(resolved)
    return imports


def test_production_python_files_use_lowercase_snake_case():
    for path in PACKAGE_ROOT.rglob("*.py"):
        assert path.stem in {"__init__", "__main__"} or (
            path.stem.islower()
            and all(part.isalnum() for part in path.stem.split("_"))
        ), path


def test_removed_compatibility_packages_are_absent():
    assert not (PACKAGE_ROOT / "core").exists()
    assert not (PACKAGE_ROOT / "gui").exists()
    assert not (PACKAGE_ROOT / "presentation" / "gui").exists()
    assert not (PROJECT_ROOT / "tests" / "test_core_cli_paths.py").exists()


def test_domain_has_no_outward_package_dependencies():
    domain_root = PACKAGE_ROOT / "domain"
    for path in domain_root.rglob("*.py"):
        assert all(
            imported == "whisper_subtitle.domain"
            or imported.startswith("whisper_subtitle.domain.")
            for imported in _resolved_internal_imports(path)
        ), path


def test_presentation_does_not_reference_removed_core_dispatch():
    source = "\n".join(
        path.read_text(encoding="utf-8")
        for path in (PACKAGE_ROOT / "presentation").rglob("*.py")
    )
    assert "WhisperProject" not in source
    assert "preset.module" not in source
    assert "preset.script" not in source


def test_production_python_source_has_no_pyqt_dependency():
    source = "\n".join(
        path.read_text(encoding="utf-8") for path in PACKAGE_ROOT.rglob("*.py")
    )
    assert "PyQt5" not in source
    assert "presentation.gui" not in source
