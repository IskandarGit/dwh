param(
    [string]$GitleaksImage = 'zricethezav/gitleaks:v8.28.0',
    [switch]$UncommittedOnly
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$configFile = Join-Path $repoRoot '.gitleaks.toml'
$ignoreFile = Join-Path $repoRoot '.gitleaksignore'

if (-not (Test-Path -LiteralPath $configFile)) {
    throw "Gitleaks configuration not found: $configFile"
}
if (-not (Test-Path -LiteralPath $ignoreFile)) {
    throw "Gitleaks ignore file not found: $ignoreFile"
}

Write-Host "Running Gitleaks secret scan..." -ForegroundColor Yellow

$localGitleaks = Get-Command gitleaks -ErrorAction SilentlyContinue
if ($null -ne $localGitleaks) {
    Write-Host "Using local gitleaks CLI: $($localGitleaks.Source)"
    $args = @('detect', '--source', $repoRoot, '--config', $configFile, '--gitleaks-ignore-path', $ignoreFile, '--verbose')
    if ($UncommittedOnly) {
        $args += '--no-git'
    }
    & $localGitleaks.Source @args
}
else {
    Write-Host "Using Docker container: $GitleaksImage"
    $dockerArgs = @(
        'run', '--rm',
        '-v', "${repoRoot}:/repo",
        '-w', '/repo',
        $GitleaksImage,
        'detect',
        '--source', '/repo',
        '--config', '/repo/.gitleaks.toml',
        '--gitleaks-ignore-path', '/repo/.gitleaksignore',
        '--verbose'
    )
    if ($UncommittedOnly) {
        $dockerArgs += '--no-git'
    }
    & docker @dockerArgs
}

if ($LASTEXITCODE -ne 0) {
    throw "Gitleaks secret scan failed with exit code $LASTEXITCODE. Secrets or unsuppressed false positives detected."
}

Write-Host "Gitleaks secret scan passed: 0 leaks found across Git history." -ForegroundColor Green
