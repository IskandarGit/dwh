param()

$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$errors = [System.Collections.Generic.List[string]]::new()

function Add-ContractError([string]$Message) {
    $errors.Add($Message)
}

function Assert-Matches([string]$Text, [string]$Pattern, [string]$Message) {
    if ($Text -notmatch $Pattern) { Add-ContractError $Message }
}

$requiredFiles = @(
    'deploy/acceptance/.env.managed.example',
    'deploy/acceptance/runtime-metrics.example.json',
    'scripts/acceptance/invoke-managed-preflight.ps1',
    'scripts/acceptance/invoke-managed-host-check.ps1',
    'scripts/acceptance/run-capacity.ps1',
    'scripts/acceptance/run-failure-scenario.ps1',
    'scripts/acceptance/load/common.js',
    'scripts/acceptance/load/interactive.js',
    'scripts/acceptance/load/upload-contention.js',
    'scripts/acceptance/load/soak.js',
    'scripts/prod/backup-objects.ps1',
    'scripts/prod/restore-combined.ps1',
    'scripts/release/verify-published-release.ps1',
    'docs/ops/managed-infrastructure-acceptance.md'
)

foreach ($relativePath in $requiredFiles) {
    if (-not (Test-Path -LiteralPath (Join-Path $repoRoot $relativePath) -PathType Leaf)) {
        Add-ContractError "Missing managed acceptance artifact: $relativePath"
    }
}

$templatePath = Join-Path $repoRoot 'deploy/acceptance/.env.managed.example'
if (Test-Path -LiteralPath $templatePath -PathType Leaf) {
    $template = Get-Content -LiteralPath $templatePath -Raw
    foreach ($key in @(
        'ACCEPTANCE_PROFILE_ID', 'ACCEPTANCE_PUBLIC_ORIGIN', 'ACCEPTANCE_ORIGIN_IP',
        'ACCEPTANCE_EXPECTED_SERVER_IMAGE', 'ACCEPTANCE_EXPECTED_WEB_IMAGE',
        'ACCEPTANCE_EXPECTED_BACKUP_IMAGE', 'ACCEPTANCE_EXPECTED_POSTGRES_IMAGE',
        'ACCEPTANCE_EXPECTED_TYPESENSE_IMAGE', 'ACCEPTANCE_CLOUDFLARE_ACCOUNT_ID',
        'ACCEPTANCE_CLOUDFLARE_ZONE_ID', 'ACCEPTANCE_R2_BUCKET',
        'ACCEPTANCE_R2_RECOVERY_BUCKET', 'ACCEPTANCE_R2_ENDPOINT',
        'ACCEPTANCE_R2_LIFECYCLE_RULE_ID', 'ACCEPTANCE_ALERT_HEALTHCHECK_URL',
        'ACCEPTANCE_MAX_P95_MS', 'ACCEPTANCE_MAX_P99_MS',
        'ACCEPTANCE_MAX_ERROR_RATE', 'ACCEPTANCE_MAX_HIKARI_PENDING',
        'ACCEPTANCE_MAX_HEAP_PERCENT', 'ACCEPTANCE_MIN_FREE_DISK_GIB',
        'ACCEPTANCE_MAX_TEMP_GROWTH_MIB', 'ACCEPTANCE_MAX_SCANNER_P95_MS',
        'ACCEPTANCE_MAX_R2_P95_MS', 'ACCEPTANCE_MAX_ORPHAN_OBJECTS'
    )) {
        Assert-Matches $template "(?m)^$([regex]::Escape($key))=" "Managed template is missing $key."
    }
    if ($template -match '(?m)^(?:CLOUDFLARE_API_TOKEN|AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY)=\S+') {
        Add-ContractError 'Managed template must not contain Cloudflare or R2 secret values.'
    }
}

$preflightPath = Join-Path $repoRoot 'scripts/acceptance/invoke-managed-preflight.ps1'
if (Test-Path -LiteralPath $preflightPath -PathType Leaf) {
    $preflight = Get-Content -LiteralPath $preflightPath -Raw
    foreach ($pattern in @(
        'https', 'cf-ray', 'strict-transport-security', 'content-security-policy',
        'x-content-type-options', 'x-frame-options', 'referrer-policy', 'permissions-policy',
        '/zones/.+/dns_records', 'http_request_firewall_managed', 'http_ratelimit',
        '/domains/managed', '/domains/custom', '/cors', '/lifecycle',
        'put-object', 'get-object', 'delete-object', 'head-object',
        'git rev-parse HEAD', 'ACCEPTANCE_EXPECTED_SERVER_IMAGE',
        'ConvertTo-Json', 'UNVERIFIED'
    )) {
        Assert-Matches $preflight $pattern "Managed preflight is missing required control '$pattern'."
    }
}

$capacityPath = Join-Path $repoRoot 'scripts/acceptance/run-capacity.ps1'
if (Test-Path -LiteralPath $capacityPath -PathType Leaf) {
    $capacity = Get-Content -LiteralPath $capacityPath -Raw
    Assert-Matches $capacity 'grafana/k6:[^\s"'']+@sha256:[a-f0-9]{64}' 'Capacity runner must pin the k6 image by digest.'
    Assert-Matches $capacity '100' 'Capacity runner must default to 100 active users.'
    Assert-Matches $capacity '20' 'Capacity runner must default to 20 concurrent uploads.'
    Assert-Matches $capacity '4h' 'Capacity runner must expose the four-hour soak profile.'
    Assert-Matches $capacity 'HashSet\[string\]' 'Capacity runner must reject duplicate load-user tokens.'
    Assert-Matches $capacity 'IsNaN|IsInfinity' 'Capacity runner must reject non-finite approved thresholds.'
}

foreach ($loadFile in @('common.js', 'interactive.js', 'upload-contention.js', 'soak.js')) {
    $loadPath = Join-Path $repoRoot "scripts/acceptance/load/$loadFile"
    if (Test-Path -LiteralPath $loadPath -PathType Leaf) {
        $load = Get-Content -LiteralPath $loadPath -Raw
        Assert-Matches $load 'ACCEPTANCE_MAX_P95_MS' "$loadFile must bind thresholds to approved acceptance values."
        Assert-Matches $load 'ACCEPTANCE_MAX_P99_MS' "$loadFile must bind p99 to approved acceptance values."
        Assert-Matches $load 'ACCEPTANCE_MAX_ERROR_RATE' "$loadFile must bind error rate to approved acceptance values."
    }
}

$backupObjectsPath = Join-Path $repoRoot 'scripts/prod/backup-objects.ps1'
if (Test-Path -LiteralPath $backupObjectsPath -PathType Leaf) {
    $backupObjects = Get-Content -LiteralPath $backupObjectsPath -Raw
    foreach ($pattern in @('manifest.json', 'SHA256', 'age', 'local_disk', 's3', 'partial')) {
        Assert-Matches $backupObjects $pattern "Object backup is missing '$pattern'."
    }
}

$restoreCombinedPath = Join-Path $repoRoot 'scripts/prod/restore-combined.ps1'
if (Test-Path -LiteralPath $restoreCombinedPath -PathType Leaf) {
    $restoreCombined = Get-Content -LiteralPath $restoreCombinedPath -Raw
    foreach ($pattern in @(
        'IsolatedProjectName', 'ObjectBackupFile', 'AgeIdentityFile', 'manifest.json',
        'Get-FileHash', 'pg_restore', 'rowCounts', 'objectCount', 'rpoSeconds',
        'rtoSeconds', 'sampleDownloads', 'git rev-parse HEAD', 'partial'
    )) {
        Assert-Matches $restoreCombined $pattern "Combined restore is missing '$pattern'."
    }
    Assert-Matches $restoreCombined '(?s)\$startedByScript\s*=\s*\$true\s*\r?\n\s*Invoke-Compose\s+@\(''up''' 'Combined restore must arm isolated cleanup before starting Compose.'
}

if (Test-Path -LiteralPath $preflightPath -PathType Leaf) {
    Assert-Matches $preflight 'r2CleanupKey' 'Managed preflight must retain a cleanup key for failed R2 round-trips.'
}

$releaseVerifierPath = Join-Path $repoRoot 'scripts/release/verify-published-release.ps1'
if (Test-Path -LiteralPath $releaseVerifierPath -PathType Leaf) {
    $releaseVerifier = Get-Content -LiteralPath $releaseVerifierPath -Raw
    foreach ($pattern in @('SHA256SUMS', 'cosign verify', 'gh attestation verify', 'cyclonedx', 'spdx', '@sha256:')) {
        Assert-Matches $releaseVerifier $pattern "Published release verifier is missing '$pattern'."
    }
}

foreach ($script in Get-ChildItem -LiteralPath (Join-Path $repoRoot 'scripts') -Recurse -Filter '*.ps1') {
    try {
        $scriptContent = [System.IO.File]::ReadAllText($script.FullName, [System.Text.Encoding]::UTF8)
        [scriptblock]::Create($scriptContent) | Out-Null
    }
    catch {
        Add-ContractError "PowerShell syntax error in $($script.FullName): $($_.Exception.Message)"
    }
}

if ($errors.Count -gt 0) {
    $errors | ForEach-Object { Write-Error $_ -ErrorAction Continue }
    exit 1
}

Write-Host 'Managed infrastructure acceptance contract passed.'
