[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$RepositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
$ApplicationRoot = Join-Path $RepositoryRoot "dist\WhisperSubtitle"
$Manifest = Join-Path $ApplicationRoot "_internal\release-manifest.json"
$Archive = Join-Path $RepositoryRoot "dist\WhisperSubtitle.zip"
$Checksum = Join-Path $RepositoryRoot "dist\WhisperSubtitle.sha256"
. (Join-Path $RepositoryRoot "tools\maintenance\generated_paths.ps1")
& python (Join-Path $PSScriptRoot "generate_release_manifest.py") $ApplicationRoot $Manifest --verify
if ($LASTEXITCODE -ne 0) { throw "Current portable release verification failed" }
foreach ($owned in @($Archive, ($Archive + '.tmp'), $Checksum)) {
    $null = Assert-GeneratedPath -Path $owned -RepositoryRoot $RepositoryRoot -AllowedRoots @($owned)
}
& python (Join-Path $PSScriptRoot "create_portable_archive.py") $ApplicationRoot $Archive
if ($LASTEXITCODE -ne 0) { throw "Portable archive creation failed" }
$checksums = foreach ($file in @($Archive, (Join-Path $ApplicationRoot "WhisperSubtitle.exe"), $Manifest)) {
    $hash = Get-Sha256 $file
    "$hash  $($file.Substring((Join-Path $RepositoryRoot 'dist').Length + 1))"
}
$checksums | Set-Content -LiteralPath $Checksum -Encoding ascii
Write-Host "Portable archive: $Archive"
