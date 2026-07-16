"""Environment checks validate runtime capabilities, not source file layout."""

from __future__ import annotations

from pathlib import Path

from whisper_subtitle.paths import AppPaths
from whisper_subtitle.infrastructure.environment_check import (
    check_environment,
    check_worker_environment,
)


def test_environment_check_reports_missing_dependencies_and_actionable_model(tmp_path):
    paths = AppPaths.discover(
        explicit_model_dir=tmp_path / "missing-models",
        portable_root=False,
        environ={},
    )

    errors = check_environment(
        paths,
        find_spec=lambda name: None if name == "faster_whisper" else object(),
    )

    assert any("faster_whisper" in error for error in errors)
    assert any("WHISPER_SUBTITLE_MODEL_DIR" in error for error in errors)
    assert not any("WhisperProject" in error or "src" in error for error in errors)


def test_legacy_vbs_launcher_is_retired():
    assert not Path("launch.vbs").exists()


def test_legacy_environment_check_path_forwards_to_canonical_implementation():
    from whisper_subtitle.infrastructure import environment_check
    from whisper_subtitle.utils import test_env

    assert test_env.check_environment is environment_check.check_environment
    assert test_env.main is environment_check.main


def test_worker_environment_uses_only_headless_runtime_requirements(tmp_path):
    model_root = tmp_path / "models"
    snapshot = model_root / "hub" / "models--Systran--faster-whisper-large-v3-turbo" / "snapshots" / "one"
    snapshot.mkdir(parents=True)
    (snapshot / "config.json").write_text("{}", encoding="utf-8")
    (snapshot / "model.bin").touch()
    paths = AppPaths.discover(
        explicit_model_dir=model_root,
        portable_root=False,
        environ={},
    )

    errors = check_worker_environment(
        paths,
        find_spec=lambda name: object(),
    )

    assert errors == []
