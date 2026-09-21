param(
    [switch]$Quick
)

$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$mvnCmd = Join-Path $repoRoot 'mvnw.cmd'
$pomPath = Join-Path $repoRoot 'apps/server/pom.xml'

Write-Host "=== Starting Search Reliability Verification Drill (I-07) ===" -ForegroundColor Cyan

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
    # 1. Architectural Boundary Verification: External modules cannot touch TypesenseClient directly
    Invoke-MavenTests -TestPattern 'ModularArchitectureTest#externalModulesShouldNotDependOnTypesenseClientDirectly' `
        -Description 'Verifying Architectural Boundary: TypesenseClient isolation'

    # 2. Contract 1: Transactional Mutation Safety (No index before commit, rollback atomicity)
    Invoke-MavenTests -TestPattern 'SearchRevisionIntegrationTest,SearchDeliveryIntegrationTest#workerCannotSeeTaskCreatedInsideHeldBusinessTransaction' `
        -Description 'Contract 1: Transactional mutation isolation (No indexing before commit, rollback cleans up revision)'

    # 3. Contract 2: Durable Bounded Retry (Exponential backoff, jitter, attempt bound)
    Invoke-MavenTests -TestPattern 'SearchDeliveryIntegrationTest#eighthFailureIsTerminalForThatRevisionAndNewRevisionResetsFailures,SearchDeliveryIntegrationTest#nextCycleReleasesOnlyItsOwnClaimLeftAfterDatabaseCheckpointFailure' `
        -Description 'Contract 2: Durable bounded retry (Exponential backoff, 8-attempt bound, checkpoint release)'

    # 4. Contract 3: Non-blocking Startup & Outage Recovery
    Invoke-MavenTests -TestPattern 'SearchBootstrapIntegrationTest#startupOutageRecoversAndMissingCollectionsUseOneGeneratedInitialGeneration,SearchBootstrapIntegrationTest#backgroundNetworkStartsOnlyAfterCommittedBootstrapAndDoesNotBlockApplicationRunner' `
        -Description 'Contract 3: Startup resilience (ApplicationRunner never blocked, catch-up after Typesense recovery)'

    if (-not $Quick) {
        # 5. Reconciliation & Index Convergence (Rebuild catchup, Rollback safety, Memory-bounded stream)
        Invoke-MavenTests -TestPattern 'SearchReconciliationTest,SearchRebuildIntegrationTest,SearchRollbackIntegrationTest' `
            -Description 'Reconciliation convergence: Bounded memory streaming, rebuild catchup, rollback safety'
    }

    Write-Host "`n=== All Search Reliability Contracts Verified Successfully (I-07 PASS) ===" -ForegroundColor Green
}
catch {
    Write-Host "`n=== Search Reliability Verification FAILED ===" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}
