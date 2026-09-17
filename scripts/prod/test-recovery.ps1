param()

$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$composeFile = Join-Path $repoRoot 'deploy/compose/docker-compose.prod.yml'
$envTemplate = Join-Path $PSScriptRoot 'release-config.test.env'
$backupObjectsScript = Join-Path $PSScriptRoot 'backup-objects.ps1'
$restoreCombinedScript = Join-Path $PSScriptRoot 'restore-combined.ps1'

$testId = [guid]::NewGuid().ToString('N').Substring(0, 8)
$isolatedProject = "smartupcms-restore-$testId"
$testRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("smartupcms-recovery-test-" + $testId)
$backupDir = Join-Path $testRoot 'backups'
$sourceStorageDir = Join-Path $testRoot 'source-storage'
$identityFile = Join-Path $testRoot 'identity.txt'
$evidenceDir = Join-Path $testRoot 'evidence'

New-Item -ItemType Directory -Path $testRoot, $backupDir, $sourceStorageDir, $evidenceDir -Force | Out-Null

$testEnvFile = Join-Path $testRoot '.env.test'
$databasePasswordFile = Join-Path $testRoot 'db-password'
$backupPasswordFile = Join-Path $testRoot 'backup-password'
Set-Content -LiteralPath $databasePasswordFile -Value 'test-db-pass-recovery' -NoNewline
Set-Content -LiteralPath $backupPasswordFile -Value 'test-backup-pass-recovery' -NoNewline

$envContent = Get-Content -LiteralPath $envTemplate -Raw
$envContent = $envContent -replace '(?m)^DB_PASSWORD_FILE=.*', "DB_PASSWORD_FILE=$databasePasswordFile"
$envContent = $envContent -replace '(?m)^BACKUP_DB_PASSWORD_FILE=.*', "BACKUP_DB_PASSWORD_FILE=$backupPasswordFile"
$envContent += "`nPOSTGRES_IMAGE=postgres:18-alpine`nBACKUP_IMAGE=smartupcms/backup:release-config-test`n"
[System.IO.File]::WriteAllText($testEnvFile, $envContent, [System.Text.UTF8Encoding]::new($false))

Write-Host "=== Starting Recovery Drill Automated Test [$isolatedProject] ===" -ForegroundColor Cyan

try {
    # Generate test age keypair
    Write-Host '[1/6] Generating age keypair for backup encryption...' -ForegroundColor Yellow
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $keyRaw = (& docker run --rm --entrypoint age-keygen smartupcms/backup:release-config-test 2>&1)
    $ErrorActionPreference = $prevEap

    $recipientMatch = ($keyRaw | Select-String '(age1[a-z0-9]+)')
    if (-not $recipientMatch) { throw 'Failed to generate age recipient key.' }
    $recipient = $recipientMatch.Matches[0].Groups[1].Value

    $secretKeyMatch = ($keyRaw | Select-String '(AGE-SECRET-KEY-1[a-z0-9]+)')
    if (-not $secretKeyMatch) { throw 'Failed to extract age secret key.' }
    $secretKey = $secretKeyMatch.Matches[0].Groups[1].Value
    Set-Content -LiteralPath $identityFile -Value $secretKey -Encoding ascii

    # Prepare seed files in local object storage
    Write-Host '[2/6] Seeding sample file objects...' -ForegroundColor Yellow
    $sampleFile1 = Join-Path $sourceStorageDir 'local/report-2026.pdf'
    $sampleFile2 = Join-Path $sourceStorageDir 'local/avatar.png'
    New-Item -ItemType Directory -Path (Split-Path -Parent $sampleFile1) -Force | Out-Null
    [System.IO.File]::WriteAllBytes($sampleFile1, [System.Text.Encoding]::UTF8.GetBytes("Sample PDF content for recovery test $testId"))
    [System.IO.File]::WriteAllBytes($sampleFile2, [System.Text.Encoding]::UTF8.GetBytes("PNG binary data for test $testId"))
    $hash1 = (Get-FileHash -LiteralPath $sampleFile1 -Algorithm SHA256).Hash.ToLowerInvariant()
    $hash2 = (Get-FileHash -LiteralPath $sampleFile2 -Algorithm SHA256).Hash.ToLowerInvariant()
    $size1 = (Get-Item -LiteralPath $sampleFile1).Length
    $size2 = (Get-Item -LiteralPath $sampleFile2).Length

    # Start isolated postgres and seed tables
    Write-Host '[3/6] Starting isolated database and seeding data...' -ForegroundColor Yellow
    & docker compose -p $isolatedProject -f $composeFile --env-file $testEnvFile up -d --wait postgres
    if ($LASTEXITCODE -ne 0) { throw 'Failed to start isolated postgres container.' }

    $seedSql = @"
create table if not exists md_users (id text primary key, username text);
create table if not exists ms_tasks (id text primary key, title text);
create table if not exists mf_files (id text primary key, storage_bucket text, storage_key text, size_bytes bigint, sha256 text);
create table if not exists audit_log (id text primary key, action text);

delete from md_users;
delete from ms_tasks;
delete from mf_files;
delete from audit_log;

insert into md_users values ('u1', 'admin'), ('u2', 'operator');
insert into ms_tasks values ('t1', 'Deploy recovery test'), ('t2', 'Verify backup integrity'), ('t3', 'Check consistency');
insert into mf_files values ('f1', 'local', 'report-2026.pdf', $size1, '$hash1'), ('f2', 'local', 'avatar.png', $size2, '$hash2');
insert into audit_log values ('a1', 'INITIAL_SEED'), ('a2', 'CONFIG_LOAD');
"@
    & docker compose -p $isolatedProject -f $composeFile --env-file $testEnvFile exec -T postgres `
        psql -U postgres -d smartupcms -v ON_ERROR_STOP=1 -c "$seedSql"
    if ($LASTEXITCODE -ne 0) { throw 'Failed to seed isolated test database.' }

    # Capture encrypted database dump and manifest
    Write-Host '[4/6] Capturing encrypted database dump and manifest...' -ForegroundColor Yellow
    $timestamp = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')
    $dbDumpFile = Join-Path $backupDir "smartupcms-$timestamp.dump.age"
    $dbDumpChecksum = "$dbDumpFile.sha256"
    $dbManifestFile = "$dbDumpFile.manifest.json"
    $dbManifestChecksum = "$dbManifestFile.sha256"

    $dbPlain = Join-Path $testRoot 'plain.dump'
    & docker compose -p $isolatedProject -f $composeFile --env-file $testEnvFile exec -T postgres `
        sh -ec 'pg_dump --format=custom --no-owner --no-privileges -U postgres -d smartupcms -f /tmp/plain.dump'
    if ($LASTEXITCODE -ne 0) { throw 'pg_dump failed.' }
    & docker compose -p $isolatedProject -f $composeFile --env-file $testEnvFile cp "postgres:/tmp/plain.dump" $dbPlain
    if ($LASTEXITCODE -ne 0) { throw 'Failed to copy database dump from container.' }
    & docker compose -p $isolatedProject -f $composeFile --env-file $testEnvFile exec -T postgres rm -f /tmp/plain.dump

    # Encrypt dump with age
    $plainDir = Split-Path -Parent $dbPlain
    $plainLeaf = Split-Path -Leaf $dbPlain
    $dumpDir = Split-Path -Parent $dbDumpFile
    $dumpLeaf = Split-Path -Leaf $dbDumpFile
    & docker run --rm --entrypoint age `
        -v "${plainDir}:/in:ro" `
        -v "${dumpDir}:/out" `
        smartupcms/backup:release-config-test `
        --encrypt --recipient $recipient --output "/out/$dumpLeaf" "/in/$plainLeaf"
    if ($LASTEXITCODE -ne 0) { throw 'Database age encryption failed.' }
    Remove-Item -LiteralPath $dbPlain -Force -ErrorAction SilentlyContinue

    $dbHash = (Get-FileHash -LiteralPath $dbDumpFile -Algorithm SHA256).Hash.ToLowerInvariant()
    "$dbHash  $dumpLeaf" | Set-Content -LiteralPath $dbDumpChecksum -Encoding ascii -NoNewline

    $capturedIso = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
    $manifestJson = [ordered]@{
        schemaVersion = 1
        database = 'smartupcms'
        archiveFile = $dumpLeaf
        archiveSha256 = $dbHash
        capturedAt = $capturedIso
        backupRole = 'postgres'
    } | ConvertTo-Json -Depth 4
    [System.IO.File]::WriteAllText($dbManifestFile, $manifestJson, [System.Text.UTF8Encoding]::new($false))
    $manifestHash = (Get-FileHash -LiteralPath $dbManifestFile -Algorithm SHA256).Hash.ToLowerInvariant()
    "$manifestHash  $([System.IO.Path]::GetFileName($dbManifestFile))" | Set-Content -LiteralPath $dbManifestChecksum -Encoding ascii -NoNewline

    # Capture object backup
    Write-Host '[5/6] Capturing encrypted object backup...' -ForegroundColor Yellow
    & $backupObjectsScript -Provider local_disk -AgeRecipient $recipient -OutputDirectory $backupDir -LocalStoragePath $sourceStorageDir
    if ($LASTEXITCODE -ne 0) { throw 'Object backup failed.' }

    $objectBackupFile = (Get-ChildItem -LiteralPath $backupDir -Filter 'smartupcms-objects-*.tar.age' | Select-Object -First 1).FullName
    if (-not $objectBackupFile) { throw 'Object backup file not found.' }

    # Execute restore drill into clean isolated instance
    Write-Host '[6/6] Executing combined restore drill...' -ForegroundColor Yellow
    # Stop initial container before running restore
    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    & docker compose -p $isolatedProject -f $composeFile --env-file $testEnvFile down --volumes --remove-orphans 2>&1 | Out-Null
    $ErrorActionPreference = $prev

    & $restoreCombinedScript `
        -DatabaseBackupFile $dbDumpFile `
        -ObjectBackupFile $objectBackupFile `
        -AgeIdentityFile $identityFile `
        -IsolatedProjectName $isolatedProject `
        -TargetObjectProvider local_disk `
        -MaxRpoSeconds 3600 `
        -MaxRtoSeconds 600 `
        -ComposeFile $composeFile `
        -EnvFile $testEnvFile `
        -EvidenceDirectory $evidenceDir
    if ($LASTEXITCODE -ne 0) { throw 'Combined restore drill failed.' }

    # Verify evidence output
    $evidenceFiles = @(Get-ChildItem -LiteralPath $evidenceDir -Filter 'combined-restore-*.json')
    if ($evidenceFiles.Count -eq 0) { throw 'Evidence JSON was not generated.' }
    $evidence = Get-Content -LiteralPath $evidenceFiles[0].FullName -Raw | ConvertFrom-Json
    if ($evidence.status -ne 'PASS') { throw "Evidence status is not PASS: $($evidence.status)" }
    if ($evidence.missingObjects -ne 0) { throw "Expected 0 missing objects, found: $($evidence.missingObjects)" }
    if ($evidence.orphanObjects -ne 0) { throw "Expected 0 orphan objects, found: $($evidence.orphanObjects)" }
    if ($evidence.sampleDownloads -lt 2) { throw "Expected at least 2 sample downloads, found: $($evidence.sampleDownloads)" }
    if ($null -eq $evidence.rpoSeconds -or $null -eq $evidence.rtoSeconds) { throw 'RPO or RTO metrics are null.' }

    Write-Host "Positive restore drill verified successfully: RPO=$($evidence.rpoSeconds)s, RTO=$($evidence.rtoSeconds)s." -ForegroundColor Green

    # Negative Test 1: Corrupted checksum must fail closed
    Write-Host 'Running Negative Test 1: Corrupt checksum must fail closed...' -ForegroundColor Yellow
    $corruptChecksumFile = "$dbDumpFile.sha256"
    Set-Content -LiteralPath $corruptChecksumFile -Value '0000000000000000000000000000000000000000000000000000000000000000  fake'
    $corruptFailed = $false
    try {
        & $restoreCombinedScript `
            -DatabaseBackupFile $dbDumpFile `
            -ObjectBackupFile $objectBackupFile `
            -AgeIdentityFile $identityFile `
            -IsolatedProjectName $isolatedProject `
            -TargetObjectProvider local_disk `
            -MaxRpoSeconds 3600 `
            -MaxRtoSeconds 600 `
            -ComposeFile $composeFile `
            -EnvFile $testEnvFile `
            -EvidenceDirectory $evidenceDir 2>$null
    } catch {
        $corruptFailed = $true
    }
    if (-not $corruptFailed) { throw 'Corrupted checksum did not cause restore to fail closed.' }
    Write-Host 'Negative Test 1 passed.' -ForegroundColor Green

    # Restore correct checksum
    "$dbHash  $dumpLeaf" | Set-Content -LiteralPath $dbDumpChecksum -Encoding ascii -NoNewline

    # Negative Test 2: Future timestamp must fail closed
    Write-Host 'Running Negative Test 2: Future timestamp must fail closed...' -ForegroundColor Yellow
    $futureManifest = [ordered]@{
        schemaVersion = 1
        database = 'smartupcms'
        archiveFile = $dumpLeaf
        archiveSha256 = $dbHash
        capturedAt = (Get-Date).ToUniversalTime().AddDays(1).ToString('yyyy-MM-ddTHH:mm:ssZ')
        backupRole = 'postgres'
    } | ConvertTo-Json -Depth 4
    [System.IO.File]::WriteAllText($dbManifestFile, $futureManifest, [System.Text.UTF8Encoding]::new($false))
    $manifestHash = (Get-FileHash -LiteralPath $dbManifestFile -Algorithm SHA256).Hash.ToLowerInvariant()
    "$manifestHash  $([System.IO.Path]::GetFileName($dbManifestFile))" | Set-Content -LiteralPath $dbManifestChecksum -Encoding ascii -NoNewline

    $futureFailed = $false
    try {
        & $restoreCombinedScript `
            -DatabaseBackupFile $dbDumpFile `
            -ObjectBackupFile $objectBackupFile `
            -AgeIdentityFile $identityFile `
            -IsolatedProjectName $isolatedProject `
            -TargetObjectProvider local_disk `
            -MaxRpoSeconds 3600 `
            -MaxRtoSeconds 600 `
            -ComposeFile $composeFile `
            -EnvFile $testEnvFile `
            -EvidenceDirectory $evidenceDir 2>$null
    } catch {
        $futureFailed = $true
    }
    if (-not $futureFailed) { throw 'Future timestamp did not cause restore to fail closed.' }
    Write-Host 'Negative Test 2 passed.' -ForegroundColor Green
}
catch {
    Write-Host "Test encountered error: $_" -ForegroundColor Red
    throw
}
finally {
    Write-Host 'Cleaning up isolated test environment...' -ForegroundColor Yellow
    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    & docker compose -p $isolatedProject -f $composeFile --env-file $testEnvFile down --volumes --remove-orphans 2>&1 | Out-Null
    $ErrorActionPreference = $prev
    Remove-Item -LiteralPath $testRoot -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host '=== All Recovery Drill Tests Passed Successfully! ===' -ForegroundColor Green
