# -*- mode: python ; coding: utf-8 -*-

from pathlib import Path

from PyInstaller.utils.hooks import collect_all, collect_data_files, copy_metadata


PROJECT_ROOT = Path(SPEC).resolve().parent.parent
SOURCE_ROOT = PROJECT_ROOT / "src"

datas = collect_data_files("whisper_subtitle")
binaries = []
# pynvml is imported dynamically by the performance sampler. PyInstaller cannot
# discover that import from static analysis, so the frozen Worker must declare it.
hiddenimports = ["pynvml"]

for distribution in (
    "whisper_subtitle",
    "faster-whisper",
    "ctranslate2",
    "tokenizers",
    "huggingface-hub",
    "nvidia-ml-py",
    "nvidia-cublas-cu12",
    "opencc",
):
    try:
        datas += copy_metadata(distribution)
    except Exception:
        pass

for package in (
    "faster_whisper",
    "ctranslate2",
    "av",
    "onnxruntime",
    "tokenizers",
    "nvidia.cublas",
    "opencc",
):
    package_datas, package_binaries, package_hiddenimports = collect_all(package)
    datas += package_datas
    binaries += package_binaries
    hiddenimports += package_hiddenimports

a = Analysis(
    [str(PROJECT_ROOT / "packaging" / "worker_entry.py")],
    pathex=[str(SOURCE_ROOT)],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    # Torch is not part of the Worker runtime. Excluding optional ML stacks
    # keeps a developer environment with Torch installed from inflating the
    # frozen onedir by several gigabytes through PyInstaller's optional hooks.
    excludes=["tkinter", "pytest", "torch", "torchvision", "torchaudio"],
    noarchive=False,
    optimize=1,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="whisper-subtitle-worker",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    version=str(PROJECT_ROOT / "packaging" / "windows_version_info.txt"),
)
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name="whisper-subtitle-worker",
)
