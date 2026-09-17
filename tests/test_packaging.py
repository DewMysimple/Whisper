import json
import re
import runpy
import zipfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
RELEASE_TOOLS = ROOT / "tools" / "release"


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


def test_release_config_uses_external_offline_prerequisites_with_bounded_resources():
    config = json.loads(
        (ROOT / "apps/desktop/src-tauri/tauri.release.conf.json").read_text(
            encoding="utf-8"
        )
    )
    bundle = config["bundle"]
    assert bundle["active"] is True
    assert bundle["targets"] == ["nsis"]
    assert bundle["windows"]["webviewInstallMode"] == {"type": "skip"}
    assert bundle["windows"]["nsis"]["installMode"] == "currentUser"
    assert set(bundle["resources"].values()) == {
        "_internal/worker/",
        "_internal/distribution/",
    }
    assert bundle["windows"]["nsis"]["installerHooks"].endswith(
        "installer-hooks.nsh"
    )
    hooks = (
        ROOT / "apps/desktop/src-tauri/windows/installer-hooks.nsh"
    ).read_text(encoding="utf-8")
    assert '$EXEDIR\\_internal\\models\\large-v3-turbo\\model.bin' in hooks
    assert (
        '$EXEDIR\\_internal\\distribution\\MicrosoftEdgeWebView2RuntimeInstallerX64.exe'
        in hooks
    )
    assert "ExecWait" in hooks
    assert '$INSTDIR\\_internal\\models\\large-v3-turbo' in hooks
    assert "NSIS_HOOK_PREUNINSTALL" in hooks
    assert 'RMDir /r "$INSTDIR\\_internal\\models\\large-v3-turbo"' in hooks


def test_worker_bundle_is_onedir_and_release_has_no_legacy_gui_dependency():
    spec = (RELEASE_TOOLS / "worker.spec").read_text(encoding="utf-8")
    build_script = (RELEASE_TOOLS / "build.ps1").read_text(encoding="utf-8")
    finish_script = (RELEASE_TOOLS / "assemble.ps1").read_text(encoding="utf-8")
    build_requirements = (RELEASE_TOOLS / "requirements-build.txt").read_text(encoding="utf-8")
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
    finish_script = (RELEASE_TOOLS / "assemble.ps1").read_text(
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


def test_release_output_has_a_shallow_user_facing_layout():
    package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
    build_script = (RELEASE_TOOLS / "build.ps1").read_text(encoding="utf-8")
    assemble_script = (RELEASE_TOOLS / "assemble.ps1").read_text(encoding="utf-8")

    assert "tools/release/build.ps1" in package["scripts"]["release:build"]
    assert "-IncludeInstaller" not in package["scripts"]["release:build"]
    assert "-IncludeInstaller" in package["scripts"]["release:build:installer"]
    assert 'Join-Path $DistRoot "WhisperSubtitle"' in assemble_script
    assert 'Join-Path $DistRoot "WhisperSubtitle.zip"' in assemble_script
    assert 'Join-Path $ApplicationRoot "WhisperSubtitle.exe"' in assemble_script
    assert 'Join-Path $ApplicationRoot "_internal"' in assemble_script
    assert 'Join-Path $InternalStage "models\\large-v3-turbo"' in assemble_script
    assert "Resolve-WebView2Installer" in assemble_script
    assert "Get-AuthenticodeSignature" in assemble_script
    assert "MicrosoftEdgeWebView2RuntimeInstallerX64.exe" in assemble_script
    assert "[Security.Cryptography.SHA256]::Create()" in assemble_script
    assert "Get-FileHash" not in assemble_script
    assert 'Join-Path $DistRoot "release"' in build_script
    assert "WhisperSubtitle-portable" not in assemble_script
    assert "dist\\release" not in assemble_script


def test_portable_zip_contains_folder_contents_without_an_extra_wrapper(tmp_path):
    source = tmp_path / "WhisperSubtitle"
    internal = source / "_internal" / "worker"
    internal.mkdir(parents=True)
    (source / "WhisperSubtitle.exe").write_bytes(b"desktop")
    (source / "使用说明.md").write_text("说明", encoding="utf-8")
    (internal / "worker.exe").write_bytes(b"worker")
    output = tmp_path / "WhisperSubtitle.zip"

    module = runpy.run_path(str(RELEASE_TOOLS / "create_portable_archive.py"))
    module["create_archive"](source, output)

    with zipfile.ZipFile(output) as archive:
        assert set(archive.namelist()) == {
            "WhisperSubtitle.exe",
            "使用说明.md",
            "_internal/worker/worker.exe",
        }
        assert not any(name.startswith("WhisperSubtitle/") for name in archive.namelist())


def test_release_powershell_sources_are_safe_for_windows_powershell_5():
    scripts = [
        (RELEASE_TOOLS / "build.ps1").read_text(encoding="utf-8"),
        (RELEASE_TOOLS / "assemble.ps1").read_text(encoding="utf-8"),
    ]
    assert all(script.isascii() for script in scripts)
    assert '"user_guide.zh-CN.md"' in scripts[1]
    assert "[char]0x4F7F" in scripts[1]
    assert (RELEASE_TOOLS / "user_guide.zh-CN.md").is_file()
