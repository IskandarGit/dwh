param(
    [string]$ComposeFile = 'deploy/compose/docker-compose.prod.yml',
    [string]$EnvFile = '.env.production',
    [ValidateRange(1, 3600)][int]$HealthTimeoutSeconds = 180,
    [switch]$VerifyRelease,
    [string]$ReleaseDirectory = ''
)

$ErrorActionPreference = 'Stop'

function Invoke-Compose {
    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$ComposeArguments)
    & docker compose -f $ComposeFile --env-file $EnvFile @ComposeArguments
    if ($LASTEXITCODE -ne 0) { throw "docker compose failed: $($ComposeArguments -join ' ')" }
}

if (-not (Test-Path -LiteralPath $EnvFile -PathType Leaf)) {
    throw "Environment file '$EnvFile' was not found."
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$DeploymentHistoryFile = Join-Path $repoRoot 'deployments/history.jsonl'

function Capture-RunningDigests {
    $services = @('server', 'web', 'backup', 'postgres', 'typesense', 'clamav')
    $result = [ordered]@{}
    foreach ($s in $services) {
        $cid = (& docker compose -f $ComposeFile --env-file $EnvFile ps -q $s 2>$null) -join ''
        if (-not [string]::IsNullOrWhiteSpace($cid)) {
            $imageRef = (& docker inspect --format '{{.Config.Image}}' $cid 2>$null) -join ''
            $imageId = (& docker inspect --format '{{.Image}}' $cid 2>$null) -join ''
            $result[$s] = [ordered]@{ image = $imageRef.Trim(); id = $imageId.Trim() }
        }
    }
    return $result
}

$previousDigests = [ordered]@{}

function Record-DeploymentEvent([string]$Status, [string]$Message) {
    try {
        $activeDigests = Capture-RunningDigests
        $dir = Split-Path -Parent $DeploymentHistoryFile
        if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
        $record = [ordered]@{
            timestamp = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
            status = $Status
            action = 'deploy'
            envFile = $EnvFile
            previousDigests = $previousDigests
            activeDigests = $activeDigests
            message = $Message
        }
        $line = $record | ConvertTo-Json -Compress -Depth 4
        [System.IO.File]::AppendAllText($DeploymentHistoryFile, "$line`n", [System.Text.UTF8Encoding]::new($false))
    } catch { }
}

try {
    Write-Host '[1/7] Validating the unified production configuration...' -ForegroundColor Yellow
    & docker compose version | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Docker Compose is unavailable.' }
    Invoke-Compose config --quiet
    $previousDigests = Capture-RunningDigests

    # Release verification gate: when requested or when release metadata is present
    $resolvedReleaseDir = if (-not [string]::IsNullOrWhiteSpace($ReleaseDirectory)) {
        (Resolve-Path -LiteralPath $ReleaseDirectory).Path
    } elseif (Test-Path -LiteralPath (Join-Path $repoRoot 'SHA256SUMS') -PathType Leaf) {
        $repoRoot
    } else {
        $null
    }

    if ($VerifyRelease -and $null -eq $resolvedReleaseDir) {
        throw 'Release verification requested (-VerifyRelease), but no release metadata (SHA256SUMS or IMAGES.txt) was found.'
    }

    if ($null -ne $resolvedReleaseDir) {
        Write-Host "Verifying release integrity in '$resolvedReleaseDir'..." -ForegroundColor Yellow
        $checksumsPath = Join-Path $resolvedReleaseDir 'SHA256SUMS'
        if (Test-Path -LiteralPath $checksumsPath -PathType Leaf) {
            foreach ($line in Get-Content -LiteralPath $checksumsPath) {
                if ($line -match '^([a-f0-9]{64})\s+\*?(.+)$') {
                    $expectedHash = $Matches[1].ToLowerInvariant()
                    $relFile = $Matches[2].TrimStart('.', '/', '\')
                    $targetFile = Join-Path $resolvedReleaseDir $relFile
                    if (Test-Path -LiteralPath $targetFile -PathType Leaf) {
                        $actualHash = (Get-FileHash -LiteralPath $targetFile -Algorithm SHA256).Hash.ToLowerInvariant()
                        if ($actualHash -ne $expectedHash) {
                            throw "Release integrity check failed: checksum mismatch for '$relFile'."
                        }
                    }
                }
            }
        }

        $imagesTxtPath = Join-Path $resolvedReleaseDir 'IMAGES.txt'
        if (-not (Test-Path -LiteralPath $imagesTxtPath -PathType Leaf)) {
            $imagesTxtPath = Join-Path $resolvedReleaseDir 'scripts/prod/IMAGES.txt'
        }
        if (Test-Path -LiteralPath $imagesTxtPath -PathType Leaf) {
            $approvedImages = @(Get-Content -LiteralPath $imagesTxtPath | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | ForEach-Object { $_.Trim() })
            $composeConfig = (& docker compose -f $ComposeFile --env-file $EnvFile config --format json | ConvertFrom-Json)
            foreach ($serviceName in @('server', 'web', 'backup', 'postgres', 'typesense')) {
                $serviceConfig = $composeConfig.services.$serviceName
                if ($null -ne $serviceConfig -and -not [string]::IsNullOrWhiteSpace($serviceConfig.image)) {
                    $configuredImage = $serviceConfig.image.Trim()
                    $matched = $false
                    foreach ($appr in $approvedImages) {
                        if ($configuredImage -eq $appr -or $configuredImage.EndsWith("/$appr") -or $appr.EndsWith("/$configuredImage")) {
                            $matched = $true
                            break
                        }
                        $apprDigest = if ($appr -match '@(sha256:[a-f0-9]{64})') { $Matches[1] } else { '' }
                        if (-not [string]::IsNullOrWhiteSpace($apprDigest) -and $configuredImage -match '@(sha256:[a-f0-9]{64})' -and $Matches[1] -eq $apprDigest) {
                            $matched = $true
                            break
                        }
                    }
                    if (-not $matched) {
                        throw "Release verification failed: image '$configuredImage' for service '$serviceName' is not in approved release IMAGES.txt."
                    }
                }
            }
        }
        Write-Host 'Release integrity verification passed.' -ForegroundColor Green
    }

    Write-Host '[2/7] Pulling immutable release images...' -ForegroundColor Yellow
    Invoke-Compose pull

    Write-Host '[3/7] Creating the mandatory pre-migration backup when data exists...' -ForegroundColor Yellow
    $postgresId = & docker compose -f $ComposeFile --env-file $EnvFile ps -a -q postgres
    if ($LASTEXITCODE -ne 0) { throw 'Unable to inspect PostgreSQL.' }

    $hasExistingData = -not [string]::IsNullOrWhiteSpace(($postgresId -join ''))
    if (-not $hasExistingData) {
        try {
            $configJsonText = & docker compose -f $ComposeFile --env-file $EnvFile config --format json 2>$null
            if ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace(($configJsonText -join ''))) {
                $config = $configJsonText | ConvertFrom-Json
                $postgresVolume = $config.volumes.'postgres-data'.name
                if (-not [string]::IsNullOrWhiteSpace($postgresVolume)) {
                    & docker volume inspect $postgresVolume 2>$null | Out-Null
                    if ($LASTEXITCODE -eq 0) {
                        $hasExistingData = $true
                    }
                }
            }
        }
        catch {
            # In case config or volume inspect fails, proceed with container status
        }
    }

    if ($hasExistingData) {
        Write-Host 'Existing PostgreSQL container or volume detected; ensuring service is up...' -ForegroundColor Yellow
        Invoke-Compose up -d --wait --wait-timeout $HealthTimeoutSeconds postgres

        $tableCount = -1
        try {
            $tableCountStr = (& docker compose -f $ComposeFile --env-file $EnvFile exec -T postgres `
                psql -U postgres -d smartupcms -t -A -c "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'" 2>$null) -join ''
            if ($tableCountStr -match '^\d+$') {
                $tableCount = [int]$tableCountStr.Trim()
            }
        } catch { }

        if ($tableCount -eq 0) {
            Write-Host 'PostgreSQL database contains no existing tables; skipping pre-migration backup for fresh install.'
        }
        else {
            Write-Host 'Existing PostgreSQL data detected; refreshing backup role and creating pre-migration backup...' -ForegroundColor Yellow
            Invoke-Compose run --rm backup-bootstrap
            & (Join-Path $PSScriptRoot 'backup.ps1') -ComposeFile $ComposeFile -EnvFile $EnvFile
            if ($LASTEXITCODE -ne 0) { throw 'Pre-migration backup failed.' }
        }
    }
    else {
        Write-Host 'No existing PostgreSQL container or volume found; treating this as an initial deployment.'
    }

    Write-Host '[4/7] Starting dependencies...' -ForegroundColor Yellow
    Invoke-Compose up -d --wait --wait-timeout $HealthTimeoutSeconds postgres typesense

    Write-Host '[5/7] Applying forward-only database migrations...' -ForegroundColor Yellow
    Invoke-Compose run --rm backup-bootstrap
    Invoke-Compose run --rm migrate

    Write-Host '[6/7] Refreshing database roles and permissions...' -ForegroundColor Yellow
    Invoke-Compose run --rm backup-bootstrap

    Write-Host '[7/7] Starting SmartupCMS and waiting for readiness...' -ForegroundColor Yellow
    Invoke-Compose up -d --remove-orphans --wait --wait-timeout $HealthTimeoutSeconds
    Invoke-Compose ps

    Record-DeploymentEvent 'SUCCESS' 'Deployment completed successfully'
}
catch {
    Write-Error $_
    Record-DeploymentEvent 'FAILED' "$_"
    & docker compose -f $ComposeFile --env-file $EnvFile ps
    exit 1
}

Write-Host 'Deployment completed successfully.' -ForegroundColor Green
