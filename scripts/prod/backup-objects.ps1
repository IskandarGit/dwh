param(
    [Parameter(Mandatory = $true)][ValidateSet('local_disk', 's3')][string]$Provider,
    [Parameter(Mandatory = $true)][string]$AgeRecipient,
    [string]$OutputDirectory = 'backups',
    [string]$LocalStoragePath,
    [string]$S3Endpoint,
    [string]$S3Bucket,
    [string]$S3Region = 'auto',
    [string]$RecoveryS3Endpoint,
    [string]$RecoveryS3Bucket,
    [string]$RecoveryS3Prefix = 'object-backups'
)

$ErrorActionPreference = 'Stop'

function Require-Command([string]$Name) {
    $command = Get-Command $Name -ErrorAction SilentlyContinue
    if ($null -eq $command) { throw "Required command '$Name' is not installed." }
    return $command.Source
}

function Assert-SafeObjectKey([string]$Key) {
    if ([string]::IsNullOrWhiteSpace($Key) -or $Key -notmatch '^[A-Za-z0-9][A-Za-z0-9._/-]{0,1023}$' -or
        $Key.StartsWith('/') -or $Key.Contains('\') -or $Key.Split('/') -contains '..') {
        throw 'Source storage contains an unsafe object key.'
    }
}

function Invoke-Aws([string[]]$Arguments) {
    $output = & $script:awsPath @Arguments
    if ($LASTEXITCODE -ne 0) { throw 'AWS CLI object-backup operation failed.' }
    return $output
}

if ($AgeRecipient -notmatch '^age1[0-9a-z]{50,}$') { throw 'A valid age recipient is required.' }
$ageCommand = Get-Command 'age' -ErrorAction SilentlyContinue
$script:hasHostAge = $null -ne $ageCommand
$agePath = if ($script:hasHostAge) { $ageCommand.Source } else { $null }
$tarPath = Require-Command 'tar'
$script:awsPath = if ($Provider -eq 's3' -or $RecoveryS3Bucket) { Require-Command 'aws' } else { $null }

function Invoke-AgeEncrypt([string]$Recipient, [string]$InputFile, [string]$OutputFile) {
    if ($script:hasHostAge) {
        & $script:agePath --encrypt --recipient $Recipient --output $OutputFile $InputFile
        if ($LASTEXITCODE -ne 0) { throw 'Object backup age encryption failed.' }
    }
    else {
        $resolvedIn = (Resolve-Path -LiteralPath $InputFile).Path
        $inDir = Split-Path -Parent $resolvedIn
        $inLeaf = Split-Path -Leaf $resolvedIn
        $resolvedOut = [System.IO.Path]::GetFullPath($OutputFile)
        $outDir = Split-Path -Parent $resolvedOut
        $outLeaf = Split-Path -Leaf $resolvedOut
        & docker run --rm --entrypoint age `
            -v "${inDir}:/in:ro" `
            -v "${outDir}:/out" `
            smartupcms/backup:release-config-test `
            --encrypt --recipient $Recipient --output "/out/$outLeaf" "/in/$inLeaf"
        if ($LASTEXITCODE -ne 0) { throw 'Containerized age encryption failed.' }
    }
}

$outputRoot = [System.IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null
$workingRoot = Join-Path ([System.IO.Path]::GetTempPath()) ('smartupcms-object-backup-' + [guid]::NewGuid())
$payloadRoot = Join-Path $workingRoot 'payload'
$objectsRoot = Join-Path $payloadRoot 'objects'
New-Item -ItemType Directory -Path $objectsRoot -Force | Out-Null

$previousAccessKey = $env:AWS_ACCESS_KEY_ID
$previousSecretKey = $env:AWS_SECRET_ACCESS_KEY
$previousRegion = $env:AWS_DEFAULT_REGION
$archivePath = $null
$checksumPath = $null
$partialArchive = $null
$checksumPartial = $null
try {
    $sourceObjects = @()
    if ($Provider -eq 'local_disk') {
        if ([string]::IsNullOrWhiteSpace($LocalStoragePath)) { throw 'LocalStoragePath is required for local_disk.' }
        $sourceRoot = (Resolve-Path -LiteralPath $LocalStoragePath).Path.TrimEnd('\', '/')
        if ($outputRoot.StartsWith($sourceRoot + [System.IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
            throw 'Object backup output must not be inside the source storage tree.'
        }
        $sourceObjects = @(Get-ChildItem -LiteralPath $sourceRoot -File -Recurse | Sort-Object FullName | ForEach-Object {
            [ordered]@{
                key = $_.FullName.Substring($sourceRoot.Length).TrimStart('\', '/').Replace('\', '/')
                size = $_.Length
                sourcePath = $_.FullName
            }
        })
    }
    else {
        if ([string]::IsNullOrWhiteSpace($S3Endpoint) -or [string]::IsNullOrWhiteSpace($S3Bucket)) {
            throw 'S3Endpoint and S3Bucket are required for s3.'
        }
        if ([string]::IsNullOrWhiteSpace($env:AWS_ACCESS_KEY_ID) -or [string]::IsNullOrWhiteSpace($env:AWS_SECRET_ACCESS_KEY)) {
            throw 'AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY are required for the source object store.'
        }
        $env:AWS_DEFAULT_REGION = $S3Region
        $listJson = (Invoke-Aws @('--endpoint-url', $S3Endpoint, 's3api', 'list-objects-v2', '--bucket', $S3Bucket,
                '--query', 'Contents[].{Key:Key,Size:Size}', '--output', 'json', '--no-cli-pager')) -join "`n"
        if ([string]::IsNullOrWhiteSpace($listJson) -or $listJson -eq 'null') { $listJson = '[]' }
        $sourceObjects = @($listJson | ConvertFrom-Json | ForEach-Object {
            [ordered]@{ key = "$($_.Key)"; size = [long]$_.Size; sourcePath = $null }
        })
    }

    $manifestObjects = [System.Collections.Generic.List[object]]::new()
    $seenKeys = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    $index = 0
    foreach ($sourceObject in $sourceObjects) {
        Assert-SafeObjectKey $sourceObject.key
        if (-not $seenKeys.Add($sourceObject.key)) { throw 'Source storage returned a duplicate object key.' }
        $index++
        $archiveRelativePath = 'objects/{0:D8}.bin' -f $index
        $targetPath = Join-Path $payloadRoot $archiveRelativePath
        if ($Provider -eq 'local_disk') {
            Copy-Item -LiteralPath $sourceObject.sourcePath -Destination $targetPath
        }
        else {
            Invoke-Aws @('--endpoint-url', $S3Endpoint, 's3api', 'get-object', '--bucket', $S3Bucket,
                '--key', $sourceObject.key, $targetPath, '--no-cli-pager') | Out-Null
        }
        $actualSize = (Get-Item -LiteralPath $targetPath).Length
        if ($actualSize -ne [long]$sourceObject.size) { throw 'Object size changed while the backup was captured.' }
        $manifestObjects.Add([ordered]@{
            key = $sourceObject.key
            archivePath = $archiveRelativePath
            sizeBytes = $actualSize
            sha256 = (Get-FileHash -LiteralPath $targetPath -Algorithm SHA256).Hash.ToLowerInvariant()
        })
    }

    $capturedAt = (Get-Date).ToUniversalTime()
    $totalBytes = 0L
    foreach ($m in $manifestObjects) { $totalBytes += [long]$m.sizeBytes }
    $manifest = [ordered]@{
        schemaVersion = 1
        capturedAt = $capturedAt.ToString('o')
        provider = $Provider
        sourceBucket = if ($Provider -eq 's3') { $S3Bucket } else { 'local' }
        objectCount = $manifestObjects.Count
        totalBytes = $totalBytes
        objects = $manifestObjects
    }
    [System.IO.File]::WriteAllText((Join-Path $payloadRoot 'manifest.json'), ($manifest | ConvertTo-Json -Depth 6), [System.Text.UTF8Encoding]::new($false))

    $timestamp = $capturedAt.ToString('yyyyMMddTHHmmssZ')
    $tarFile = Join-Path $workingRoot "smartupcms-objects-$timestamp.tar"
    & $tarPath -cf $tarFile -C $payloadRoot manifest.json objects
    if ($LASTEXITCODE -ne 0) { throw 'Object backup tar creation failed.' }

    $archivePath = Join-Path $outputRoot "smartupcms-objects-$timestamp.tar.age"
    $partialArchive = "$archivePath.partial"
    Invoke-AgeEncrypt -Recipient $AgeRecipient -InputFile $tarFile -OutputFile $partialArchive
    Move-Item -LiteralPath $partialArchive -Destination $archivePath
    $checksumPath = "$archivePath.sha256"
    $checksumPartial = "$checksumPath.partial"
    $archiveHash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
    "$archiveHash  $([System.IO.Path]::GetFileName($archivePath))" | Set-Content -LiteralPath $checksumPartial -Encoding ascii -NoNewline
    Move-Item -LiteralPath $checksumPartial -Destination $checksumPath

    if ($RecoveryS3Endpoint -or $RecoveryS3Bucket) {
        if ([string]::IsNullOrWhiteSpace($RecoveryS3Endpoint) -or [string]::IsNullOrWhiteSpace($RecoveryS3Bucket)) {
            throw 'Both RecoveryS3Endpoint and RecoveryS3Bucket are required for off-host object backup.'
        }
        if ([string]::IsNullOrWhiteSpace($env:RECOVERY_AWS_ACCESS_KEY_ID) -or
            [string]::IsNullOrWhiteSpace($env:RECOVERY_AWS_SECRET_ACCESS_KEY)) {
            throw 'RECOVERY_AWS_ACCESS_KEY_ID and RECOVERY_AWS_SECRET_ACCESS_KEY are required.'
        }
        $env:AWS_ACCESS_KEY_ID = $env:RECOVERY_AWS_ACCESS_KEY_ID
        $env:AWS_SECRET_ACCESS_KEY = $env:RECOVERY_AWS_SECRET_ACCESS_KEY
        $env:AWS_DEFAULT_REGION = 'auto'
        $prefix = $RecoveryS3Prefix.Trim('/')
        if (-not $prefix -or $prefix.Split('/') -contains '..') { throw 'RecoveryS3Prefix is unsafe.' }
        Invoke-Aws @('--endpoint-url', $RecoveryS3Endpoint, 's3', 'cp', $archivePath,
            "s3://$RecoveryS3Bucket/$prefix/$([System.IO.Path]::GetFileName($archivePath))", '--only-show-errors') | Out-Null
        Invoke-Aws @('--endpoint-url', $RecoveryS3Endpoint, 's3', 'cp', $checksumPath,
            "s3://$RecoveryS3Bucket/$prefix/$([System.IO.Path]::GetFileName($checksumPath))", '--only-show-errors') | Out-Null
    }

    Write-Host "Encrypted object backup completed: $archivePath" -ForegroundColor Green
    Write-Host "Objects: $($manifestObjects.Count); bytes: $($manifest.totalBytes)."
}
catch {
    if ($archivePath) { Remove-Item -LiteralPath $archivePath -Force -ErrorAction SilentlyContinue }
    if ($checksumPath) { Remove-Item -LiteralPath $checksumPath -Force -ErrorAction SilentlyContinue }
    if ($partialArchive) { Remove-Item -LiteralPath $partialArchive -Force -ErrorAction SilentlyContinue }
    if ($checksumPartial) { Remove-Item -LiteralPath $checksumPartial -Force -ErrorAction SilentlyContinue }
    throw
}
finally {
    Remove-Item -LiteralPath $workingRoot -Recurse -Force -ErrorAction SilentlyContinue
    $env:AWS_ACCESS_KEY_ID = $previousAccessKey
    $env:AWS_SECRET_ACCESS_KEY = $previousSecretKey
    $env:AWS_DEFAULT_REGION = $previousRegion
}
