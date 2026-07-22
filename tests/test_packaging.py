import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_release_versions_are_synchronized():
    pyproject = (ROOT / "pyproject.toml").read_text(encoding="utf-8")
    cargo = (ROOT / "apps/desktop/src-tauri/Cargo.toml").read_text(encoding="utf-8")
    tauri = json.loads(
        (ROOT / "apps/desktop/src-tauri/tauri.conf.json").read_text(encoding="utf-8")
    )
    package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
    python_version = re.search(r'^version = "([^"]+)"$', pyproject, re.MULTILINE)
    cargo_version = re.search(r'^version = "([^"]+)"$', cargo, re.MULTILINE)
    assert python_version is not None
    assert cargo_version is not None
    assert {
        python_version.group(1),
        cargo_version.group(1),
        tauri["version"],
        package["version"],
    } == {"0.1.0"}


def test_release_config_is_offline_nsis_with_bounded_resources():
    config = json.loads(
        (ROOT / "apps/desktop/src-tauri/tauri.release.conf.json").read_text(
            encoding="utf-8"
        )
    )
    bundle = config["bundle"]
    assert bundle["active"] is True
    assert bundle["targets"] == ["nsis"]
    assert bundle["windows"]["webviewInstallMode"] == {
        "type": "offlineInstaller"
    }
    assert bundle["windows"]["nsis"]["installMode"] == "currentUser"
    assert set(bundle["resources"].values()) == {
        "worker/",
        "distribution/",
    }
    assert bundle["windows"]["nsis"]["installerHooks"].endswith(
        "installer-hooks.nsh"
    )
    hooks = (
        ROOT / "apps/desktop/src-tauri/windows/installer-hooks.nsh"
    ).read_text(encoding="utf-8")
    assert '$EXEDIR\\models\\large-v3-turbo\\model.bin' in hooks
    assert '$INSTDIR\\models\\large-v3-turbo' in hooks
    assert "NSIS_HOOK_PREUNINSTALL" in hooks
    assert 'RMDir /r "$INSTDIR\\models\\large-v3-turbo"' in hooks


def test_worker_bundle_is_onedir_and_release_has_no_legacy_gui_dependency():
    spec = (ROOT / "packaging/worker.spec").read_text(encoding="utf-8")
    build_script = (ROOT / "packaging/build_release.ps1").read_text(encoding="utf-8")
    finish_script = (ROOT / "packaging/finish_release.ps1").read_text(encoding="utf-8")
    build_requirements = (ROOT / "packaging/requirements-build.txt").read_text(encoding="utf-8")
    pyproject = (ROOT / "pyproject.toml").read_text(encoding="utf-8")
    assert "COLLECT(" in spec
    assert (
        'excludes=["tkinter", "pytest", "torch", "torchvision", "torchaudio"]'
        in spec
    )
    assert 'hiddenimports = ["pynvml"]' in spec
    assert "PyQt5" not in spec
    assert "Copy-Item -LiteralPath $WorkerSource" in build_script
    assert "Copy-Item -LiteralPath $BuildEnv" not in build_script
    assert "PyQt5" not in build_requirements
    assert "PyQt5" not in pyproject
    assert 'Join-Path $PortableRoot "launch.vbs"' not in finish_script


def test_release_commands_use_project_tool_versions_and_portable_paths():
    package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
    web_package = json.loads(
        (ROOT / "apps/web/package.json").read_text(encoding="utf-8")
    )
    finish_script = (ROOT / "packaging/finish_release.ps1").read_text(
        encoding="utf-8"
    )
    pnpm_scripts = {
        "build",
        "check",
        "desktop:build",
        "desktop:dev",
        "e2e",
        "lint",
        "test",
        "typecheck",
    }
    assert all(
        "corepack pnpm" in package["scripts"][name]
        for name in pnpm_scripts
    )
    assert "corepack pnpm" in web_package["scripts"]["e2e"]
    assert "C:\\Users\\Administrator" not in finish_script
    assert "CARGO_HOME" in finish_script
