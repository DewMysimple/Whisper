[CmdletBinding()]
param(
    [string]$BootstrapPython = "",
    [string]$ModelDir = "",
    [string]$SigningConfig = "",
    [switch]$SkipInstaller
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$RepositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$BuildRoot = Join-Path $RepositoryRoot "build\release"
$StageRoot = Join-Path $BuildRoot "stage"
$ReleaseRoot = Join-Path $RepositoryRoot "dist\release"
$PortableRoot = Join-Path $ReleaseRoot "WhisperSubtitle-portable"
$Version = "0.1.0"

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
    if ($pyproject -notmatch "(?m)^version = `"$([regex]::Escape($Version))`"$" -or
        $tauri.version -ne $Version -or
        $cargo -notmatch "(?m)^version = `"$([regex]::Escape($Version))`"$" -or
        $package.version -ne $Version) {
        throw "Release version $Version is not synchronized across Python, Tauri, Cargo and npm metadata"
    }

    if (-not $BootstrapPython) { $BootstrapPython = Join-Path $RepositoryRoot "whisper_env\Scripts\python.exe" }
    $BootstrapPython = (Resolve-Path -LiteralPath $BootstrapPython).Path
    $DirectModel = Resolve-DirectModel $ModelDir

    Send-ToRecycleBin $BuildRoot
    Send-ToRecycleBin $ReleaseRoot
    New-Item -ItemType Directory -Force -Path $BuildRoot, $StageRoot, $ReleaseRoot | Out-Null

    $BuildEnv = Join-Path $BuildRoot "build-env"
    & $BootstrapPython -m venv $BuildEnv
    Assert-LastExitCode "fresh build environment creation"
    $Python = Join-Path $BuildEnv "Scripts\python.exe"
    & $Python -m pip install --disable-pip-version-check --timeout 60 --retries 8 --upgrade pip
    Assert-LastExitCode "pip bootstrap"
    & $Python -m pip install --disable-pip-version-check --timeout 60 --retries 8 -r "packaging/requirements-worker.txt" -r "packaging/requirements-build.txt"
    Assert-LastExitCode "pinned release dependencies"

    $WheelRoot = Join-Path $BuildRoot "wheels"
    New-Item -ItemType Directory -Force -Path $WheelRoot | Out-Null
    & $Python -m pip wheel . --no-deps --no-build-isolation --wheel-dir $WheelRoot
    Assert-LastExitCode "project wheel build"
    $Wheels = @(Get-ChildItem -LiteralPath $WheelRoot -Filter "whisper_subtitle-$Version-*.whl")
    if ($Wheels.Count -ne 1) { throw "Expected exactly one project wheel, found $($Wheels.Count)" }
    $Wheel = $Wheels[0]
    & $Python -m pip install --no-deps $Wheel.FullName
    Assert-LastExitCode "project wheel install"
    & $Python -m pip check
    Assert-LastExitCode "fresh build environment pip check"

    $WorkerDist = Join-Path $BuildRoot "worker-dist"
    $WorkerWork = Join-Path $BuildRoot "worker-work"
    & $Python -m PyInstaller --clean --noconfirm --distpath $WorkerDist --workpath $WorkerWork "packaging/worker.spec"
    Assert-LastExitCode "PyInstaller Worker build"
    $WorkerSource = Join-Path $WorkerDist "whisper-subtitle-worker"
    $WorkerExe = Join-Path $WorkerSource "whisper-subtitle-worker.exe"
    if (-not (Test-Path -LiteralPath $WorkerExe)) { throw "Frozen Worker executable was not produced" }

    $DistributionStage = Join-Path $StageRoot "distribution"
    New-Item -ItemType Directory -Force -Path $DistributionStage | Out-Null
    $PythonSbom = Join-Path $DistributionStage "sbom-python.cdx.json"
    & $Python -m cyclonedx_py environment --output-reproducible --spec-version 1.6 --output-format JSON --output-file $PythonSbom --pyproject "pyproject.toml" $Python
    Assert-LastExitCode "CycloneDX SBOM generation"
    Copy-Item -LiteralPath "packaging/README.md" -Destination (Join-Path $DistributionStage "README.md")

    Copy-Item -LiteralPath $WorkerSource -Destination (Join-Path $StageRoot "worker") -Recurse
    Copy-Item -LiteralPath $DirectModel -Destination (Join-Path $StageRoot "model") -Recurse

    $FinishArguments = @{
        BuildRoot = $BuildRoot
        SigningConfig = $SigningConfig
        SkipInstaller = $SkipInstaller
    }
    & (Join-Path $PSScriptRoot "finish_release.ps1") @FinishArguments
    Assert-LastExitCode "release finishing stage"
} finally {
    Pop-Location
}
