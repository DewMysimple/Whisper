# Shared guards for permanently removing repository-owned generated artifacts.
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

function Assert-GeneratedPath {
    param([string]$Path, [string]$RepositoryRoot, [string[]]$AllowedRoots)
    $resolved = [IO.Path]::GetFullPath($Path)
    $repositoryPrefix = $RepositoryRoot.TrimEnd('\') + '\'
    if (-not $resolved.StartsWith($repositoryPrefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Unsafe generated path outside repository: $resolved"
    }
    $allowed = @($AllowedRoots | Where-Object {
        $root = [IO.Path]::GetFullPath($_).TrimEnd('\')
        $resolved.Equals($root, [StringComparison]::OrdinalIgnoreCase) -or
        $resolved.StartsWith(($root + '\'), [StringComparison]::OrdinalIgnoreCase)
    })
    if ($allowed.Count -eq 0) { throw "Generated path is not allowlisted: $resolved" }

    # Check every ancestor before walking; never traverse a junction or symlink.
    $ancestor = $resolved
    while ($ancestor.Length -ge $RepositoryRoot.Length) {
        if (Test-Path -LiteralPath $ancestor) {
            $item = Get-Item -LiteralPath $ancestor -Force
            if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
                throw "Refusing generated path containing a reparse point: $ancestor"
            }
        }
        $ancestor = Split-Path -Parent $ancestor
    }
    $pending = [Collections.Generic.Stack[string]]::new()
    if (Test-Path -LiteralPath $resolved -PathType Container) { $pending.Push($resolved) }
    while ($pending.Count -gt 0) {
        foreach ($item in Get-ChildItem -LiteralPath $pending.Pop() -Force) {
            if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
                throw "Refusing generated tree containing a reparse point: $($item.FullName)"
            }
            if ($item.PSIsContainer) { $pending.Push($item.FullName) }
        }
    }
    $relative = $resolved.Substring($repositoryPrefix.Length).Replace('\', '/')
    $tracked = @(& git -C $RepositoryRoot ls-files -- $relative)
    if ($LASTEXITCODE -ne 0) { throw "Unable to check tracked files: $resolved" }
    if ($tracked.Count -gt 0) { throw "Refusing to delete tracked content below: $resolved" }
    $running = @(Get-Process | Where-Object {
        -not $_.HasExited -and $_.Path -and (
            $_.Path.Equals($resolved, [StringComparison]::OrdinalIgnoreCase) -or
            $_.Path.StartsWith(($resolved + '\'), [StringComparison]::OrdinalIgnoreCase)
        )
    })
    if ($running.Count -gt 0) { throw "Generated path is in use by process $($running.Id -join ', '): $resolved" }
    return $resolved
}

function Remove-GeneratedPath {
    param([string]$Path, [string]$RepositoryRoot, [string[]]$AllowedRoots)
    $resolved = Assert-GeneratedPath -Path $Path -RepositoryRoot $RepositoryRoot -AllowedRoots $AllowedRoots
    if (Test-Path -LiteralPath $resolved) {
        Write-Host "Removing generated artifact: $resolved"
        Remove-Item -LiteralPath $resolved -Recurse -Force
    }
}
