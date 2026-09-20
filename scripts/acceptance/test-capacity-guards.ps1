param(
    [switch]$Quick
)

$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$mvnCmd = Join-Path $repoRoot 'mvnw.cmd'
$pomPath = Join-Path $repoRoot 'apps/server/pom.xml'
$appYmlPath = Join-Path $repoRoot 'apps/server/src/main/resources/application.yml'
$releaseConfigScript = Join-Path $repoRoot 'scripts/prod/test-release-config.ps1'

Write-Host "=== Starting Capacity & Operations Evidence Drill (I-09) ===" -ForegroundColor Cyan

function Invoke-MavenTests {
    param(
        [string]$TestPattern,
        [string]$Description
    )

    Write-Host "`n--> [$Description]" -ForegroundColor Yellow
    $startTime = [System.Diagnostics.Stopwatch]::StartNew()

    $cmd = "& `"$mvnCmd`" test -f `"$pomPath`" -B -q `"-Dtest=$TestPattern`" `"-Dsurefire.failIfNoSpecifiedTests=false`""
    
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $output = Invoke-Expression $cmd 2>&1
    $exitCode = $LASTEXITCODE
    $ErrorActionPreference = $prevEap

    $startTime.Stop()

    if ($exitCode -ne 0) {
        Write-Host "FAILED in $($startTime.Elapsed.TotalSeconds.ToString('F1'))s" -ForegroundColor Red
        $output | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkRed }
        throw "Test verification failed for: $Description"
    } else {
        Write-Host "PASSED in $($startTime.Elapsed.TotalSeconds.ToString('F1'))s" -ForegroundColor Green
    }
}

try {
    # 1. Config Verification: application.yml contains fetch size, upload concurrency, and export max rows
    Write-Host "`n--> [Validating application.yml Capacity Settings]" -ForegroundColor Yellow
    if (-not (Test-Path $appYmlPath)) {
        throw "application.yml not found: $appYmlPath"
    }
    $appYml = Get-Content $appYmlPath -Raw
    if (-not ($appYml -match 'defaultRowFetchSize:\s*500' -and
              $appYml -match 'max-concurrent-uploads' -and
              $appYml -match 'max-rows')) {
        throw "application.yml does not contain expected capacity parameters (fetchSize, max-concurrent-uploads, max-rows)"
    }
    Write-Host "PASSED (application.yml capacity settings verified)" -ForegroundColor Green

    # 2. Release & Docker Resource Configuration (D-04: CPU/RAM bounds & tmpfs)
    Write-Host "`n--> [Running Release Configuration & Resource Limits Verifier]" -ForegroundColor Yellow
    & $releaseConfigScript
    if ($LASTEXITCODE -ne 0) {
        throw "Release configuration verifier failed"
    }
    Write-Host "PASSED (Container resource limits & tmpfs bounded)" -ForegroundColor Green

    # 3. Capacity Guards Integration Test (P-03, P-04 in real Postgres 18)
    Invoke-MavenTests -TestPattern 'CapacityGuardsIntegrationTest' `
        -Description 'Contracts P-03, P-04: Real PostgreSQL 18 export bounds, disconnect handling, upload rate limit, audit cache'

    if (-not $Quick) {
        # 4. Report Export Integration Suite
        Invoke-MavenTests -TestPattern 'ReportExportIntegrationTest' `
            -Description 'Regression check: Report CSV export correctness, filters, and streaming'

        # 5. Audit Log & File Service Unit Test Suite
        Invoke-MavenTests -TestPattern 'AuditLogServiceTest,MfFileServiceTest,MfFileTransactionBoundaryTest' `
            -Description 'Unit checks: Audit stats caching and file upload transaction boundaries'
    }

    Write-Host "`n=== All Capacity & Operations Evidence (I-09) Verified Successfully! ===" -ForegroundColor Green
}
catch {
    Write-Host "`nCapacity Verification Drill Failed: $_" -ForegroundColor Red
    exit 1
}
