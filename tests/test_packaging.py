import json
import re
import runpy
import zipfile
from pathlib import Path

import pytest


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


def test_tauri_development_uses_loopback_vite_and_release_keeps_static_assets():
    root_package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
    web_package = json.loads(
        (ROOT / "apps/web/package.json").read_text(encoding="utf-8")
    )
    tauri = json.loads(
        (ROOT / "apps/desktop/src-tauri/tauri.conf.json").read_text(
            encoding="utf-8"
        )
    )
    vite = (ROOT / "apps/web/vite.config.ts").read_text(encoding="utf-8")

    assert web_package["scripts"]["dev"] == "vite"
    assert root_package["scripts"]["web:dev"].endswith(
        "--filter @whisper-subtitle/web dev"
    )
    assert root_package["scripts"]["desktop:dev"].endswith(
        "--filter @whisper-subtitle/desktop tauri dev"
    )
    assert root_package["scripts"]["dev"] == "corepack pnpm desktop:dev"
    assert "pnpm build" not in root_package["scripts"]["desktop:dev"]
    assert tauri["build"] == {
        "beforeDevCommand": "corepack pnpm --filter @whisper-subtitle/web dev",
        "devUrl": "http://127.0.0.1:1420",
        "frontendDist": "../../web/dist",
    }
    assert "host: '127.0.0.1'" in vite
    assert "port: 1420" in vite
    assert "strictPort: true" in vite


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
    assert 'excludes += ["torch", "transformers"]' in spec
    assert 'WHISPER_SUBTITLE_BUNDLE_QWEN' in spec
    assert '[switch]$WhisperOnly' in build_script
    assert 'stage_models.py' in build_script
    assert 'hiddenimports = ["pynvml"]' in spec
    assert "PyQt5" not in spec
    assert "Move-Item -LiteralPath $WorkerSource" in build_script
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
    assert "Resolve-ReleaseCargo" in finish_script
    assert "CARGO_HOME" in (RELEASE_TOOLS / "prerequisites.ps1").read_text(encoding="utf-8")


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
    assert 'Join-Path $PortableStage "_internal"' in assemble_script
    assert 'Join-Path $InternalStage "models\\*"' in assemble_script
    assert "Resolve-WebView2Installer" in assemble_script
    assert "Get-AuthenticodeSignature" in assemble_script
    assert "MicrosoftEdgeWebView2RuntimeInstallerX64.exe" in assemble_script
    helper = (ROOT / "tools/maintenance/generated_paths.ps1").read_text(encoding="utf-8")
    assert "[Security.Cryptography.SHA256]::Create()" in helper
    assert "Get-Sha256 $file" in assemble_script
    assert "Get-FileHash" not in assemble_script
    assert '"Close the running WhisperSubtitle' in assemble_script
    assert '-not $_.HasExited' in assemble_script
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
        (RELEASE_TOOLS / "prerequisites.ps1").read_text(encoding="utf-8"),
        (RELEASE_TOOLS / "archive.ps1").read_text(encoding="utf-8"),
    ]
    assert all(script.isascii() for script in scripts)
    assert '"user_guide.zh-CN.md"' in scripts[1]
    assert "[char]0x4F7F" in scripts[1]
    assert (RELEASE_TOOLS / "user_guide.zh-CN.md").is_file()


def test_release_defaults_to_directory_and_removes_intermediates_after_success():
    build = (RELEASE_TOOLS / "build.ps1").read_text(encoding="utf-8")
    assemble = (RELEASE_TOOLS / "assemble.ps1").read_text(encoding="utf-8")
    for script in (build, assemble):
        assert "SendToRecycleBin" not in script
        assert "[switch]$IncludeArchive" in script
        assert "[switch]$KeepBuild" in script
    assert 'if ($IncludeArchive) {' in assemble
    assert 'if (-not $KeepBuild) {' in assemble
    assert assemble.index('Assert-LastExitCode "portable release integrity"') < assemble.index('foreach ($owned')
    assert assemble.index('$checksums | Set-Content') < assemble.index('Remove-GeneratedPath -Path $BuildRoot')


@pytest.mark.parametrize("change", ["unchanged", "corrupt", "missing", "extra", "escape", "duplicate"])
def test_release_manifest_verification_checks_complete_tree(tmp_path, monkeypatch, change):
    module = runpy.run_path(str(RELEASE_TOOLS / "generate_release_manifest.py"))
    root = tmp_path / "portable"
    manifest = root / "_internal/release-manifest.json"
    rows = []
    for name in ("WhisperSubtitle.exe", "_internal/worker/whisper-subtitle-worker.exe",
                 "_internal/models/large-v3-turbo/model.bin"):
        path = root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"runtime")
        rows.append({"path": name, "size": path.stat().st_size, "sha256": module["sha256"](path)})
    if change == "corrupt":
        (root / rows[0]["path"]).write_bytes(b"changed")
    elif change == "missing":
        (root / rows[0]["path"]).unlink()
    elif change == "extra":
        (root / "unknown").write_bytes(b"extra")
    elif change == "escape":
        rows[0]["path"] = "../outside.exe"
    elif change == "duplicate":
        rows.append(rows[0].copy())
    manifest.write_text(json.dumps({"schemaVersion": 1, "product": "WhisperSubtitle", "files": rows}))
    monkeypatch.chdir(tmp_path)
    if change == "unchanged":
        assert module["verify_manifest"](Path("portable"), Path("portable/_internal/release-manifest.json")) == 4
    else:
        with pytest.raises((ValueError, FileNotFoundError)):
            module["verify_manifest"](root, manifest)


def _write_model_asset(model_root, model_id):
    from whisper_subtitle.domain.models import ASSETS_BY_ID

    definition = ASSETS_BY_ID[model_id]
    target = model_root / model_id
    target.mkdir(parents=True)
    for name in definition.required_files:
        (target / name).write_bytes(b"artifact")
    if definition.config_model_type:
        (target / "config.json").write_text(json.dumps({
            "model_type": definition.config_model_type,
            "architectures": [definition.config_architecture],
        }))
        (target / "model.safetensors").write_bytes(b"weights")
    return target


def _write_portable_runtime(root):
    for name in ("WhisperSubtitle.exe", "_internal/worker/whisper-subtitle-worker.exe",
                 "_internal/worker/_internal/shared.dll"):
        path = root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"runtime")


@pytest.mark.parametrize("change", [
    "unchanged", "missing-companion", "missing-weights", "invalid-config", "extra-model",
    "empty-selection", "unknown-model", "duplicate-model", "companion-as-model", "wrong-type",
])
def test_selected_manifest_requires_exact_complete_registered_bundles(tmp_path, change):
    module = runpy.run_path(str(RELEASE_TOOLS / "generate_release_manifest.py"))
    root = tmp_path / "portable"
    _write_portable_runtime(root)
    model_root = root / "_internal/models"
    model = _write_model_asset(model_root, "qwen3-asr-1.7b")
    if change != "missing-companion":
        _write_model_asset(model_root, "qwen3-forced-aligner-0.6b")
    if change == "missing-weights":
        (model / "model.safetensors").unlink()
    elif change == "invalid-config":
        (model / "config.json").write_text('{}')
    elif change == "extra-model":
        _write_model_asset(model_root, "large-v3-turbo")
    manifest = root / "_internal/release-manifest.json"
    # Hash the complete tree before attaching the explicit selection, so the
    # negative cases exercise catalog validation rather than incidental hashes.
    module["generate_manifest"](root, manifest, "0.1.0")
    payload = json.loads(manifest.read_text(encoding="utf-8"))
    payload["modelIds"] = {
        "empty-selection": [], "unknown-model": ["unknown"],
        "duplicate-model": ["qwen3-asr-1.7b", "qwen3-asr-1.7b"],
        "companion-as-model": ["qwen3-forced-aligner-0.6b"],
        "wrong-type": "qwen3-asr-1.7b",
    }.get(change, ["qwen3-asr-1.7b"])
    manifest.write_text(json.dumps(payload), encoding="utf-8")
    if change == "unchanged":
        assert module["verify_manifest"](root, manifest) == len(payload["files"]) + 1
        assert not (model_root / "large-v3-turbo").exists()
    else:
        with pytest.raises((ValueError, FileNotFoundError)):
            module["verify_manifest"](root, manifest)


def test_selected_manifest_can_share_one_catalog_companion(tmp_path):
    module = runpy.run_path(str(RELEASE_TOOLS / "generate_release_manifest.py"))
    root = tmp_path / "portable"
    _write_portable_runtime(root)
    for model in ("qwen3-asr-1.7b", "qwen3-asr-0.6b", "qwen3-forced-aligner-0.6b"):
        _write_model_asset(root / "_internal/models", model)
    manifest = root / "_internal/release-manifest.json"
    selected = ["qwen3-asr-1.7b", "qwen3-asr-0.6b"]
    module["generate_manifest"](root, manifest, "0.1.0", selected)
    payload = json.loads(manifest.read_text(encoding="utf-8"))
    assert payload["modelIds"] == selected
    assert module["verify_manifest"](root, manifest) == len(payload["files"]) + 1


def _selected_release_fixture(tmp_path):
    module = runpy.run_path(str(RELEASE_TOOLS / "prepare_selected_portable.py"))
    source = tmp_path / "dist/WhisperSubtitle"
    stage = tmp_path / "build/release-selected/WhisperSubtitle-qwen3-asr-1.7b"
    _write_portable_runtime(source)
    (source / "使用说明.md").write_text(
        (RELEASE_TOOLS / "user_guide.zh-CN.md").read_text(encoding="utf-8"), encoding="utf-8",
    )
    for model in ("large-v3-turbo", "qwen3-asr-1.7b", "qwen3-asr-0.6b", "qwen3-forced-aligner-0.6b"):
        _write_model_asset(source / "_internal/models", model)
    module["generate_manifest"](source, source / module["MANIFEST"], "0.1.0")
    return module, source, stage


def test_selected_portable_preserves_source_and_reuses_only_intact_stage(tmp_path, monkeypatch):
    module, source, stage = _selected_release_fixture(tmp_path)
    original = {p.relative_to(source): p.read_bytes() for p in source.rglob("*") if p.is_file()}
    prepare = module["prepare_selected_portable"]
    assert prepare(source, stage, "qwen3-asr-1.7b", repository_root=tmp_path) == stage
    assert {p.name for p in (stage / "_internal/models").iterdir()} == {
        "qwen3-asr-1.7b", "qwen3-forced-aligner-0.6b",
    }
    assert {p.relative_to(source): p.read_bytes() for p in source.rglob("*") if p.is_file()} == original
    for relative, content in original.items():
        if relative.parts[:2] != ("_internal", "models") and relative not in (
            Path("使用说明.md"), module["MANIFEST"],
        ):
            assert (stage / relative).read_bytes() == content
    guide = (stage / "使用说明.md").read_text(encoding="utf-8")
    assert "首次启动请在“模型与参数”中选择“Qwen3-ASR 1.7B”" in guide
    assert "Qwen3-ASR 提供 1.7B 和 0.6B 两档" not in guide
    assert "WhisperSubtitle-qwen3-asr-1.7b.zip" in guide
    assert "`WhisperSubtitle.zip`" not in guide
    manifest = json.loads((stage / module["MANIFEST"]).read_text(encoding="utf-8"))
    assert manifest["modelIds"] == ["qwen3-asr-1.7b"]
    monkeypatch.setattr(module["shutil"], "copy2", lambda *_: pytest.fail("intact stage should be reused"))
    assert prepare(source, stage, "qwen3-asr-1.7b", repository_root=tmp_path) == stage


@pytest.mark.parametrize("change", ["unknown-stage", "stale-stage", "corrupt-source", "outside-stage", "source-stage"])
def test_selected_portable_refuses_unowned_or_unverified_paths_without_removing_them(tmp_path, change):
    module, source, stage = _selected_release_fixture(tmp_path)
    prepare = module["prepare_selected_portable"]
    if change == "unknown-stage":
        stage.mkdir(parents=True)
        (stage / "keep.txt").write_bytes(b"unrelated")
    elif change == "stale-stage":
        prepare(source, stage, "qwen3-asr-1.7b", repository_root=tmp_path)
        marker = json.loads((stage / module["MARKER"]).read_text(encoding="utf-8"))
        marker["sourceManifestSha256"] = "0" * 64
        (stage / module["MARKER"]).write_text(json.dumps(marker), encoding="utf-8")
        module["generate_manifest"](stage, stage / module["MANIFEST"], "0.1.0", ["qwen3-asr-1.7b"])
    elif change == "corrupt-source":
        (source / "WhisperSubtitle.exe").write_bytes(b"changed")
    elif change == "outside-stage":
        stage = tmp_path / "unrelated"
    elif change == "source-stage":
        stage = source
    original = {p.relative_to(tmp_path): p.read_bytes() for p in tmp_path.rglob("*") if p.is_file()}
    with pytest.raises((ValueError, FileNotFoundError)):
        prepare(source, stage, "qwen3-asr-1.7b", repository_root=tmp_path)
    assert {p.relative_to(tmp_path): p.read_bytes() for p in tmp_path.rglob("*") if p.is_file()} == original


def test_selected_portable_rejects_linked_stage_ancestor(tmp_path):
    module, source, stage = _selected_release_fixture(tmp_path)
    target = tmp_path / "keep"
    target.mkdir()
    stage.parent.mkdir(parents=True)
    try:
        stage.symlink_to(target, target_is_directory=True)
    except OSError:
        pytest.skip("Creating directory symlinks requires Windows developer mode or permission")
    with pytest.raises(ValueError, match="Linked release path"):
        module["prepare_selected_portable"](source, stage, "qwen3-asr-1.7b", repository_root=tmp_path)
    assert stage.is_symlink()
    assert not list(target.iterdir())
