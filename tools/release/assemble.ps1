[CmdletBinding()]
param(
    [string]$BuildRoot = "",
    [string]$SigningConfig = "",
    [string]$WebView2Installer = "",
    [switch]$IncludeInstaller
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$RepositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
if (-not $BuildRoot) { $BuildRoot = Join-Path $RepositoryRoot "build\release" }
$BuildRoot = (Resolve-Path -LiteralPath $BuildRoot).Path
$StageRoot = Join-Path $BuildRoot "stage"
$InternalStage = Join-Path $StageRoot "_internal"
$Python = Join-Path $BuildRoot "environment\Scripts\python.exe"
$DistRoot = Join-Path $RepositoryRoot "dist"
$ApplicationRoot = Join-Path $DistRoot "WhisperSubtitle"
$ArchivePath = Join-Path $DistRoot "WhisperSubtitle.zip"
$ChecksumPath = Join-Path $DistRoot "WhisperSubtitle.sha256"
$InstallerRoot = Join-Path $DistRoot "installer"
$WorkerExe = Join-Path $InternalStage "worker\whisper-subtitle-worker.exe"
$DistributionStage = Join-Path $InternalStage "distribution"
$PythonSbom = Join-Path $DistributionStage "sbom-python.cdx.json"
$UserGuideSource = Join-Path $PSScriptRoot "user_guide.zh-CN.md"
$UserGuideFileName = (-join @([char]0x4F7F, [char]0x7528, [char]0x8BF4, [char]0x660E)) + ".md"
$package = Get-Content -Encoding utf8 -Raw (Join-Path $RepositoryRoot "package.json") | ConvertFrom-Json
$Version = [string]$package.version

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

function Get-Sha256([string]$Path) {
    $stream = [IO.File]::OpenRead($Path)
    $algorithm = [Security.Cryptography.SHA256]::Create()
    try {
        return -join ($algorithm.ComputeHash($stream) | ForEach-Object { $_.ToString("x2") })
    } finally {
        $algorithm.Dispose()
        $stream.Dispose()
    }
}

function Resolve-WebView2Installer([string]$Candidate) {
    $resolved = $null
    if ($Candidate) {
        $resolved = (Resolve-Path -LiteralPath $Candidate).Path
    } else {
        $cacheRoot = Join-Path $env:LOCALAPPDATA "tauri\x64"
        if (Test-Path -LiteralPath $cacheRoot) {
            $resolved = Get-ChildItem -LiteralPath $cacheRoot -Recurse -Filter "MicrosoftEdgeWebView2RuntimeInstallerX64.exe" -File |
                Sort-Object LastWriteTime -Descending |
                Select-Object -First 1 -ExpandProperty FullName
        }
    }
    if (-not $resolved -or -not (Test-Path -LiteralPath $resolved -PathType Leaf)) {
        throw "A local MicrosoftEdgeWebView2RuntimeInstallerX64.exe is required for the offline installer. Pass -WebView2Installer <path>."
    }
    $signature = Get-AuthenticodeSignature -LiteralPath $resolved
    if ($signature.Status -ne "Valid" -or $signature.SignerCertificate.Subject -notmatch "Microsoft Corporation") {
        throw "The supplied WebView2 offline installer does not have a valid Microsoft Authenticode signature: $resolved"
    }
    return $resolved
}

foreach ($required in @($Python, $WorkerExe, $PythonSbom, (Join-Path $InternalStage "models\large-v3-turbo\model.bin"))) {
    if (-not (Test-Path -LiteralPath $required)) { throw "Release stage is incomplete: $required" }
}

Push-Location $RepositoryRoot
try {
    New-Item -ItemType Directory -Force -Path $DistRoot | Out-Null
    foreach ($generated in @($ApplicationRoot, $ArchivePath, $ChecksumPath, $InstallerRoot)) {
        Send-ToRecycleBin $generated
    }

    $ResolvedWebView2Installer = if ($IncludeInstaller) { Resolve-WebView2Installer $WebView2Installer } else { $null }
    $BaseReleaseConfig = Join-Path $RepositoryRoot "apps\desktop\src-tauri\tauri.release.conf.json"
    $generated = Get-Content -Encoding utf8 -Raw $BaseReleaseConfig | ConvertFrom-Json
    $generated.bundle.icon = @((Join-Path $RepositoryRoot "apps\desktop\src-tauri\icons\icon.ico"))
    $generated.bundle.resources = [ordered]@{
        (Join-Path $InternalStage "worker\") = "_internal/worker/"
        (Join-Path $InternalStage "distribution\") = "_internal/distribution/"
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
        $CargoRoot = if ($env:CARGO_HOME) { $env:CARGO_HOME } else { Join-Path ([Environment]::GetFolderPath("UserProfile")) ".cargo" }
        $CargoExecutable = Join-Path $CargoRoot "bin\cargo.exe"
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

    New-Item -ItemType Directory -Force -Path $ApplicationRoot | Out-Null
    Copy-Item -LiteralPath $DesktopExe -Destination (Join-Path $ApplicationRoot "WhisperSubtitle.exe")
    Copy-Item -LiteralPath $InternalStage -Destination (Join-Path $ApplicationRoot "_internal") -Recurse
    Copy-Item -LiteralPath $UserGuideSource -Destination (Join-Path $ApplicationRoot $UserGuideFileName)
    $ApplicationManifest = Join-Path $ApplicationRoot "_internal\release-manifest.json"
    & $Python "tools/release/generate_release_manifest.py" $ApplicationRoot $ApplicationManifest --version $Version
    Assert-LastExitCode "portable release manifest"
    & $Python "tools/release/create_portable_archive.py" $ApplicationRoot $ArchivePath
    Assert-LastExitCode "portable ZIP archive"

    $keyFiles = @($ArchivePath, (Join-Path $ApplicationRoot "WhisperSubtitle.exe"), $ApplicationManifest)
    if ($IncludeInstaller) {
        corepack pnpm --filter @whisper-subtitle/desktop tauri build --bundles nsis --config $ReleaseConfig
        Assert-LastExitCode "NSIS offline installer build"
        $Installer = Get-ChildItem -LiteralPath "apps/desktop/src-tauri/target/release/bundle/nsis" -Filter "*.exe" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
        if (-not $Installer) { throw "NSIS installer was not produced" }
        $InstallerInternal = Join-Path $InstallerRoot "_internal"
        New-Item -ItemType Directory -Force -Path (Join-Path $InstallerInternal "models") | Out-Null
        Copy-Item -LiteralPath $Installer.FullName -Destination (Join-Path $InstallerRoot "WhisperSubtitle-Setup.exe")
        Copy-Item -LiteralPath (Join-Path $InternalStage "models\large-v3-turbo") -Destination (Join-Path $InstallerInternal "models\large-v3-turbo") -Recurse
        Copy-Item -LiteralPath $DistributionStage -Destination (Join-Path $InstallerInternal "distribution") -Recurse
        Copy-Item -LiteralPath $ResolvedWebView2Installer -Destination (Join-Path $InstallerInternal "distribution\MicrosoftEdgeWebView2RuntimeInstallerX64.exe")
        Copy-Item -LiteralPath $UserGuideSource -Destination (Join-Path $InstallerRoot $UserGuideFileName)
        $InstallerManifest = Join-Path $InstallerInternal "release-manifest.json"
        & $Python "tools/release/generate_release_manifest.py" $InstallerRoot $InstallerManifest --version $Version
        Assert-LastExitCode "offline installer media manifest"
        $keyFiles += Join-Path $InstallerRoot "WhisperSubtitle-Setup.exe"
        $keyFiles += $InstallerManifest
    }

    $checksums = foreach ($file in $keyFiles) {
        $hash = Get-Sha256 $file
        $relative = $file.Substring($DistRoot.Length).TrimStart('\', '/')
        "$hash  $relative"
    }
    $checksums | Set-Content -Encoding ascii $ChecksumPath

    Write-Host "Portable application: $ApplicationRoot"
    Write-Host "Portable archive:     $ArchivePath"
    if ($IncludeInstaller) { Write-Host "Offline installer:    $InstallerRoot" }
} finally {
    Pop-Location
}
