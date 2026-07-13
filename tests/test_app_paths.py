"""Contracts for portable and installed application path discovery."""

from __future__ import annotations

from pathlib import Path

import pytest

from whisper_subtitle.paths import (
    AppPaths,
    ModelLocation,
    ModelNotFoundError,
)


def make_snapshot(root: Path) -> Path:
    snapshot = (
        root
        / "hub"
        / "models--mobiuslabsgmbh--faster-whisper-large-v3-turbo"
        / "snapshots"
        / "revision"
    )
    snapshot.mkdir(parents=True)
    (snapshot / "config.json").write_text("{}", encoding="utf-8")
    (snapshot / "model.bin").write_bytes(b"model")
    return snapshot


def test_portable_paths_use_current_interpreter_and_portable_model_default(tmp_path):
    portable = tmp_path / "portable"
    package = portable / "src" / "whisper_subtitle"
    package.mkdir(parents=True)
    python = tmp_path / "custom-env" / "python.exe"

    paths = AppPaths.discover(
        package_dir=package,
        python_executable=python,
        portable_root=portable,
        environ={},
    )

    assert paths.python_executable == python
    assert paths.working_directory == portable
    assert paths.portable_root == portable
    assert paths.model_location.hf_home == portable / "models" / "huggingface"
    assert paths.model_location.source == "portable"


def test_installed_paths_use_user_cache_without_repo_or_src_assumptions(tmp_path):
    package = tmp_path / "site-packages" / "whisper_subtitle"
    local_app_data = tmp_path / "LocalAppData"

    paths = AppPaths.discover(
        package_dir=package,
        portable_root=False,
        cwd=tmp_path / "work",
        environ={"LOCALAPPDATA": str(local_app_data)},
    )

    assert paths.portable_root is None
    assert paths.working_directory == tmp_path / "work"
    assert paths.model_location.hf_home == (
        local_app_data / "WhisperSubtitle" / "models" / "huggingface"
    )
    assert "src" not in str(paths.working_directory)
    assert paths.model_location.source == "user-cache"


def test_model_location_precedence_is_explicit_then_app_env_then_hf_env(tmp_path):
    portable = tmp_path / "portable"
    explicit = tmp_path / "explicit"
    app_env = tmp_path / "app-env"
    hf_env = tmp_path / "hf-env"
    environment = {
        "WHISPER_SUBTITLE_MODEL_DIR": str(app_env),
        "HF_HOME": str(hf_env),
    }

    explicit_paths = AppPaths.discover(
        explicit_model_dir=explicit,
        portable_root=portable,
        environ=environment,
    )
    app_env_paths = AppPaths.discover(
        portable_root=portable,
        environ=environment,
    )
    hf_env_paths = AppPaths.discover(
        portable_root=portable,
        environ={"HF_HOME": str(hf_env)},
    )

    assert explicit_paths.model_location.hf_home == explicit
    assert explicit_paths.model_location.source == "explicit"
    assert app_env_paths.model_location.hf_home == app_env
    assert app_env_paths.model_location.source == "WHISPER_SUBTITLE_MODEL_DIR"
    assert hf_env_paths.model_location.hf_home == hf_env
    assert hf_env_paths.model_location.source == "HF_HOME"


def test_model_location_resolves_snapshot_or_raises_actionable_error(tmp_path):
    hf_home = tmp_path / "huggingface"
    snapshot = make_snapshot(hf_home)
    location = ModelLocation(hf_home, hf_home / "hub", source="test")

    assert location.require_model("large-v3-turbo") == snapshot

    missing = ModelLocation(
        tmp_path / "missing", tmp_path / "missing" / "hub", source="test"
    )
    with pytest.raises(ModelNotFoundError) as exc_info:
        missing.require_model("large-v3-turbo")
    message = str(exc_info.value)
    assert "WHISPER_SUBTITLE_MODEL_DIR" in message
    assert "--model-dir" in message
    assert str(missing.hub) in message


def test_direct_model_directory_is_supported(tmp_path):
    direct = tmp_path / "direct-model"
    direct.mkdir()
    (direct / "config.json").write_text("{}", encoding="utf-8")
    (direct / "model.bin").write_bytes(b"model")

    paths = AppPaths.discover(
        explicit_model_dir=direct,
        portable_root=False,
        environ={},
    )

    assert paths.model_location.direct_model == direct
    assert paths.model_location.require_model("large-v3-turbo") == direct


def test_packaged_logo_is_available_through_importlib_resources():
    data = AppPaths.discover().read_resource("logo.png")

    assert data.startswith(b"\x89PNG\r\n\x1a\n")
    assert len(data) > 1000
