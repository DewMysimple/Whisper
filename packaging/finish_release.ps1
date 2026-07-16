[CmdletBinding()]
param(
    [string]$BuildRoot = "",
    [string]$SigningConfig = "",
    [switch]$SkipInstaller
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$RepositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
if (-not $BuildRoot) { $BuildRoot = Join-Path $RepositoryRoot "build\release" }
$BuildRoot = (Resolve-Path -LiteralPath $BuildRoot).Path
$StageRoot = Join-Path $BuildRoot "stage"
$Python = Join-Path $BuildRoot "build-env\Scripts\python.exe"
$ReleaseRoot = Join-Path $RepositoryRoot "dist\release"
$PortableRoot = Join-Path $ReleaseRoot "WhisperSubtitle-portable"
$InstallerRoot = Join-Path $ReleaseRoot "WhisperSubtitle-offline-installer"
$Version = "0.1.0"
$WorkerExe = Join-Path $StageRoot "worker\whisper-subtitle-worker.exe"
$DistributionStage = Join-Path $StageRoot "distribution"
$PythonSbom = Join-Path $DistributionStage "sbom-python.cdx.json"

function Send-ToRecycleBin([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) { return }
    Add-Type -AssemblyName Microsoft.VisualBasic
    $resolved = (Resolve-Path -LiteralPath $Path).Path
    $allowed = (Join-Path $RepositoryRoot "dist\")
    if (-not $resolved.StartsWith($allowed, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to recycle release path outside dist: $resolved"
    }
    if (Test-Path -LiteralPath $resolved -PathType Container) {
        [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($resolved, [Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs, [Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin)
    } else {
        [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($resolved, [Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs, [Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin)
    }
}

function Assert-LastExitCode([string]$Step) {
    if ($LASTEXITCODE -ne 0) { throw "$Step failed with exit code $LASTEXITCODE" }
}

foreach ($required in @($Python, $WorkerExe, $PythonSbom, (Join-Path $StageRoot "model\model.bin"))) {
    if (-not (Test-Path -LiteralPath $required)) { throw "Release stage is incomplete: $required" }
}

Push-Location $RepositoryRoot
try {
    Send-ToRecycleBin $ReleaseRoot
    New-Item -ItemType Directory -Force -Path $ReleaseRoot | Out-Null

    $BaseReleaseConfig = Join-Path $RepositoryRoot "apps\desktop\src-tauri\tauri.release.conf.json"
    $generated = Get-Content -Encoding utf8 -Raw $BaseReleaseConfig | ConvertFrom-Json
    $generated.bundle.icon = @((Join-Path $RepositoryRoot "assets\logo.ico"))
    $generated.bundle.resources = [ordered]@{
        (Join-Path $StageRoot "worker\") = "worker/"
        (Join-Path $StageRoot "distribution\") = "distribution/"
    }
    $generated.bundle.windows.nsis.installerHooks = Join-Path $RepositoryRoot "apps\desktop\src-tauri\windows\installer-hooks.nsh"

    if ($SigningConfig) {
        $SigningConfig = (Resolve-Path -LiteralPath $SigningConfig).Path
        $signing = Get-Content -Encoding utf8 -Raw $SigningConfig | ConvertFrom-Json
        foreach ($property in @("certificateThumbprint", "digestAlgorithm", "timestampUrl")) {
            if (-not $signing.$property -or [string]$signing.$property -match "REPLACE_") {
                throw "Signing config property $property is missing or still a placeholder"
            }
        }
        $generated.bundle.windows | Add-Member -NotePropertyName certificateThumbprint -NotePropertyValue $signing.certificateThumbprint
        $generated.bundle.windows | Add-Member -NotePropertyName digestAlgorithm -NotePropertyValue $signing.digestAlgorithm
        $generated.bundle.windows | Add-Member -NotePropertyName timestampUrl -NotePropertyValue $signing.timestampUrl

        $SignTool = Get-ChildItem -LiteralPath "${env:ProgramFiles(x86)}\Windows Kits\10\bin" -Recurse -Filter "signtool.exe" -ErrorAction SilentlyContinue |
            Where-Object { $_.FullName -match "\\x64\\signtool\.exe$" } |
            Sort-Object FullName -Descending |
            Select-Object -First 1
        if (-not $SignTool) { throw "Windows SignTool was not found for the requested signed release" }
        & $SignTool.FullName sign /sha1 $signing.certificateThumbprint /fd $signing.digestAlgorithm /tr $signing.timestampUrl /td sha256 $WorkerExe
        Assert-LastExitCode "frozen Worker code signing"
    }

    $ReleaseConfig = Join-Path $BuildRoot "tauri.generated.conf.json"
    $generated | ConvertTo-Json -Depth 20 | Set-Content -Encoding utf8 $ReleaseConfig

    if (-not (Get-Command cargo.exe -ErrorAction SilentlyContinue)) {
        $CargoHome = if ($env:CARGO_HOME) {
            $env:CARGO_HOME
        } else {
            Join-Path ([Environment]::GetFolderPath("UserProfile")) ".cargo"
        }
        $CargoExecutable = Join-Path $CargoHome "bin\cargo.exe"
        if (-not (Test-Path -LiteralPath $CargoExecutable)) {
            throw "cargo.exe was not found on PATH or below CARGO_HOME"
        }
        $env:PATH = "$(Split-Path -Parent $CargoExecutable);$env:PATH"
    }
    corepack pnpm --filter @whisper-subtitle/web build
    Assert-LastExitCode "React production build"
    corepack pnpm --filter @whisper-subtitle/desktop tauri build --no-bundle --config $ReleaseConfig
    Assert-LastExitCode "Tauri portable executable build"
    $DesktopExe = Join-Path $RepositoryRoot "apps\desktop\src-tauri\target\release\whisper-subtitle-desktop.exe"

    New-Item -ItemType Directory -Force -Path $PortableRoot | Out-Null
    Copy-Item -LiteralPath $DesktopExe -Destination (Join-Path $PortableRoot "whisper-subtitle-desktop.exe")
    Copy-Item -LiteralPath (Join-Path $StageRoot "worker") -Destination (Join-Path $PortableRoot "worker") -Recurse
    New-Item -ItemType Directory -Force -Path (Join-Path $PortableRoot "models") | Out-Null
    Copy-Item -LiteralPath (Join-Path $StageRoot "model") -Destination (Join-Path $PortableRoot "models\large-v3-turbo") -Recurse
    Copy-Item -LiteralPath $DistributionStage -Destination (Join-Path $PortableRoot "distribution") -Recurse

    & $Python "packaging/generate_release_manifest.py" $PortableRoot (Join-Path $PortableRoot "release-manifest.json") --version $Version
    Assert-LastExitCode "portable release manifest"

    if (-not $SkipInstaller) {
        corepack pnpm --filter @whisper-subtitle/desktop tauri build --bundles nsis --config $ReleaseConfig
        Assert-LastExitCode "NSIS offline installer build"
        $Installer = Get-ChildItem -LiteralPath "apps/desktop/src-tauri/target/release/bundle/nsis" -Filter "*.exe" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
        if (-not $Installer) { throw "NSIS installer was not produced" }
        New-Item -ItemType Directory -Force -Path (Join-Path $InstallerRoot "models") | Out-Null
        Copy-Item -LiteralPath $Installer.FullName -Destination (Join-Path $InstallerRoot $Installer.Name)
        Copy-Item -LiteralPath (Join-Path $StageRoot "model") -Destination (Join-Path $InstallerRoot "models\large-v3-turbo") -Recurse
        Copy-Item -LiteralPath $DistributionStage -Destination (Join-Path $InstallerRoot "distribution") -Recurse
        & $Python "packaging/generate_release_manifest.py" $InstallerRoot (Join-Path $InstallerRoot "release-manifest.json") --version $Version
        Assert-LastExitCode "offline installer media manifest"
    }

    Copy-Item -LiteralPath $PythonSbom -Destination (Join-Path $ReleaseRoot "sbom-python.cdx.json")
    & $Python "packaging/generate_release_manifest.py" $ReleaseRoot (Join-Path $ReleaseRoot "release-manifest.json") --version $Version
    Assert-LastExitCode "release manifest"

    $keyFiles = @(
        (Join-Path $PortableRoot "whisper-subtitle-desktop.exe"),
        (Join-Path $PortableRoot "release-manifest.json"),
        (Join-Path $ReleaseRoot "release-manifest.json"),
        (Join-Path $ReleaseRoot "sbom-python.cdx.json")
    )
    if (-not $SkipInstaller) {
        $keyFiles += (Get-ChildItem -LiteralPath $InstallerRoot -Filter "*.exe" | Select-Object -First 1).FullName
        $keyFiles += Join-Path $InstallerRoot "release-manifest.json"
    }
    $checksums = foreach ($file in $keyFiles) {
        $hash = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()
        $relative = $file.Substring($ReleaseRoot.Length).TrimStart('\', '/')
        "$hash  $relative"
    }
    $checksums | Set-Content -Encoding ascii (Join-Path $ReleaseRoot "SHA256SUMS.txt")
    Write-Host "Release completed: $ReleaseRoot"
} finally {
    Pop-Location
}
