param(
    [switch]$Quick
)

$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$mvnCmd = Join-Path $repoRoot 'mvnw.cmd'
$pomPath = Join-Path $repoRoot 'apps/server/pom.xml'
$migrationFile = Join-Path $repoRoot 'apps/server/src/main/resources/db/migration/V034__task_revision_and_drop_duplicate_indexes.sql'

Write-Host "=== Starting Measured Database / Concurrency Improvements Drill (I-08) ===" -ForegroundColor Cyan

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
    # 1. Migration Verification: V034 exists and contains revision & drop index statements
    Write-Host "`n--> [Validating Flyway V034 Migration File]" -ForegroundColor Yellow
    if (-not (Test-Path $migrationFile)) {
        throw "Migration file not found: $migrationFile"
    }
    $migrationContent = Get-Content $migrationFile -Raw
    if (-not ($migrationContent -match 'drop index if exists idx_ms_tasks_status_id' -and
              $migrationContent -match 'drop index if exists idx_ms_tasks_project_id' -and
              $migrationContent -match 'add column if not exists revision bigint not null default 1')) {
        throw "Migration file $migrationFile does not contain expected DDL statements"
    }
    Write-Host "PASSED (V034 syntax verified)" -ForegroundColor Green

    # 2. Duplicate Index Drop & Auth Coalescing & OCC Integration Suite
    Invoke-MavenTests -TestPattern 'TaskConcurrencyIntegrationTest' `
        -Description 'Contracts P-01, P-02, A-03: Real PostgreSQL 18 OCC, duplicate index drops, and write coalescing'

    # 3. Auth Filter DB Outage Resilience (DataAccessException propagation)
    Invoke-MavenTests -TestPattern 'KauthAuthenticationFilterTest' `
        -Description 'Contract P-01: Auth filter propagates DataAccessException without false 401 logouts'

    if (-not $Quick) {
        # 4. Existing Task Service and Patch Regression Suite
        Invoke-MavenTests -TestPattern 'MsTaskPatchIntegrationTest,MsTaskServiceTest,MsTaskCommentServiceTest' `
            -Description 'Regression check: Task patch, hierarchy, permissions, and comments compatibility'
    }

    Write-Host "`n=== All Measured Database / Concurrency Improvements (I-08) Verified Successfully! ===" -ForegroundColor Green
}
catch {
    Write-Host "`nVerification Drill Failed: $_" -ForegroundColor Red
    exit 1
}
