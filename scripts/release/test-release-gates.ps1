param()

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path

Write-Host "====================================================" -ForegroundColor Cyan
Write-Host " Running Package 6 (I-06) Release Artifact Gates Drill" -ForegroundColor Cyan
Write-Host "====================================================" -ForegroundColor Cyan

# Test 1: Verify release supply chain contract
Write-Host "`n[Test 1] Verifying release supply-chain contract..." -ForegroundColor Yellow
try {
    & (Join-Path $PSScriptRoot 'verify-release.ps1')
}
catch {
    throw "Test 1 failed: verify-release.ps1 failed: $_"
}
Write-Host "PASS: Supply-chain contract verified." -ForegroundColor Green

# Test 2: Verify full-history secret scanning
Write-Host "`n[Test 2] Verifying full Git history secret scan..." -ForegroundColor Yellow
try {
    & (Join-Path $repoRoot 'scripts/security/test-secret-scan.ps1')
}
catch {
    throw "Test 2 failed: test-secret-scan.ps1 failed: $_"
}
Write-Host "PASS: Secret scanner verified (0 leaks across Git history)." -ForegroundColor Green

function Invoke-PowerShellCapture([string]$Command) {
    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $out = (& powershell -NoProfile -ExecutionPolicy Bypass -Command $Command 2>&1) -join "`n"
        return [PSCustomObject]@{ ExitCode = $LASTEXITCODE; Output = $out }
    }
    finally {
        $ErrorActionPreference = $prev
    }
}

# Test 3: Negative drill - tampered workflow missing Trivy scanner
Write-Host "`n[Test 3] Negative drill: tampered release workflow fails contract..." -ForegroundColor Yellow
$tempDir = Join-Path ([System.IO.Path]::GetTempPath()) ("smartupcms-gate-drill-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tempDir -Force | Out-Null
try {
    $validWorkflow = Get-Content -LiteralPath (Join-Path $repoRoot '.github/workflows/release.yml') -Raw
    $tamperedWorkflow = $validWorkflow.Replace('scan-type: image', 'scan-type: none')
    $tamperedFile = Join-Path $tempDir 'tampered-release.yml'
    [System.IO.File]::WriteAllText($tamperedFile, $tamperedWorkflow, [System.Text.UTF8Encoding]::new($false))

    $failedClosed = $false
    $verifyPath = (Join-Path $PSScriptRoot 'verify-release.ps1')
    $res3 = Invoke-PowerShellCapture "& '$verifyPath' -WorkflowPath '$tamperedFile'"
    if ($res3.ExitCode -ne 0 -or $res3.Output -match 'must scan published image digests with Trivy') {
        $failedClosed = $true
        Write-Host "Expected failure caught: $($res3.Output)" -ForegroundColor DarkGray
    }
    if (-not $failedClosed) {
        throw "Test 3 failed: verify-release.ps1 did NOT fail closed on workflow missing Trivy image scanner!"
    }
    Write-Host "PASS: Missing vulnerability scan fails closed." -ForegroundColor Green

    # Test 4: Negative drill - target deploy with tampered checksum
    Write-Host "`n[Test 4] Negative drill: deploy fails closed on tampered release checksum..." -ForegroundColor Yellow
    $mockReleaseDir = Join-Path $tempDir 'mock-release'
    New-Item -ItemType Directory -Path $mockReleaseDir -Force | Out-Null
    $fakeFile = Join-Path $mockReleaseDir 'test-artifact.txt'
    Set-Content -LiteralPath $fakeFile -Value 'hello world'
    $corruptSha = '0000000000000000000000000000000000000000000000000000000000000000  test-artifact.txt'
    Set-Content -LiteralPath (Join-Path $mockReleaseDir 'SHA256SUMS') -Value $corruptSha

    $deployFailed = $false
    $deployPath = (Join-Path $repoRoot 'scripts/prod/deploy.ps1')
    $envFilePath = (Join-Path $repoRoot 'scripts/prod/release-config.test.env')
    $res4 = Invoke-PowerShellCapture "& '$deployPath' -VerifyRelease -ReleaseDirectory '$mockReleaseDir' -EnvFile '$envFilePath'"
    if ($res4.ExitCode -ne 0 -and $res4.Output -match 'checksum mismatch') {
        $deployFailed = $true
        Write-Host "Expected deploy failure caught: $($res4.Output)" -ForegroundColor DarkGray
    }
    if (-not $deployFailed) {
        throw "Test 4 failed: deploy.ps1 did NOT fail closed on tampered release checksum!"
    }
    Write-Host "PASS: Tampered checksum in deploy fails closed." -ForegroundColor Green

    # Test 5: Negative drill - target deploy with unapproved image in IMAGES.txt
    Write-Host "`n[Test 5] Negative drill: deploy fails closed on unapproved image..." -ForegroundColor Yellow
    $validSha = (Get-FileHash -LiteralPath $fakeFile -Algorithm SHA256).Hash.ToLowerInvariant() + '  test-artifact.txt'
    Set-Content -LiteralPath (Join-Path $mockReleaseDir 'SHA256SUMS') -Value $validSha
    Set-Content -LiteralPath (Join-Path $mockReleaseDir 'IMAGES.txt') -Value "ghcr.io/smartupcms/server@sha256:1111111111111111111111111111111111111111111111111111111111111111"

    $deployImageFailed = $false
    $res5 = Invoke-PowerShellCapture "& '$deployPath' -VerifyRelease -ReleaseDirectory '$mockReleaseDir' -EnvFile '$envFilePath'"
    if ($res5.ExitCode -ne 0 -and $res5.Output -match 'not in approved release') {
        $deployImageFailed = $true
        Write-Host "Expected image verification failure caught: $($res5.Output)" -ForegroundColor DarkGray
    }
    if (-not $deployImageFailed) {
        throw "Test 5 failed: deploy.ps1 did NOT fail closed on unapproved image digest!"
    }
    Write-Host "PASS: Unapproved image in deploy fails closed." -ForegroundColor Green
}
finally {
    if (Test-Path -LiteralPath $tempDir) {
        Remove-Item -LiteralPath $tempDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}

Write-Host "`nAll Package 6 (I-06) Release Artifact Gates drills PASSED." -ForegroundColor Green
