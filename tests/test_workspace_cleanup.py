from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import pytest


REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
CLEANUP_SCRIPT = REPOSITORY_ROOT / "tools" / "maintenance" / "clean_workspace.ps1"


def _prepare_repository(tmp_path: Path) -> Path:
    repository = tmp_path / "repository"
    script_target = repository / "tools" / "maintenance" / CLEANUP_SCRIPT.name
    script_target.parent.mkdir(parents=True)
    shutil.copy2(CLEANUP_SCRIPT, script_target)
    shutil.copy2(CLEANUP_SCRIPT.with_name("generated_paths.ps1"), script_target.parent)
    release_tools = repository / "tools" / "release"
    release_tools.mkdir(parents=True)
    shutil.copy2(REPOSITORY_ROOT / "tools/release/generate_release_manifest.py", release_tools)

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


def _run_cleanup(repository: Path, *, apply: bool = False, prune: bool = False) -> subprocess.CompletedProcess[str]:
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
    if prune:
        command.append("-PruneReleases")
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


def _portable_release(repository: Path) -> Path:
    root = repository / "dist" / "WhisperSubtitle"
    for relative in ("WhisperSubtitle.exe", "_internal/worker/whisper-subtitle-worker.exe",
                     "_internal/models/large-v3-turbo/model.bin"):
        path = root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"current")
    subprocess.run(["python", str(REPOSITORY_ROOT / "tools/release/generate_release_manifest.py"),
                    str(root), str(root / "_internal/release-manifest.json"), "--version", "0.1.0"], check=True)
    return root


def test_prune_removes_old_releases_and_archive_but_keeps_current(tmp_path: Path) -> None:
    repository = _prepare_repository(tmp_path)
    root = _portable_release(repository)
    old = root.parent / "WhisperSubtitle.previous-20260927"
    old.mkdir()
    (old / "old.exe").write_bytes(b"old")
    archive = root.parent / "WhisperSubtitle.zip"
    archive.write_bytes(b"zip")
    unrelated = root.parent / "user-export.zip"
    unrelated.write_bytes(b"user")
    checksum = root.parent / "WhisperSubtitle.sha256"
    checksum.write_text("hash  WhisperSubtitle.zip\nhash  WhisperSubtitle/WhisperSubtitle.exe\n")
    preview = _run_cleanup(repository, prune=True)
    assert preview.returncode == 0, preview.stderr
    assert archive.exists() and old.exists()
    applied = _run_cleanup(repository, apply=True, prune=True)
    assert applied.returncode == 0, applied.stderr
    assert not old.exists() and not archive.exists()
    assert unrelated.exists() and (root / "WhisperSubtitle.exe").exists()
    assert "WhisperSubtitle.zip" not in checksum.read_text()


def test_prune_refuses_invalid_current_release_before_any_deletion(tmp_path: Path) -> None:
    repository = _prepare_repository(tmp_path)
    root = _portable_release(repository)
    (root / "WhisperSubtitle.exe").write_bytes(b"corrupt")
    build = repository / "build"
    build.mkdir()
    (build / "keep").write_bytes(b"evidence")
    applied = _run_cleanup(repository, apply=True, prune=True)
    assert applied.returncode != 0
    assert build.exists()


@pytest.mark.parametrize("nested", [False, True])
def test_cleanup_refuses_junction_and_preserves_external_files(tmp_path: Path, nested: bool) -> None:
    repository = _prepare_repository(tmp_path)
    outside = tmp_path / "outside"
    outside.mkdir()
    protected = outside / "keep.txt"
    protected.write_bytes(b"keep")
    junction = repository / "build"
    if nested:
        junction.mkdir()
        junction = junction / "linked"
    import _winapi
    _winapi.CreateJunction(str(outside), str(junction))
    applied = _run_cleanup(repository, apply=True)
    assert applied.returncode != 0
    assert "reparse point" in applied.stderr
    assert protected.read_bytes() == b"keep"


def test_archive_command_builds_zip_on_demand_with_valid_checksums(tmp_path: Path) -> None:
    import hashlib
    import zipfile
    repository = _prepare_repository(tmp_path)
    root = _portable_release(repository)
    for name in ("archive.ps1", "create_portable_archive.py"):
        shutil.copy2(REPOSITORY_ROOT / "tools/release" / name, repository / "tools/release")
    result = subprocess.run(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
                             str(repository / "tools/release/archive.ps1")], capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    with zipfile.ZipFile(root.parent / "WhisperSubtitle.zip") as archive:
        assert archive.testzip() is None
        assert "WhisperSubtitle.exe" in archive.namelist()
        assert len(archive.namelist()) == 4
    for line in (root.parent / "WhisperSubtitle.sha256").read_text().splitlines():
        digest, name = line.split("  ", 1)
        assert hashlib.sha256((root.parent / name).read_bytes()).hexdigest() == digest
