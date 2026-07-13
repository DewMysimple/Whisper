"""Lock the dependency decisions proven by the batch 9 candidate environment."""

from __future__ import annotations

import ast
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
REMOVED = {"torch", "torchaudio", "torchvision"}


def test_removed_pytorch_packages_are_not_declared():
    declarations = (
        (PROJECT_ROOT / "pyproject.toml").read_text(encoding="utf-8")
        + (PROJECT_ROOT / "requirements.txt").read_text(encoding="utf-8")
    ).lower()

    for package in REMOVED:
        assert package not in declarations


def test_production_source_has_no_removed_pytorch_imports():
    imported = set()
    source_root = PROJECT_ROOT / "src" / "whisper_subtitle"
    for path in source_root.rglob("*.py"):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                imported.update(alias.name.split(".")[0] for alias in node.names)
            elif isinstance(node, ast.ImportFrom) and node.module:
                imported.add(node.module.split(".")[0])

    assert imported.isdisjoint(REMOVED)


def test_windows_cuda_runtime_is_declared_without_pytorch():
    declarations = (
        (PROJECT_ROOT / "pyproject.toml").read_text(encoding="utf-8")
        + (PROJECT_ROOT / "requirements.txt").read_text(encoding="utf-8")
    ).lower()

    assert "nvidia-cublas-cu12>=12.0,<13" in declarations
