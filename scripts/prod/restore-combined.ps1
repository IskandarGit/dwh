param(
    [Parameter(Mandatory = $true)][string]$DatabaseBackupFile,
    [Parameter(Mandatory = $true)][string]$ObjectBackupFile,
    [Parameter(Mandatory = $true)][string]$AgeIdentityFile,
    [Parameter(Mandatory = $true)][ValidatePattern('^smartupcms-restore-[a-z0-9][a-z0-9-]{2,40}$')][string]$IsolatedProjectName,
    [Parameter(Mandatory = $true)][ValidateSet('local_disk', 's3')][string]$TargetObjectProvider,
    [Parameter(Mandatory = $true)][ValidateRange(1, 31536000)][int]$MaxRpoSeconds,
    [Parameter(Mandatory = $true)][ValidateRange(1, 86400)][int]$MaxRtoSeconds,
    [string]$TargetS3Endpoint,
    [string]$TargetS3Bucket,
    [string]$TargetS3Prefix,
    [ValidateRange(1, 100)][int]$SampleDownloads = 10,
    [string]$ComposeFile = 'deploy/compose/docker-compose.prod.yml',
    [string]$EnvFile = '.env.production',
    [string]$EvidenceDirectory = 'output/managed-acceptance',
    [switch]$KeepIsolatedTarget
)

$ErrorActionPreference = 'Stop'
$startedAt = (Get-Date).ToUniversalTime()
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$gitSha = (& git -C $repoRoot rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $gitSha -notmatch '^[a-f0-9]{40}$') {
    throw 'git rev-parse HEAD did not return an immutable commit SHA.'
}
$startedByScript = $false
$temporaryRoot = Join-Path ([System.IO.Path]::GetTempPath()) ('smartupcms-combined-restore-' + [guid]::NewGuid())
$evidence = [ordered]@{
    schemaVersion = 1
    status = 'FAIL'
    generatedAt = $startedAt.ToString('o')
    gitSha = $gitSha
    isolatedProjectName = $IsolatedProjectName
    rowCounts = $null
    objectCount = 0
    missingObjects = $null
    orphanObjects = $null
    sampleDownloads = 0
    rpoSeconds = $null
    rtoSeconds = $null
    error = $null
}

function Require-Command([string]$Name) {
    $command = Get-Command $Name -ErrorAction SilentlyContinue
    if ($null -eq $command) { throw "Required command '$Name' is not installed." }
    return $command.Source
}

function Test-Checksum([string]$Path) {
    $checksumPath = "$Path.sha256"
    if (-not (Test-Path -LiteralPath $checksumPath -PathType Leaf)) { throw "Missing checksum for $([System.IO.Path]::GetFileName($Path))." }
    $expected = ((Get-Content -LiteralPath $checksumPath -TotalCount 1) -split '\s+')[0].ToLowerInvariant()
    $actual = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($expected -notmatch '^[a-f0-9]{64}$' -or $expected -ne $actual) { throw 'Encrypted backup SHA-256 verification failed.' }
}

function Invoke-Compose([string[]]$Arguments) {
    & docker compose -p $IsolatedProjectName -f $ComposeFile --env-file $EnvFile @Arguments
    if ($LASTEXITCODE -ne 0) { throw "Isolated docker compose command failed: $($Arguments -join ' ')" }
}

function Assert-SafeArchiveEntry([string]$Entry) {
    $normalized = $Entry.Replace('\', '/')
    if (-not $normalized -or $normalized.StartsWith('/') -or $normalized.Split('/') -contains '..') {
        throw 'Object backup contains an unsafe archive entry.'
    }
}

function Assert-SafeObjectKey([string]$Key) {
    if (-not $Key -or $Key -notmatch '^[A-Za-z0-9][A-Za-z0-9._/-]{0,1023}$' -or
        $Key.StartsWith('/') -or $Key.Contains('\') -or $Key.Split('/') -contains '..') {
        throw 'Object manifest contains an unsafe key.'
    }
}

$databaseBackupPath = (Resolve-Path -LiteralPath $DatabaseBackupFile).Path
$objectBackupPath = (Resolve-Path -LiteralPath $ObjectBackupFile).Path
$identityPath = (Resolve-Path -LiteralPath $AgeIdentityFile).Path
$composePath = (Resolve-Path -LiteralPath $ComposeFile).Path
$environmentPath = (Resolve-Path -LiteralPath $EnvFile).Path

$ageCommand = Get-Command 'age' -ErrorAction SilentlyContinue
$script:hasHostAge = $null -ne $ageCommand
$agePath = if ($script:hasHostAge) { $ageCommand.Source } else { $null }

$tarPath = Require-Command 'tar'

$pgRestoreCommand = Get-Command 'pg_restore' -ErrorAction SilentlyContinue
$script:hasHostPgRestore = $null -ne $pgRestoreCommand
$pgRestorePath = if ($script:hasHostPgRestore) { $pgRestoreCommand.Source } else { $null }

$awsPath = if ($TargetObjectProvider -eq 's3') { Require-Command 'aws' } else { $null }

function Invoke-AgeDecrypt([string]$Identity, [string]$InputFile, [string]$OutputFile) {
    if ($script:hasHostAge) {
        & $script:agePath --decrypt --identity $Identity --output $OutputFile $InputFile
        if ($LASTEXITCODE -ne 0) { throw 'Database age decryption failed.' }
    }
    else {
        $resolvedIn = (Resolve-Path -LiteralPath $InputFile).Path
        $inDir = Split-Path -Parent $resolvedIn
        $inLeaf = Split-Path -Leaf $resolvedIn
        $resolvedId = (Resolve-Path -LiteralPath $Identity).Path
        $idDir = Split-Path -Parent $resolvedId
        $idLeaf = Split-Path -Leaf $resolvedId
        $resolvedOut = [System.IO.Path]::GetFullPath($OutputFile)
        $outDir = Split-Path -Parent $resolvedOut
        $outLeaf = Split-Path -Leaf $resolvedOut
        & docker run --rm --entrypoint age `
            -v "${inDir}:/in:ro" `
            -v "${idDir}:/id:ro" `
            -v "${outDir}:/out" `
            smartupcms/backup:release-config-test `
            --decrypt --identity "/id/$idLeaf" --output "/out/$outLeaf" "/in/$inLeaf"
        if ($LASTEXITCODE -ne 0) { throw 'Containerized age decryption failed.' }
    }
}

function Invoke-PgRestoreList([string]$DumpFile) {
    if ($script:hasHostPgRestore) {
        & $script:pgRestorePath --list $DumpFile | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'pg_restore catalog validation failed.' }
    }
    else {
        $resolvedDump = (Resolve-Path -LiteralPath $DumpFile).Path
        $dumpDir = Split-Path -Parent $resolvedDump
        $dumpLeaf = Split-Path -Leaf $resolvedDump
        & docker run --rm --entrypoint pg_restore `
            -v "${dumpDir}:/dump:ro" `
            smartupcms/backup:release-config-test `
            --list "/dump/$dumpLeaf" | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'Containerized pg_restore catalog validation failed.' }
    }
}

Test-Checksum $databaseBackupPath
Test-Checksum $objectBackupPath
New-Item -ItemType Directory -Path $temporaryRoot | Out-Null

$databasePlain = Join-Path $temporaryRoot 'database.dump'
$objectsTar = Join-Path $temporaryRoot 'objects.tar'
$objectsExpanded = Join-Path $temporaryRoot 'objects-expanded'
New-Item -ItemType Directory -Path $objectsExpanded | Out-Null

$previousAccessKey = $env:AWS_ACCESS_KEY_ID
$previousSecretKey = $env:AWS_SECRET_ACCESS_KEY
$previousRegion = $env:AWS_DEFAULT_REGION
try {
    # Both decryptions happen before the isolated database starts. Missing/wrong
    # age keys and a partial object backup therefore fail closed.
    Invoke-AgeDecrypt -Identity $identityPath -InputFile $databaseBackupPath -OutputFile $databasePlain
    Invoke-AgeDecrypt -Identity $identityPath -InputFile $objectBackupPath -OutputFile $objectsTar

    $entries = @(& $tarPath -tf $objectsTar)
    if ($LASTEXITCODE -ne 0) { throw 'Object archive catalog validation failed.' }
    foreach ($entry in $entries) { Assert-SafeArchiveEntry $entry }
    if ($entries -notcontains 'manifest.json') { throw 'Object archive is missing manifest.json.' }
    & $tarPath -xf $objectsTar -C $objectsExpanded
    if ($LASTEXITCODE -ne 0) { throw 'Object archive extraction failed.' }

    $manifest = Get-Content -LiteralPath (Join-Path $objectsExpanded 'manifest.json') -Raw | ConvertFrom-Json
    if ($manifest.schemaVersion -ne 1 -or [int]$manifest.objectCount -ne @($manifest.objects).Count) {
        throw 'Object manifest is incomplete or incompatible.'
    }
    $seenKeys = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    $seenArchivePaths = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    foreach ($object in @($manifest.objects)) {
        Assert-SafeObjectKey "$($object.key)"
        Assert-SafeArchiveEntry "$($object.archivePath)"
        if (-not $seenKeys.Add("$($object.key)") -or -not $seenArchivePaths.Add("$($object.archivePath)")) {
            throw 'Object manifest contains duplicate keys or archive paths.'
        }
        $payload = Join-Path $objectsExpanded "$($object.archivePath)"
        if (-not (Test-Path -LiteralPath $payload -PathType Leaf)) { throw 'Object backup is partial.' }
        if ((Get-Item -LiteralPath $payload).Length -ne [long]$object.sizeBytes) { throw 'Object backup size validation failed.' }
        if ((Get-FileHash -LiteralPath $payload -Algorithm SHA256).Hash.ToLowerInvariant() -ne "$($object.sha256)".ToLowerInvariant()) {
            throw 'Object backup checksum validation failed.'
        }
    }
    $evidence.objectCount = @($manifest.objects).Count

    Invoke-PgRestoreList -DumpFile $databasePlain

    Invoke-Compose @('config', '--quiet')
    $startedByScript = $true
    Invoke-Compose @('up', '-d', '--wait', 'postgres')

    & docker compose -p $IsolatedProjectName -f $composePath --env-file $environmentPath cp $databasePlain "postgres:/tmp/restore.dump"
    if ($LASTEXITCODE -ne 0) { throw 'Failed to copy decrypted dump into postgres container.' }
    & docker compose -p $IsolatedProjectName -f $composePath --env-file $environmentPath exec -T postgres `
        sh -ec 'exec pg_restore --exit-on-error --no-owner --no-acl -U "$POSTGRES_USER" -d "$POSTGRES_DB" /tmp/restore.dump && rm -f /tmp/restore.dump'
    if ($LASTEXITCODE -ne 0) { throw 'Isolated PostgreSQL restore failed.' }

    $rowCountSql = @'
select json_build_object(
  'md_users', (select count(*) from md_users),
  'ms_tasks', (select count(*) from ms_tasks),
  'mf_files', (select count(*) from mf_files),
  'audit_log', (select count(*) from audit_log)
)::text;
'@
    $rowCountJson = ($rowCountSql | & docker compose -p $IsolatedProjectName -f $composePath --env-file $environmentPath exec -T postgres `
        sh -ec 'exec psql -X -A -t -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"') -join "`n"
    if ($LASTEXITCODE -ne 0) { throw 'Restored row-count query failed.' }
    $evidence.rowCounts = $rowCountJson.Trim() | ConvertFrom-Json

    $fileInventorySql = @'
select coalesce(json_agg(row_to_json(x)), '[]'::json)::text
from (
  select distinct storage_bucket || '/' || storage_key as key, size_bytes, sha256
  from mf_files
  order by storage_bucket || '/' || storage_key
) x;
'@
    $databaseInventoryJson = ($fileInventorySql | & docker compose -p $IsolatedProjectName -f $composePath --env-file $environmentPath exec -T postgres `
        sh -ec 'exec psql -X -A -t -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"') -join "`n"
    $databaseKeys = [System.Collections.Generic.List[string]]::new()
    $parsedDbInventory = $databaseInventoryJson.Trim() | ConvertFrom-Json
    foreach ($item in $parsedDbInventory) {
        if ($item -is [System.Collections.IEnumerable] -and $item -isnot [string]) {
            foreach ($sub in $item) { $databaseKeys.Add([string]$sub.key) }
        } else {
            $databaseKeys.Add([string]$item.key)
        }
    }
    $backupKeys = [System.Collections.Generic.List[string]]::new()
    foreach ($item in $manifest.objects) {
        if ($item -is [System.Collections.IEnumerable] -and $item -isnot [string]) {
            foreach ($sub in $item) { $backupKeys.Add([string]$sub.key) }
        } else {
            $backupKeys.Add([string]$item.key)
        }
    }
    $missing = @($databaseKeys | Where-Object { $backupKeys -notcontains $_ })
    $orphans = @($backupKeys | Where-Object { $databaseKeys -notcontains $_ })
    $evidence.missingObjects = $missing.Count
    $evidence.orphanObjects = $orphans.Count
    if ($missing.Count -gt 0 -or $orphans.Count -gt 0) {
        throw "Database and object inventories do not match. Missing in backup: [$($missing -join ', ')]; Orphans in backup: [$($orphans -join ', ')]."
    }

    $sample = @($manifest.objects | Select-Object -First ([Math]::Min($SampleDownloads, @($manifest.objects).Count)))
    if ($TargetObjectProvider -eq 'local_disk') {
        $targetRoot = Join-Path $temporaryRoot 'isolated-local-storage'
        foreach ($object in @($manifest.objects)) {
            $target = Join-Path $targetRoot "$($object.key)"
            $null = New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force
            Copy-Item -LiteralPath (Join-Path $objectsExpanded "$($object.archivePath)") -Destination $target
        }
        foreach ($object in $sample) {
            $target = Join-Path $targetRoot "$($object.key)"
            if ((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant() -ne "$($object.sha256)".ToLowerInvariant()) {
                throw 'Sampled local object download failed checksum validation.'
            }
            $evidence.sampleDownloads++
        }
    }
    else {
        if (-not $TargetS3Endpoint -or -not $TargetS3Bucket -or -not $TargetS3Prefix) {
            throw 'TargetS3Endpoint, TargetS3Bucket, and TargetS3Prefix are required for an S3 restore drill.'
        }
        if ($manifest.sourceBucket -eq $TargetS3Bucket) { throw 'The restore-drill bucket must differ from the source application bucket.' }
        $requiredPrefix = "restore-drill/$IsolatedProjectName/"
        $normalizedPrefix = $TargetS3Prefix.Trim('/') + '/'
        if ($normalizedPrefix -ne $requiredPrefix) { throw "TargetS3Prefix must equal '$requiredPrefix'." }
        if (-not $env:RESTORE_AWS_ACCESS_KEY_ID -or -not $env:RESTORE_AWS_SECRET_ACCESS_KEY) {
            throw 'RESTORE_AWS_ACCESS_KEY_ID and RESTORE_AWS_SECRET_ACCESS_KEY are required.'
        }
        $env:AWS_ACCESS_KEY_ID = $env:RESTORE_AWS_ACCESS_KEY_ID
        $env:AWS_SECRET_ACCESS_KEY = $env:RESTORE_AWS_SECRET_ACCESS_KEY
        $env:AWS_DEFAULT_REGION = 'auto'
        foreach ($object in @($manifest.objects)) {
            & $awsPath --endpoint-url $TargetS3Endpoint s3api put-object --bucket $TargetS3Bucket `
                --key "$normalizedPrefix$($object.key)" --body (Join-Path $objectsExpanded "$($object.archivePath)") --no-cli-pager | Out-Null
            if ($LASTEXITCODE -ne 0) { throw 'Isolated S3 object restore failed.' }
        }
        foreach ($object in $sample) {
            $download = Join-Path $temporaryRoot ('sample-' + [guid]::NewGuid().ToString('N'))
            & $awsPath --endpoint-url $TargetS3Endpoint s3api get-object --bucket $TargetS3Bucket `
                --key "$normalizedPrefix$($object.key)" $download --no-cli-pager | Out-Null
            if ($LASTEXITCODE -ne 0 -or
                (Get-FileHash -LiteralPath $download -Algorithm SHA256).Hash.ToLowerInvariant() -ne "$($object.sha256)".ToLowerInvariant()) {
                throw 'Sampled S3 object download failed checksum validation.'
            }
            $evidence.sampleDownloads++
        }
    }

    $dbManifestPath = "${databaseBackupPath}.manifest.json"
    $databaseCapturedAt = $null

    if (Test-Path -LiteralPath $dbManifestPath -PathType Leaf) {
        $dbManifestChecksum = "${dbManifestPath}.sha256"
        if (Test-Path -LiteralPath $dbManifestChecksum -PathType Leaf) {
            Test-Checksum $dbManifestPath
        }
        $dbManifest = Get-Content -LiteralPath $dbManifestPath -Raw | ConvertFrom-Json
        if ($dbManifest.schemaVersion -ne 1) { throw 'Unsupported database manifest schema version.' }
        if (-not [string]::IsNullOrWhiteSpace($dbManifest.archiveSha256)) {
            $expectedArchiveHash = (Get-FileHash -LiteralPath $databaseBackupPath -Algorithm SHA256).Hash.ToLowerInvariant()
            if ($dbManifest.archiveSha256.ToLowerInvariant() -ne $expectedArchiveHash) {
                throw 'Database manifest archiveSha256 does not match database backup file.'
            }
        }
        if ([string]::IsNullOrWhiteSpace($dbManifest.capturedAt)) {
            throw 'Database manifest is missing capturedAt timestamp.'
        }
        $databaseCapturedAt = [datetime]::Parse("$($dbManifest.capturedAt)").ToUniversalTime()
    }
    elseif ((Split-Path -Leaf $databaseBackupPath) -match 'smartupcms-(\d{8}T\d{6}Z)\.dump\.age') {
        $databaseCapturedAt = [datetime]::ParseExact($matches[1], 'yyyyMMddTHHmmssZ', [System.Globalization.CultureInfo]::InvariantCulture, [System.Globalization.DateTimeStyles]::AssumeUniversal).ToUniversalTime()
    }
    else {
        throw 'Database backup capture timestamp cannot be authentically determined (no valid manifest or standard timestamped filename).'
    }

    $nowUtc = (Get-Date).ToUniversalTime()
    if ($databaseCapturedAt -gt $nowUtc.AddSeconds(300)) {
        throw 'Database backup capture timestamp is in the future.'
    }
    $objectCapturedAt = [datetime]::Parse("$($manifest.capturedAt)").ToUniversalTime()
    if ($objectCapturedAt -gt $nowUtc.AddSeconds(300)) {
        throw 'Object backup capture timestamp is in the future.'
    }

    $pointInTimeSkewSeconds = [int][Math]::Abs(($databaseCapturedAt - $objectCapturedAt).TotalSeconds)
    $evidence.pointInTimeSkewSeconds = $pointInTimeSkewSeconds
    $evidence.databaseCapturedAt = $databaseCapturedAt.ToString('o')
    $evidence.objectCapturedAt = $objectCapturedAt.ToString('o')
    if ($pointInTimeSkewSeconds -gt $MaxRpoSeconds) {
        throw "Point-in-time skew between database and object backup ($pointInTimeSkewSeconds s) exceeds MaxRpoSeconds ($MaxRpoSeconds s)."
    }

    $oldestCapture = if ($databaseCapturedAt -lt $objectCapturedAt) { $databaseCapturedAt } else { $objectCapturedAt }
    $evidence.rpoSeconds = [int][Math]::Ceiling(($nowUtc - $oldestCapture).TotalSeconds)
    if ($evidence.rpoSeconds -gt $MaxRpoSeconds) { throw 'Measured RPO exceeds the approved threshold.' }
    $evidence.rtoSeconds = [int][Math]::Ceiling(($nowUtc - $startedAt).TotalSeconds)
    if ($evidence.rtoSeconds -gt $MaxRtoSeconds) { throw 'Measured RTO exceeds the approved threshold.' }
    $evidence.status = 'PASS'
}
catch {
    $evidence.error = $_.Exception.Message
    throw
}
finally {
    $finishedAt = (Get-Date).ToUniversalTime()
    if ($null -eq $evidence.rtoSeconds) { $evidence.rtoSeconds = [int][Math]::Ceiling(($finishedAt - $startedAt).TotalSeconds) }
    $evidence.finishedAt = $finishedAt.ToString('o')
    $evidenceRoot = if ([System.IO.Path]::IsPathRooted($EvidenceDirectory)) {
        [System.IO.Path]::GetFullPath($EvidenceDirectory)
    } else {
        [System.IO.Path]::GetFullPath((Join-Path $repoRoot $EvidenceDirectory))
    }
    New-Item -ItemType Directory -Path $evidenceRoot -Force | Out-Null
    $evidenceFile = Join-Path $evidenceRoot ("combined-restore-{0}.json" -f $startedAt.ToString('yyyyMMddTHHmmssZ'))
    $evidencePartial = "$evidenceFile.partial"
    [System.IO.File]::WriteAllText($evidencePartial, ($evidence | ConvertTo-Json -Depth 8), [System.Text.UTF8Encoding]::new($false))
    Move-Item -LiteralPath $evidencePartial -Destination $evidenceFile -Force

    if (-not $KeepIsolatedTarget) {
        if ($TargetObjectProvider -eq 's3' -and $TargetS3Endpoint -and $TargetS3Bucket -and $TargetS3Prefix -and $awsPath) {
            $normalizedPrefix = $TargetS3Prefix.Trim('/') + '/'
            if ($normalizedPrefix -eq "restore-drill/$IsolatedProjectName/") {
                & $awsPath --endpoint-url $TargetS3Endpoint s3 rm "s3://$TargetS3Bucket/$normalizedPrefix" --recursive --only-show-errors 2>$null | Out-Null
            }
        }
        if ($startedByScript) {
            $prev = $ErrorActionPreference
            $ErrorActionPreference = 'Continue'
            & docker compose -p $IsolatedProjectName -f $composePath --env-file $environmentPath down --volumes --remove-orphans 2>&1 | Out-Null
            $ErrorActionPreference = $prev
        }
    }
    Remove-Item -LiteralPath $temporaryRoot -Recurse -Force -ErrorAction SilentlyContinue
    $env:AWS_ACCESS_KEY_ID = $previousAccessKey
    $env:AWS_SECRET_ACCESS_KEY = $previousSecretKey
    $env:AWS_DEFAULT_REGION = $previousRegion
    Write-Host "Combined restore evidence: $evidenceFile"
}

if ($evidence.status -ne 'PASS') { exit 1 }
Write-Host 'Combined PostgreSQL and object restore drill passed.' -ForegroundColor Green
