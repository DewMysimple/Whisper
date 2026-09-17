[CmdletBinding()]
param(
    [string]$BootstrapPython = "",
    [string]$ModelDir = "",
    [string]$SigningConfig = "",
    [string]$WebView2Installer = "",
    [switch]$IncludeInstaller
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$RepositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$BuildRoot = Join-Path $RepositoryRoot "build\release"
$StageRoot = Join-Path $BuildRoot "stage"
$DistRoot = Join-Path $RepositoryRoot "dist"

function Send-ToRecycleBin([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) { return }
    Add-Type -AssemblyName Microsoft.VisualBasic
    $resolved = (Resolve-Path -LiteralPath $Path).Path
    $allowedRoots = @(
        (Join-Path $RepositoryRoot "build\"),
        (Join-Path $RepositoryRoot "dist\")
    )
    if (-not ($allowedRoots | Where-Object { $resolved.StartsWith($_, [System.StringComparison]::OrdinalIgnoreCase) })) {
        throw "Refusing to recycle generated path outside build/dist: $resolved"
    }
    if (Test-Path -LiteralPath $resolved -PathType Container) {
        [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory(
            $resolved,
            [Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs,
            [Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin
        )
    } else {
        [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile(
            $resolved,
            [Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs,
            [Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin
        )
    }
}

function Assert-LastExitCode([string]$Step) {
    if ($LASTEXITCODE -ne 0) { throw "$Step failed with exit code $LASTEXITCODE" }
}

function Resolve-DirectModel([string]$Candidate) {
    $root = if ($Candidate) { (Resolve-Path -LiteralPath $Candidate).Path } else { Join-Path $RepositoryRoot "models\huggingface" }
    if ((Test-Path (Join-Path $root "config.json")) -and (Test-Path (Join-Path $root "model.bin"))) {
        return $root
    }
    $config = Get-ChildItem -LiteralPath $root -Recurse -Filter "config.json" -File |
        Where-Object { Test-Path -LiteralPath (Join-Path $_.DirectoryName "model.bin") } |
        Sort-Object FullName |
        Select-Object -First 1
    if (-not $config) { throw "No complete direct large-v3-turbo model found below $root" }
    return $config.DirectoryName
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
    $DirectModel = Resolve-DirectModel $ModelDir

    Send-ToRecycleBin $BuildRoot
    foreach ($generated in @(
        (Join-Path $DistRoot "WhisperSubtitle"),
        (Join-Path $DistRoot "WhisperSubtitle.zip"),
        (Join-Path $DistRoot "WhisperSubtitle.sha256"),
        (Join-Path $DistRoot "installer"),
        (Join-Path $DistRoot "release")
    )) {
        Send-ToRecycleBin $generated
    }
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
    & $Python -m pip check
    Assert-LastExitCode "fresh build environment pip check"

    $PyInstallerRoot = Join-Path $BuildRoot "pyinstaller"
    $WorkerDist = Join-Path $PyInstallerRoot "dist"
    $WorkerWork = Join-Path $PyInstallerRoot "work"
    & $Python -m PyInstaller --clean --noconfirm --distpath $WorkerDist --workpath $WorkerWork "tools/release/worker.spec"
    Assert-LastExitCode "PyInstaller Worker build"
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
    Copy-Item -LiteralPath $WorkerSource -Destination (Join-Path $InternalStage "worker") -Recurse
    New-Item -ItemType Directory -Force -Path (Join-Path $InternalStage "models") | Out-Null
    Copy-Item -LiteralPath $DirectModel -Destination (Join-Path $InternalStage "models\large-v3-turbo") -Recurse

    & (Join-Path $PSScriptRoot "assemble.ps1") -BuildRoot $BuildRoot -SigningConfig $SigningConfig -WebView2Installer $WebView2Installer -IncludeInstaller:$IncludeInstaller
    Assert-LastExitCode "release assembly"
} finally {
    Pop-Location
}
