"""Smoke-test a normal wheel install outside the repository src tree."""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]


def run(command, *, cwd, env=None):
    return subprocess.run(
        command,
        cwd=cwd,
        env=env,
        capture_output=True,
        text=True,
        check=False,
        timeout=120,
    )


def test_wheel_install_supports_module_console_resource_and_check(tmp_path):
    prefix = tmp_path / "installed-prefix"
    python = Path(sys.executable)
    console = prefix / "Scripts" / "whisper-subtitle.exe"
    installed = run(
        [
            str(python),
            "-m",
            "pip",
            "install",
            "--no-deps",
            "--no-build-isolation",
            "--ignore-installed",
            "--prefix",
            str(prefix),
            str(PROJECT_ROOT),
        ],
        cwd=tmp_path,
    )
    assert installed.returncode == 0, installed.stdout + installed.stderr

    environment = os.environ.copy()
    environment["PYTHONPATH"] = str(prefix / "Lib" / "site-packages")
    environment["WHISPER_SUBTITLE_MODEL_DIR"] = str(
        PROJECT_ROOT / "models" / "huggingface"
    )
    module_help = run(
        [str(python), "-m", "whisper_subtitle", "--help"],
        cwd=tmp_path,
        env=environment,
    )
    console_help = run([str(console), "--help"], cwd=tmp_path, env=environment)
    resource_check = run(
        [
            str(python),
            "-c",
            (
                "from whisper_subtitle.paths import AppPaths; "
                "d=AppPaths.discover(portable_root=False).read_resource('logo.png'); "
                "assert d[:8] == b'\\x89PNG\\r\\n\\x1a\\n'"
            ),
        ],
        cwd=tmp_path,
        env=environment,
    )
    capability_check = run(
        [str(python), "-m", "whisper_subtitle", "check"],
        cwd=tmp_path,
        env=environment,
    )

    assert module_help.returncode == 0, module_help.stderr
    assert console_help.returncode == 0, console_help.stderr
    assert resource_check.returncode == 0, resource_check.stderr
    assert capability_check.returncode == 0, capability_check.stderr
    assert "环境自检通过" in capability_check.stdout
