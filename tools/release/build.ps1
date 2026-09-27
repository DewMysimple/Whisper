[CmdletBinding()]
param(
    [string]$BootstrapPython = "",
    [string]$ModelDir = "",
    [string]$SigningConfig = "",
    [string]$WebView2Installer = "",
    [string]$OutputRoot = "",
    [switch]$IncludeInstaller,
    [switch]$WhisperOnly,
    [switch]$IncludeArchive,
    [switch]$KeepBuild
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$RepositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$BuildRoot = Join-Path $RepositoryRoot "build\release"
$StageRoot = Join-Path $BuildRoot "stage"
$DistRoot = Join-Path $RepositoryRoot "dist"
$IncludeQwen = -not $WhisperOnly

. (Join-Path $RepositoryRoot "tools\maintenance\generated_paths.ps1")

function Assert-LastExitCode([string]$Step) {
    if ($LASTEXITCODE -ne 0) { throw "$Step failed with exit code $LASTEXITCODE" }
}

Push-Location $RepositoryRoot
try {
    $pyproject = Get-Content -Encoding utf8 -Raw "pyproject.toml"
    $tauri = Get-Content -Encoding utf8 -Raw "apps/desktop/src-tauri/tauri.conf.json" | ConvertFrom-Json
    $cargo = Get-Content -Encoding utf8 -Raw "apps/desktop/src-tauri/Cargo.toml"
    $package = Get-Content -Encoding utf8 -Raw "package.json" | ConvertFrom-Json
    $Version = [string]$package.version
    if ($pyproject -notmatch "(?m)^version = `"$([regex]::Escape($Version))`"$" -or
        $tauri.version -ne $Version -or
        $cargo -notmatch "(?m)^version = `"$([regex]::Escape($Version))`"$") {
        throw "Release version $Version is not synchronized across Python, Tauri, Cargo and npm metadata"
    }

    if (-not $BootstrapPython) { $BootstrapPython = Join-Path $RepositoryRoot "whisper_env\Scripts\python.exe" }
    $BootstrapPython = (Resolve-Path -LiteralPath $BootstrapPython).Path
    $ModelSource = if ($ModelDir) { (Resolve-Path -LiteralPath $ModelDir).Path } else { Join-Path $RepositoryRoot "models\huggingface" }
    $ModelArguments = @("--source", $ModelSource)
    if ($IncludeQwen) { $ModelArguments += "--include-qwen" }
    & $BootstrapPython "tools/release/stage_models.py" @ModelArguments
    Assert-LastExitCode "local model bundle validation"

    Remove-GeneratedPath -Path $BuildRoot -RepositoryRoot $RepositoryRoot -AllowedRoots @($BuildRoot)
    New-Item -ItemType Directory -Force -Path $BuildRoot, $StageRoot, $DistRoot | Out-Null

    $BuildEnv = Join-Path $BuildRoot "environment"
    & $BootstrapPython -m venv $BuildEnv
    Assert-LastExitCode "fresh build environment creation"
    $Python = Join-Path $BuildEnv "Scripts\python.exe"
    & $Python -m pip install --disable-pip-version-check --timeout 60 --retries 8 --upgrade pip
    Assert-LastExitCode "pip bootstrap"
    & $Python -m pip install --disable-pip-version-check --timeout 60 --retries 8 -r "tools/release/requirements-worker.txt" -r "tools/release/requirements-build.txt"
    Assert-LastExitCode "pinned release dependencies"

    $WheelRoot = Join-Path $BuildRoot "wheels"
    New-Item -ItemType Directory -Force -Path $WheelRoot | Out-Null
    & $Python -m pip wheel . --no-deps --no-build-isolation --wheel-dir $WheelRoot
    Assert-LastExitCode "project wheel build"
    $Wheels = @(Get-ChildItem -LiteralPath $WheelRoot -Filter "whisper_subtitle-$Version-*.whl")
    if ($Wheels.Count -ne 1) { throw "Expected exactly one project wheel, found $($Wheels.Count)" }
    & $Python -m pip install --no-deps $Wheels[0].FullName
    Assert-LastExitCode "project wheel install"
    if ($IncludeQwen) {
        $TorchRequirement = & $Python -c "import importlib.metadata as m; print(next(r.split(';')[0].strip() for r in m.requires('whisper_subtitle') if r.startswith('torch==')))"
        Assert-LastExitCode "Qwen runtime requirement from project metadata"
        & $Python -m pip install --disable-pip-version-check --timeout 60 --retries 8 $TorchRequirement --index-url "https://download.pytorch.org/whl/cu128"
        Assert-LastExitCode "Qwen CUDA runtime install"
        & $Python -m pip install --disable-pip-version-check --timeout 60 --retries 8 "$($Wheels[0].FullName)[qwen]"
        Assert-LastExitCode "Qwen optional dependencies"
    }
    & $Python -m pip check
    Assert-LastExitCode "fresh build environment pip check"

    $PyInstallerRoot = Join-Path $BuildRoot "pyinstaller"
    $WorkerDist = Join-Path $PyInstallerRoot "dist"
    $WorkerWork = Join-Path $PyInstallerRoot "work"
    $PreviousBundleQwen = $env:WHISPER_SUBTITLE_BUNDLE_QWEN
    try {
        $env:WHISPER_SUBTITLE_BUNDLE_QWEN = if ($IncludeQwen) { "1" } else { "0" }
        & $Python -m PyInstaller --clean --noconfirm --distpath $WorkerDist --workpath $WorkerWork "tools/release/worker.spec"
        Assert-LastExitCode "PyInstaller Worker build"
    } finally { $env:WHISPER_SUBTITLE_BUNDLE_QWEN = $PreviousBundleQwen }
    $WorkerSource = Join-Path $WorkerDist "whisper-subtitle-worker"
    if (-not (Test-Path -LiteralPath (Join-Path $WorkerSource "whisper-subtitle-worker.exe"))) {
        throw "Frozen Worker executable was not produced"
    }

    $InternalStage = Join-Path $StageRoot "_internal"
    $DistributionStage = Join-Path $InternalStage "distribution"
    New-Item -ItemType Directory -Force -Path $DistributionStage | Out-Null
    & $Python -m cyclonedx_py environment --output-reproducible --spec-version 1.6 --output-format JSON --output-file (Join-Path $DistributionStage "sbom-python.cdx.json") --pyproject "pyproject.toml" $Python
    Assert-LastExitCode "CycloneDX SBOM generation"
    Copy-Item -LiteralPath "tools/release/README.md" -Destination (Join-Path $DistributionStage "README.md")
    Move-Item -LiteralPath $WorkerSource -Destination (Join-Path $InternalStage "worker")
    & $Python "tools/release/stage_models.py" @ModelArguments --destination (Join-Path $InternalStage "models")
    Assert-LastExitCode "offline model bundles"

    & (Join-Path $PSScriptRoot "assemble.ps1") -BuildRoot $BuildRoot -OutputRoot $OutputRoot -SigningConfig $SigningConfig -WebView2Installer $WebView2Installer -IncludeInstaller:$IncludeInstaller -IncludeArchive:$IncludeArchive -KeepBuild:$KeepBuild
    Assert-LastExitCode "release assembly"
} finally {
    Pop-Location
}
