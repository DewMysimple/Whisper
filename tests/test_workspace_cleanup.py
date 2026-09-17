from __future__ import annotations

import shutil
import subprocess
from pathlib import Path


REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
CLEANUP_SCRIPT = REPOSITORY_ROOT / "tools" / "maintenance" / "clean_workspace.ps1"


def _prepare_repository(tmp_path: Path) -> Path:
    repository = tmp_path / "repository"
    script_target = repository / "tools" / "maintenance" / CLEANUP_SCRIPT.name
    script_target.parent.mkdir(parents=True)
    shutil.copy2(CLEANUP_SCRIPT, script_target)

    (repository / ".gitignore").write_text(
        "build/\n.pytest_cache/\n__pycache__/\ndist/\nmodels/\nwhisper_env/\nnode_modules/\n",
        encoding="utf-8",
    )
    source_file = repository / "src" / "package" / "module.py"
    source_file.parent.mkdir(parents=True)
    source_file.write_text("VALUE = 1\n", encoding="utf-8")

    subprocess.run(["git", "init", "--quiet", str(repository)], check=True)
    subprocess.run(["git", "-C", str(repository), "add", "."], check=True)
    return repository


def _run_cleanup(repository: Path, *, apply: bool = False) -> subprocess.CompletedProcess[str]:
    command = [
        "powershell",
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        str(repository / "tools" / "maintenance" / CLEANUP_SCRIPT.name),
    ]
    if apply:
        command.append("-Apply")
    return subprocess.run(command, capture_output=True, text=True, check=False)


def test_workspace_cleanup_removes_only_generated_whitelist(tmp_path: Path) -> None:
    repository = _prepare_repository(tmp_path)
    generated_files = [
        repository / "build" / "old-worker.exe",
        repository / ".pytest_cache" / "state.json",
        repository / "src" / "package" / "__pycache__" / "module.pyc",
    ]
    for generated_file in generated_files:
        generated_file.parent.mkdir(parents=True, exist_ok=True)
        generated_file.write_bytes(b"generated")

    protected_files = [
        repository / "src" / "package" / "module.py",
        repository / "dist" / "WhisperSubtitle" / "WhisperSubtitle.exe",
        repository / "models" / "current-model" / "model.bin",
        repository / "whisper_env" / "Scripts" / "python.exe",
        repository / "node_modules" / ".pnpm" / "package.json",
    ]
    for protected_file in protected_files[1:]:
        protected_file.parent.mkdir(parents=True, exist_ok=True)
        protected_file.write_bytes(b"protected")

    preview = _run_cleanup(repository)
    assert preview.returncode == 0, preview.stderr
    assert "Preview only" in preview.stdout
    assert str(repository / "build") in preview.stdout
    assert str(repository / ".pytest_cache") in preview.stdout
    assert str(protected_files[0]) not in preview.stdout

    applied = _run_cleanup(repository, apply=True)
    assert applied.returncode == 0, applied.stderr
    assert "Workspace generated artifacts were cleaned" in applied.stdout
    assert all(not generated_file.exists() for generated_file in generated_files)
    assert all(protected_file.exists() for protected_file in protected_files)


def test_workspace_cleanup_refuses_tracked_content(tmp_path: Path) -> None:
    repository = _prepare_repository(tmp_path)
    tracked_build_file = repository / "build" / "keep.txt"
    tracked_build_file.parent.mkdir(parents=True)
    tracked_build_file.write_text("tracked\n", encoding="utf-8")
    subprocess.run(
        ["git", "-C", str(repository), "add", "--force", "build/keep.txt"],
        check=True,
    )

    applied = _run_cleanup(repository, apply=True)
    assert applied.returncode != 0
    assert "Refusing to delete tracked content" in applied.stderr
    assert tracked_build_file.exists()
