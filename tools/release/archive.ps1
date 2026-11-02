[CmdletBinding()]
param([string]$ModelId = "")
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$RepositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
$ApplicationRoot = Join-Path $RepositoryRoot "dist\WhisperSubtitle"
$Manifest = Join-Path $ApplicationRoot "_internal\release-manifest.json"
$Archive = Join-Path $RepositoryRoot "dist\WhisperSubtitle.zip"
$Checksum = Join-Path $RepositoryRoot "dist\WhisperSubtitle.sha256"
. (Join-Path $RepositoryRoot "tools\maintenance\generated_paths.ps1")
$ArchiveRoot = $ApplicationRoot
if ($ModelId) {
    if ($ModelId -cnotmatch '^[a-z0-9][a-z0-9.-]*$') { throw "Invalid registered model ID" }
    $ReleaseName = "WhisperSubtitle-$ModelId"
    $StageParent = Join-Path $RepositoryRoot "build\release-selected"
    $ArchiveRoot = Join-Path $StageParent $ReleaseName
    $Archive = Join-Path $RepositoryRoot "dist\$ReleaseName.zip"
    $Checksum = Join-Path $RepositoryRoot "dist\$ReleaseName.sha256"
    $null = Assert-GeneratedPath -Path $ArchiveRoot -RepositoryRoot $RepositoryRoot -AllowedRoots @($StageParent)
}
foreach ($owned in @($Archive, ($Archive + '.tmp'), $Checksum)) {
    $null = Assert-GeneratedPath -Path $owned -RepositoryRoot $RepositoryRoot -AllowedRoots @($owned)
}
if ($ModelId) {
    if (Test-Path -LiteralPath ($Archive + '.tmp')) {
        throw "An existing archive temporary file requires inspection before retrying: $Archive.tmp"
    }
    if ((Test-Path -LiteralPath $Archive) -or (Test-Path -LiteralPath $Checksum)) {
        if (-not (Test-Path -LiteralPath $Archive -PathType Leaf) -or -not (Test-Path -LiteralPath $Checksum -PathType Leaf)) {
            throw "Refusing to replace an unrecognized selected release archive/checksum pair"
        }
        $ExpectedName = [regex]::Escape([IO.Path]::GetFileName($Archive))
        $PreviousChecksum = [IO.File]::ReadAllText($Checksum).Trim()
        if ($PreviousChecksum -cnotmatch "^([0-9a-f]{64})  $ExpectedName`$") {
            throw "Refusing to replace an unrecognized selected release checksum"
        }
        $PreviousHash = $Matches[1]
        if ((Get-Sha256 $Archive) -ne $PreviousHash) {
            throw "Existing selected release archive checksum does not match"
        }
    }
    & python (Join-Path $PSScriptRoot "prepare_selected_portable.py") --source $ApplicationRoot --stage $ArchiveRoot --model-id $ModelId
    if ($LASTEXITCODE -ne 0) { throw "Selected portable release preparation failed" }
    $Manifest = Join-Path $ArchiveRoot "_internal\release-manifest.json"
}
& python (Join-Path $PSScriptRoot "generate_release_manifest.py") $ArchiveRoot $Manifest --verify
if ($LASTEXITCODE -ne 0) { throw "Portable release verification failed" }
& python (Join-Path $PSScriptRoot "create_portable_archive.py") $ArchiveRoot $Archive
if ($LASTEXITCODE -ne 0) { throw "Portable archive creation failed" }
$KeyFiles = if ($ModelId) { @($Archive) } else { @($Archive, (Join-Path $ApplicationRoot "WhisperSubtitle.exe"), $Manifest) }
$checksums = foreach ($file in $KeyFiles) {
    $hash = Get-Sha256 $file
    "$hash  $($file.Substring((Join-Path $RepositoryRoot 'dist').Length + 1))"
}
$checksums | Set-Content -LiteralPath $Checksum -Encoding ascii
Write-Host "Portable archive: $Archive"
