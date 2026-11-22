function Get-ReleaseBuildRevision {
    if (-not (Get-Command git -ErrorAction SilentlyContinue)) { return "unknown" }
    $revision = git rev-parse HEAD 2>$null
    if ($LASTEXITCODE -ne 0 -or $revision -notmatch '^[0-9a-f]{40}$') { return "unknown" }
    git diff --quiet HEAD --
    if ($LASTEXITCODE -eq 1) { return "$revision+dirty" }
    if ($LASTEXITCODE -ne 0) { return "unknown" }
    return $revision
}

function Get-ReleaseBuildTime {
    return [DateTimeOffset]::UtcNow.ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
}
