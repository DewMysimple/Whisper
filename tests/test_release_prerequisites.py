"""Exercise the real Windows entry points without inference/build dependencies."""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
POWERSHELL = shutil.which("powershell.exe")


def ps_literal(value: str | Path) -> str:
    return "'" + str(value).replace("'", "''") + "'"


@unittest.skipUnless(os.name == "nt" and POWERSHELL, "Windows PowerShell entry points")
class ReleasePrerequisiteTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="release prerequisites ")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name) / "project with spaces"
        self.root.mkdir()
        for relative in (
            "buildStart.cmd", "package.json", "pyproject.toml",
            "apps/desktop/src-tauri/tauri.conf.json", "apps/desktop/src-tauri/Cargo.toml",
            "tools/release/build.ps1", "tools/release/prerequisites.ps1",
            "tools/release/stage_models.py", "tools/maintenance/generated_paths.ps1",
        ):
            target = self.root / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(ROOT / relative, target)
        shutil.copytree(ROOT / "src", self.root / "src", ignore=shutil.ignore_patterns("__pycache__", "*.egg-info"))
        self.env = os.environ.copy()
        self.env.pop("VIRTUAL_ENV", None)
        self.env.pop("WHISPER_SUBTITLE_MODEL_DIR", None)
        self.env["PATH"] = str(Path(sys.executable).parent) + os.pathsep + self.env["PATH"]
        # Cargo is only discovered, never executed by preflight.
        self.cargo_root = Path(self.temporary.name) / "cargo"
        self.cargo_root.joinpath("bin").mkdir(parents=True)
        self.cargo_root.joinpath("bin/cargo.exe").write_bytes(b"discovery-only fixture")
        self.env["CARGO_HOME"] = str(self.cargo_root)
        self.model_root = self.root / "offline models"
        model = self.model_root / "large-v3-turbo"
        model.mkdir(parents=True)
        # Structural validation fixtures, never passed to an inference engine.
        (model / "config.json").write_text("{}", encoding="utf-8")
        (model / "model.bin").write_bytes(b"structural fixture")
        self.sentinel = self.root / "build/keep.txt"
        self.sentinel.parent.mkdir()
        self.sentinel.write_text("diagnostics", encoding="utf-8")

    def powershell(self, code):
        return subprocess.run(
            [POWERSHELL, "-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", code],
            cwd=self.temporary.name, env=self.env, capture_output=True, text=True,
            errors="replace", timeout=30,
        )

    def resolve_python(self, candidate="", setup=""):
        helper = ps_literal(self.root / "tools/release/prerequisites.ps1")
        return self.powershell(
            f"$ErrorActionPreference = 'Stop'; Set-StrictMode -Version Latest; . {helper}; "
            f"{setup} Resolve-BootstrapPython {ps_literal(self.root)} {ps_literal(candidate)}"
        )

    def check(self):
        script = ps_literal(self.root / "tools/release/build.ps1")
        return self.powershell(f"& {script} -CheckOnly")

    def assert_untouched(self):
        self.assertEqual(self.sentinel.read_text(encoding="utf-8"), "diagnostics")
        self.assertFalse((self.root / "dist").exists())
        self.assertFalse((self.root / "whisper_env").exists())
        self.assertFalse((self.root / "build/release").exists())
        self.assertFalse(list((self.root / "src").rglob("__pycache__")))

    def test_missing_legacy_environment_falls_back_to_path(self):
        result = self.resolve_python()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(Path(result.stdout.strip()), Path(sys.executable))
        self.assert_untouched()

    def test_active_environment_is_used_before_path(self):
        active = Path(self.temporary.name) / "active environment"
        subprocess.run([sys.executable, "-m", "venv", "--without-pip", str(active)], check=True, capture_output=True)
        self.env["VIRTUAL_ENV"] = str(active)
        result = self.resolve_python()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(Path(result.stdout.strip()), active / "Scripts/python.exe")
        explicit = self.resolve_python(sys.executable)
        self.assertEqual(explicit.returncode, 0, explicit.stderr)
        self.assertEqual(Path(explicit.stdout.strip()), Path(sys.executable))

    def test_invalid_explicit_python_is_not_silently_ignored(self):
        result = self.resolve_python(self.root / "missing/python.exe")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Invalid -BootstrapPython", result.stderr)
        self.assert_untouched()

    def test_missing_python_has_actionable_error(self):
        result = self.resolve_python(setup="function Get-Command { return $null }; ")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("whisper_env is optional", result.stderr)

    def test_stale_active_environment_falls_back_to_path(self):
        self.env["VIRTUAL_ENV"] = str(self.root / "removed environment")
        result = self.resolve_python()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(Path(result.stdout.strip()), Path(sys.executable))

    def test_default_build_stops_before_clearing_previous_diagnostics(self):
        script = ps_literal(self.root / "tools/release/build.ps1")
        result = self.powershell(f"& {script}")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Offline model directory is missing", result.stderr)
        self.assert_untouched()

    def test_complete_preflight_uses_relative_model_path_without_building(self):
        script = ps_literal(self.root / "tools/release/build.ps1")
        result = self.powershell(f"& {script} -CheckOnly -ModelDir 'offline models'")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("Models: large-v3-turbo", result.stdout)
        self.assertIn("No build was started", result.stdout)
        self.assert_untouched()

    def test_model_environment_variable_can_be_overridden(self):
        self.env["WHISPER_SUBTITLE_MODEL_DIR"] = str(self.model_root)
        result = self.check()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        script = ps_literal(self.root / "tools/release/build.ps1")
        result = self.powershell(f"& {script} -CheckOnly -ModelDir 'missing models'")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Offline model directory is missing", result.stderr)
        self.assert_untouched()

    def test_missing_models_and_cargo_are_reported_together(self):
        self.env["CARGO_HOME"] = str(self.root / "missing cargo")
        helper = ps_literal(self.root / "tools/release/prerequisites.ps1")
        # Hide any global Cargo installation, preserving real Python/Node probes.
        result = self.powershell(
            f"$ErrorActionPreference = 'Stop'; . {helper}; "
            "function Resolve-ReleaseCargo { throw 'cargo.exe was not found' }; "
            f"Test-ReleasePrerequisites {ps_literal(self.root)} {ps_literal(sys.executable)} '' $true"
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Offline model directory is missing", result.stderr)
        self.assertIn("cargo.exe was not found", result.stderr)
        self.assert_untouched()

    def test_incomplete_model_stops_before_mutation(self):
        (self.model_root / "large-v3-turbo/model.bin").unlink()
        self.env["WHISPER_SUBTITLE_MODEL_DIR"] = str(self.model_root)
        result = self.check()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Offline model validation failed", result.stderr)
        self.assert_untouched()

    def test_cmd_forwards_arguments_and_preserves_success_and_failure(self):
        command = f'echo.|"{self.root / "buildStart.cmd"}" -CheckOnly -ModelDir "{self.model_root}"'
        for suffix, expected in (("", 0), (' -BootstrapPython "missing.exe"', 1)):
            with self.subTest(expected=expected):
                result = subprocess.run(
                    "cmd.exe /d /c " + command + suffix, cwd=self.temporary.name,
                    env=self.env, capture_output=True, text=True, errors="replace", timeout=30,
                )
                self.assertEqual(result.returncode, expected, result.stdout + result.stderr)
                self.assertNotIn("Build completed successfully", result.stdout)
                if expected == 0:
                    self.assertIn("Local prerequisite check passed", result.stdout)
                else:
                    self.assertIn("Release command failed", result.stdout)
                self.assert_untouched()


if __name__ == "__main__":
    unittest.main()
