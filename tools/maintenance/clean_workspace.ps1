[CmdletBinding()]
param(
    [switch]$Apply
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

$repositoryPrefix = $repositoryRoot.TrimEnd("\") + "\"
$safeTargets = @(
    $candidatePaths |
        Sort-Object -Unique |
        ForEach-Object {
            $resolvedPath = [System.IO.Path]::GetFullPath($_)
            if (
                $resolvedPath.Equals($repositoryRoot, [System.StringComparison]::OrdinalIgnoreCase) -or
                -not $resolvedPath.StartsWith($repositoryPrefix, [System.StringComparison]::OrdinalIgnoreCase)
            ) {
                throw "Unsafe cleanup target: $resolvedPath"
            }

            $relativePath = $resolvedPath.Substring($repositoryPrefix.Length).Replace("\", "/")
            $trackedPaths = @(& git -C $repositoryRoot ls-files -- $relativePath)
            if ($LASTEXITCODE -ne 0) {
                throw "Unable to verify cleanup target against Git: $resolvedPath"
            }
            if ($trackedPaths.Count -gt 0) {
                throw "Refusing to delete tracked content below: $resolvedPath"
            }
            $resolvedPath
        } |
        Sort-Object Length -Descending
)

if ($safeTargets.Count -eq 0) {
    Write-Output "Workspace generated artifacts are already clean."
    exit 0
}

if (-not $Apply) {
    Write-Output "Preview only. The following generated artifacts would be permanently deleted:"
    $safeTargets | ForEach-Object { Write-Output "  $_" }
    Write-Output "Run 'corepack pnpm workspace:clean:apply' to apply this cleanup."
    exit 0
}

foreach ($targetPath in $safeTargets) {
    if (Test-Path -LiteralPath $targetPath) {
        Write-Output "Deleting $targetPath"
        Remove-Item -LiteralPath $targetPath -Recurse -Force
    }
}

Write-Output "Workspace generated artifacts were cleaned."
