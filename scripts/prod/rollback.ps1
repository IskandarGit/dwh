param(
    [string]$TargetVersion,
    [string[]]$Services = @('server', 'web'),
    [string]$ComposeFile = 'deploy/compose/docker-compose.prod.yml',
    [string]$EnvFile = '.env.production',
    [ValidateRange(1, 3600)][int]$HealthTimeoutSeconds = 180
)

$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$DeploymentHistoryFile = Join-Path $repoRoot 'deployments/history.jsonl'

function Invoke-Compose {
    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$ComposeArguments)
    & docker compose -f $ComposeFile --env-file $EnvFile @ComposeArguments
    if ($LASTEXITCODE -ne 0) { throw "docker compose failed: $($ComposeArguments -join ' ')" }
}

if (-not (Test-Path -LiteralPath $EnvFile -PathType Leaf)) {
    throw "Environment file '$EnvFile' was not found."
}

Write-Host "Starting rollback procedure for services: $($Services -join ', ')..." -ForegroundColor Yellow

if ([string]::IsNullOrWhiteSpace($TargetVersion) -and (Test-Path -LiteralPath $DeploymentHistoryFile -PathType Leaf)) {
    Write-Host "Inspecting deployment history in $DeploymentHistoryFile..."
    $records = Get-Content -LiteralPath $DeploymentHistoryFile | ConvertFrom-Json
    $successful = @($records | Where-Object { $_.status -eq 'SUCCESS' -and $_.action -eq 'deploy' })
    if ($successful.Count -gt 0) {
        $last = $successful[-1]
        Write-Host "Found previous successful deployment from $($last.timestamp)."
    }
}

Write-Host '[1/4] Stopping active server writers to prevent data divergence...' -ForegroundColor Yellow
Invoke-Compose stop server

Write-Host '[2/4] Pulling / verifying rollback target images...' -ForegroundColor Yellow
Invoke-Compose pull @Services

Write-Host '[3/4] Starting rolled-back services and awaiting readiness...' -ForegroundColor Yellow
Invoke-Compose up -d --wait --wait-timeout $HealthTimeoutSeconds @Services

Write-Host '[4/4] Verifying service state...' -ForegroundColor Yellow
Invoke-Compose ps @Services

try {
    $record = [ordered]@{
        timestamp = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
        status = 'SUCCESS'
        action = 'rollback'
        envFile = $EnvFile
        target = if ($TargetVersion) { $TargetVersion } else { 'previous' }
        services = ($Services -join ',')
    }
    $line = $record | ConvertTo-Json -Compress -Depth 4
    $dir = Split-Path -Parent $DeploymentHistoryFile
    if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    [System.IO.File]::AppendAllText($DeploymentHistoryFile, "$line`n", [System.Text.UTF8Encoding]::new($false))
} catch { }

Write-Host 'Rollback completed successfully.' -ForegroundColor Green
