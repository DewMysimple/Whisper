[CmdletBinding()]
param(
    [switch]$Apply,
    [switch]$PruneReleases,
    [switch]$KeepArchive
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repositoryRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
$gitRootOutput = & git -C $repositoryRoot rev-parse --show-toplevel
if ($LASTEXITCODE -ne 0) {
    throw "Unable to resolve the Git repository root."
}

$gitRoot = [System.IO.Path]::GetFullPath(($gitRootOutput | Select-Object -First 1).Trim())
if (-not $repositoryRoot.Equals($gitRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to clean outside the expected repository root: $repositoryRoot"
}

. (Join-Path $PSScriptRoot "generated_paths.ps1")

$fixedRelativeTargets = @(
    ".pytest_cache",
    ".mypy_cache",
    ".ruff_cache",
    ".coverage",
    "htmlcov",
    "build",
    "src\whisper_subtitle.egg-info",
    "apps\web\dist",
    "apps\web\coverage",
    "apps\web\test-results",
    "apps\web\playwright-report",
    "apps\web\node_modules\.vite",
    "apps\desktop\src-tauri\gen",
    "apps\desktop\src-tauri\target"
)

$candidatePaths = [System.Collections.Generic.List[string]]::new()
foreach ($relativeTarget in $fixedRelativeTargets) {
    $targetPath = [System.IO.Path]::GetFullPath((Join-Path $repositoryRoot $relativeTarget))
    if (Test-Path -LiteralPath $targetPath) {
        $candidatePaths.Add($targetPath)
    }
}

foreach ($relativeSearchRoot in @("src", "tests", "wiki-memory\工具")) {
    $searchRoot = Join-Path $repositoryRoot $relativeSearchRoot
    if (-not (Test-Path -LiteralPath $searchRoot -PathType Container)) {
        continue
    }

    Get-ChildItem -LiteralPath $searchRoot -Directory -Filter "__pycache__" -Recurse -Force |
        ForEach-Object { $candidatePaths.Add($_.FullName) }
    Get-ChildItem -LiteralPath $searchRoot -File -Recurse -Force |
        Where-Object {
            $_.Extension -in @(".pyc", ".pyo") -and $_.Directory.Name -ne "__pycache__"
        } |
        ForEach-Object { $candidatePaths.Add($_.FullName) }
}

if ($PruneReleases) {
    $distRoot = Join-Path $repositoryRoot "dist"
    $applicationRoot = Join-Path $distRoot "WhisperSubtitle"
    $manifest = Join-Path $applicationRoot "_internal\release-manifest.json"
    if (-not (Test-Path -LiteralPath $manifest -PathType Leaf)) {
        throw "A current portable release manifest is required before pruning releases."
    }
    if ($Apply) {
        $checksumPath = Join-Path $distRoot "WhisperSubtitle.sha256"
        $null = Assert-GeneratedPath -Path $checksumPath -RepositoryRoot $repositoryRoot -AllowedRoots @($checksumPath)
        & python (Join-Path $repositoryRoot "tools\release\generate_release_manifest.py") $applicationRoot $manifest --verify
        if ($LASTEXITCODE -ne 0) { throw "Current release verification failed; nothing was removed." }
    }
    Get-ChildItem -LiteralPath $distRoot -Force | Where-Object {
        $_.Name -match '^WhisperSubtitle\.previous-[0-9]{8}(\.(zip|sha256))?$'
    } | ForEach-Object { $candidatePaths.Add($_.FullName) }
    if (-not $KeepArchive -and (Test-Path -LiteralPath (Join-Path $distRoot "WhisperSubtitle.zip"))) {
        $candidatePaths.Add((Join-Path $distRoot "WhisperSubtitle.zip"))
    }
}

$safeTargets = @(
    $candidatePaths |
        Sort-Object -Unique |
        ForEach-Object {
            Assert-GeneratedPath -Path $_ -RepositoryRoot $repositoryRoot -AllowedRoots @($_)
        } |
        Sort-Object Length -Descending
)

if ($safeTargets.Count -eq 0 -and -not $PruneReleases) {
    Write-Output "Workspace generated artifacts are already clean."
    exit 0
}

if (-not $Apply) {
    Write-Output "Preview only. The following generated artifacts would be permanently deleted:"
    $safeTargets | ForEach-Object { Write-Output "  $_" }
    Write-Output "Add -Apply to this command to apply the previewed cleanup."
    exit 0
}

foreach ($targetPath in $safeTargets) {
    if (Test-Path -LiteralPath $targetPath) {
        Write-Output "Deleting $targetPath"
        Remove-GeneratedPath -Path $targetPath -RepositoryRoot $repositoryRoot -AllowedRoots @($targetPath)
    }
}

if ($PruneReleases -and -not $KeepArchive) {
    $checksum = Join-Path $repositoryRoot "dist\WhisperSubtitle.sha256"
    if (Test-Path -LiteralPath $checksum) {
        $remaining = @(Get-Content -LiteralPath $checksum | Where-Object { $_ -notmatch '  WhisperSubtitle\.zip$' })
        $remaining | Set-Content -LiteralPath $checksum -Encoding ascii
    }
}
Write-Output "Workspace generated artifacts were cleaned."
