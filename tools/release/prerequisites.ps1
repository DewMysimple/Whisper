# Local discovery only: never recreate a development environment or download models.
function Get-ReleasePython([string]$Command, [string[]]$PrefixArguments = @()) {
    $ErrorActionPreference = "Continue"
    try {
        $probe = "import sys, struct, venv, ensurepip; assert sys.platform == 'win32' and struct.calcsize('P') == 8 and sys.version_info >= (3, 10); print(sys.executable)"
        $output = @(& $Command @PrefixArguments -B -c $probe 2>$null)
        if ($LASTEXITCODE -eq 0 -and $output.Count -eq 1 -and (Test-Path -LiteralPath ([string]$output[0]) -PathType Leaf)) {
            return (Resolve-Path -LiteralPath ([string]$output[0])).Path
        }
    } catch { }
    return $null
}

function Resolve-BootstrapPython([string]$RepositoryRoot, [string]$Candidate) {
    if ($Candidate) {
        $resolved = Get-ReleasePython $Candidate
        if (-not $resolved) {
            throw "Invalid -BootstrapPython '$Candidate'. Use a working Windows x64 Python 3.10+ with venv and ensurepip."
        }
        return $resolved
    }

    $candidates = @()
    if ($env:VIRTUAL_ENV) { $candidates += Join-Path $env:VIRTUAL_ENV "Scripts\python.exe" }
    foreach ($name in @("whisper_env", ".venv", "venv", "env")) {
        $candidates += Join-Path $RepositoryRoot "$name\Scripts\python.exe"
    }
    foreach ($candidatePath in $candidates) {
        if (Test-Path -LiteralPath $candidatePath -PathType Leaf) {
            $resolved = Get-ReleasePython $candidatePath
            if ($resolved) { return $resolved }
        }
    }
    foreach ($commandName in @("python.exe", "py.exe")) {
        $command = Get-Command $commandName -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($command) {
            $prefix = if ($commandName -eq "py.exe") { @("-3") } else { @() }
            $resolved = Get-ReleasePython $command.Source $prefix
            if ($resolved) { return $resolved }
        }
    }
    throw "No usable Windows x64 Python 3.10+ was found. Pass -BootstrapPython <python.exe>; whisper_env is optional."
}

function Resolve-ReleaseCargo {
    $command = Get-Command cargo.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($command) { return $command.Source }
    $cargoRoot = if ($env:CARGO_HOME) { $env:CARGO_HOME } else { Join-Path ([Environment]::GetFolderPath("UserProfile")) ".cargo" }
    $candidate = Join-Path $cargoRoot "bin\cargo.exe"
    if (Test-Path -LiteralPath $candidate -PathType Leaf) { return $candidate }
    throw "cargo.exe was not found on PATH or below CARGO_HOME. Desktop builds require the Rust MSVC toolchain and Visual Studio C++ Build Tools."
}

function Test-ReleasePrerequisites([string]$RepositoryRoot, [string]$BootstrapPython, [string]$ModelDir, [bool]$IncludeQwen) {
    $problems = [System.Collections.Generic.List[string]]::new()
    $python = $null
    try {
        $python = Resolve-BootstrapPython $RepositoryRoot $BootstrapPython
        Write-Host "Bootstrap Python: $python"
    } catch { $problems.Add($_.Exception.Message) }

    $modelSource = if ($ModelDir) { $ModelDir } elseif ($env:WHISPER_SUBTITLE_MODEL_DIR) { $env:WHISPER_SUBTITLE_MODEL_DIR } else { Join-Path $RepositoryRoot "models\huggingface" }
    $modelSource = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($modelSource)
    Write-Host "Offline models:   $modelSource"
    if (-not (Test-Path -LiteralPath $modelSource -PathType Container)) {
        $problems.Add("Offline model directory is missing: $modelSource. Pass -ModelDir <existing-model-directory> or set WHISPER_SUBTITLE_MODEL_DIR. Models are not downloaded automatically.")
    } elseif ($python) {
        $modelArguments = @("--source", $modelSource)
        if ($IncludeQwen) { $modelArguments += "--include-qwen" }
        # Windows PowerShell 5 treats native stderr as ErrorRecords. Capture it
        # without interrupting the remaining prerequisite checks.
        $previousPreference = $ErrorActionPreference
        try {
            $ErrorActionPreference = "Continue"
            $modelOutput = @(& $python -B (Join-Path $RepositoryRoot "tools\release\stage_models.py") @modelArguments 2>&1)
            $modelExitCode = $LASTEXITCODE
        } finally { $ErrorActionPreference = $previousPreference }
        if ($modelExitCode -ne 0) {
            $problems.Add("Offline model validation failed. Pass -ModelDir with a complete local bundle. $($modelOutput -join [Environment]::NewLine)")
        } else { $modelOutput | ForEach-Object { Write-Host $_ } }
    }

    foreach ($commandName in @("node.exe", "corepack.cmd")) {
        if (-not (Get-Command $commandName -ErrorAction SilentlyContinue)) {
            $problems.Add("$commandName was not found on PATH. Use the Node/Corepack versions required by package.json.")
        }
    }
    try { $null = Resolve-ReleaseCargo } catch { $problems.Add($_.Exception.Message) }
    if ($problems.Count -gt 0) {
        throw ("Release prerequisites are incomplete; no build was started:" + [Environment]::NewLine + " - " + ($problems -join ([Environment]::NewLine + " - ")))
    }
    return @{ Python = $python; ModelSource = $modelSource }
}
