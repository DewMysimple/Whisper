"""Environment checks validate runtime capabilities, not source file layout."""

from __future__ import annotations

from pathlib import Path

from whisper_subtitle.paths import AppPaths
from whisper_subtitle.infrastructure.environment_check import check_environment


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


def test_launch_uses_module_entry_and_interpreter_discovery_not_source_scripts():
    launch = Path("launch.vbs").read_text(encoding="utf-8")

    assert "WHISPER_SUBTITLE_PYTHON" in launch
    assert "-m whisper_subtitle check" in launch
    assert "-m whisper_subtitle gui" in launch
    assert "src\\whisper_subtitle" not in launch


def test_legacy_environment_check_path_forwards_to_canonical_implementation():
    from whisper_subtitle.infrastructure import environment_check
    from whisper_subtitle.utils import test_env

    assert test_env.check_environment is environment_check.check_environment
    assert test_env.main is environment_check.main
