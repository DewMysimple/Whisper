[CmdletBinding()]
param(
    [string]$BuildRoot = "",
    [string]$SigningConfig = "",
    [string]$WebView2Installer = "",
    [string]$OutputRoot = "",
    [switch]$IncludeInstaller,
    [switch]$IncludeArchive,
    [switch]$KeepBuild
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
if ($OutputRoot) {
    $candidate = [System.IO.Path]::GetFullPath($OutputRoot)
    if (-not $candidate.StartsWith(($DistRoot + "\"), [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "OutputRoot must be a directory below the repository dist directory"
    }
    $DistRoot = $candidate
}
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

. (Join-Path $RepositoryRoot "tools\maintenance\generated_paths.ps1")
. (Join-Path $PSScriptRoot "prerequisites.ps1")
$BuildRoot = Assert-GeneratedPath -Path $BuildRoot -RepositoryRoot $RepositoryRoot -AllowedRoots @((Join-Path $RepositoryRoot "build"))
$PortableStage = Join-Path $BuildRoot "portable"

function Assert-LastExitCode([string]$Step) {
    if ($LASTEXITCODE -ne 0) { throw "$Step failed with exit code $LASTEXITCODE" }
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
    $running = Get-Process | Where-Object { -not $_.HasExited -and $_.Path -and $_.Path.StartsWith(($ApplicationRoot + "\"), [System.StringComparison]::OrdinalIgnoreCase) }
    if ($running) { throw "Close the running WhisperSubtitle before replacing $ApplicationRoot, or choose -OutputRoot for a separate validation build." }
    New-Item -ItemType Directory -Force -Path $DistRoot | Out-Null
    Remove-GeneratedPath -Path $PortableStage -RepositoryRoot $RepositoryRoot -AllowedRoots @($BuildRoot)

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
        $CargoExecutable = Resolve-ReleaseCargo
        $env:PATH = "$(Split-Path -Parent $CargoExecutable);$env:PATH"
    }
    corepack pnpm --filter @whisper-subtitle/web build
    Assert-LastExitCode "React production build"
    corepack pnpm --filter @whisper-subtitle/desktop tauri build --no-bundle --config $ReleaseConfig
    Assert-LastExitCode "Tauri portable executable build"
    $DesktopExe = Join-Path $RepositoryRoot "apps\desktop\src-tauri\target\release\whisper-subtitle-desktop.exe"

    New-Item -ItemType Directory -Force -Path $PortableStage | Out-Null
    Copy-Item -LiteralPath $DesktopExe -Destination (Join-Path $PortableStage "WhisperSubtitle.exe")
    Copy-Item -LiteralPath $InternalStage -Destination (Join-Path $PortableStage "_internal") -Recurse
    Copy-Item -LiteralPath $UserGuideSource -Destination (Join-Path $PortableStage $UserGuideFileName)
    $StagedManifest = Join-Path $PortableStage "_internal\release-manifest.json"
    & $Python "tools/release/generate_release_manifest.py" $PortableStage $StagedManifest --version $Version
    Assert-LastExitCode "portable release manifest"
    & $Python "tools/release/generate_release_manifest.py" $PortableStage $StagedManifest --verify
    Assert-LastExitCode "portable release integrity"

    # The previous release remains usable until the replacement is built and verified.
    foreach ($owned in @($ApplicationRoot, $ArchivePath, $ChecksumPath, $InstallerRoot)) {
        $null = Assert-GeneratedPath -Path $owned -RepositoryRoot $RepositoryRoot -AllowedRoots @($DistRoot)
    }
    foreach ($owned in @($ApplicationRoot, $ArchivePath, $ChecksumPath, $InstallerRoot)) {
        Remove-GeneratedPath -Path $owned -RepositoryRoot $RepositoryRoot -AllowedRoots @($DistRoot)
    }
    Move-Item -LiteralPath $PortableStage -Destination $ApplicationRoot
    $ApplicationManifest = Join-Path $ApplicationRoot "_internal\release-manifest.json"
    $keyFiles = @((Join-Path $ApplicationRoot "WhisperSubtitle.exe"), $ApplicationManifest)
    if ($IncludeArchive) {
        & $Python "tools/release/create_portable_archive.py" $ApplicationRoot $ArchivePath
        Assert-LastExitCode "portable ZIP archive"
        $keyFiles += $ArchivePath
    }
    if ($IncludeInstaller) {
        corepack pnpm --filter @whisper-subtitle/desktop tauri build --bundles nsis --config $ReleaseConfig
        Assert-LastExitCode "NSIS offline installer build"
        $Installer = Get-ChildItem -LiteralPath "apps/desktop/src-tauri/target/release/bundle/nsis" -Filter "*.exe" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
        if (-not $Installer) { throw "NSIS installer was not produced" }
        $InstallerInternal = Join-Path $InstallerRoot "_internal"
        New-Item -ItemType Directory -Force -Path (Join-Path $InstallerInternal "models") | Out-Null
        Copy-Item -LiteralPath $Installer.FullName -Destination (Join-Path $InstallerRoot "WhisperSubtitle-Setup.exe")
        Copy-Item -Path (Join-Path $InternalStage "models\*") -Destination (Join-Path $InstallerInternal "models") -Recurse
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
    if ($IncludeArchive) { Write-Host "Portable archive:     $ArchivePath" }
    if ($IncludeInstaller) { Write-Host "Offline installer:    $InstallerRoot" }
    if (-not $KeepBuild) {
        $BundledResources = Join-Path $RepositoryRoot "apps\desktop\src-tauri\target\release\_internal"
        Remove-GeneratedPath -Path $BundledResources -RepositoryRoot $RepositoryRoot -AllowedRoots @($BundledResources)
        Remove-GeneratedPath -Path $BuildRoot -RepositoryRoot $RepositoryRoot -AllowedRoots @($BuildRoot)
    }
} finally {
    Pop-Location
}
