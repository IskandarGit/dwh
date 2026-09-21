param(
    [switch]$Quick
)

$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$mvnCmd = Join-Path $repoRoot 'mvnw.cmd'
$pomPath = Join-Path $repoRoot 'apps/server/pom.xml'

Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host " Running Master Final Release Readiness Quality Gates Drill (I-10)" -ForegroundColor Cyan
Write-Host "=================================================================" -ForegroundColor Cyan

function Run-Step {
    param(
        [string]$Name,
        [scriptblock]$Action
    )

    Write-Host "`n--> [$Name]" -ForegroundColor Yellow
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        & $Action
        $sw.Stop()
        Write-Host "PASSED in $($sw.Elapsed.TotalSeconds.ToString('F1'))s" -ForegroundColor Green
    }
    catch {
        $sw.Stop()
        Write-Host "FAILED in $($sw.Elapsed.TotalSeconds.ToString('F1'))s: $_" -ForegroundColor Red
        throw $_
    }
}

try {
    # 1. Documentation Contract
    Run-Step "Public Documentation & Tracked Links Contract" {
        & (Join-Path $repoRoot 'scripts/docs/test-public-docs.ps1')
    }

    # 2. Repository Hygiene Contract
    Run-Step "Repository Hygiene & Cleanliness Contract" {
        & (Join-Path $repoRoot 'scripts/docs/test-repository-hygiene.ps1')
    }

    # 3. Production Compose Resource Limits & Config Verification
    Run-Step "Production Resource Limits & Release Configuration (D-04)" {
        & (Join-Path $repoRoot 'scripts/prod/test-release-config.ps1')
    }

    # 4. Git History Secret Scanning Contract
    Run-Step "Git History Secret Scanning (Gitleaks Zero-Finding Contract)" {
        & (Join-Path $repoRoot 'scripts/security/test-secret-scan.ps1')
    }

    # 5. Release Supply Chain Verification Contract
    Run-Step "Release Supply Chain Verification (Provenance & Signatures Gate)" {
        & (Join-Path $repoRoot 'scripts/release/verify-release.ps1')
    }

    # 6. OpenAPI Specification & Branding Contract (M17)
    Run-Step "OpenAPI 3.1.0 Contract & Core Route Catalog" {
        $cmd = "& `"$mvnCmd`" test -f `"$pomPath`" -B -q `"-Dtest=OpenApiControllerTest`""
        $output = Invoke-Expression $cmd 2>&1
        if ($LASTEXITCODE -ne 0) {
            $output | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkRed }
            throw "OpenApiControllerTest failed"
        }
    }

    # 7. Search Reliability & Transactional Outbox (I-07)
    Run-Step "Search Reliability & Outbox Synchronization Drill (I-07)" {
        $script = Join-Path $repoRoot 'scripts/search/test-search-reliability.ps1'
        if ($Quick) { & $script -Quick } else { & $script }
    }

    # 8. Database Concurrency, Duplicate Indexes & OCC (I-08)
    Run-Step "Database Concurrency, OCC & Index Cleanup Drill (I-08)" {
        $script = Join-Path $repoRoot 'scripts/db/test-db-concurrency.ps1'
        if ($Quick) { & $script -Quick } else { & $script }
    }

    # 9. Capacity Guards & Operations Evidence (I-09)
    Run-Step "Capacity Guards, Upload Limiter & Export Bounds Drill (I-09)" {
        $script = Join-Path $repoRoot 'scripts/acceptance/test-capacity-guards.ps1'
        if ($Quick) { & $script -Quick } else { & $script }
    }

    Write-Host "`n=================================================================" -ForegroundColor Green
    Write-Host " ALL RELEASE HARDENING GATES (I-01..I-10) VERIFIED SUCCESSFULLY! " -ForegroundColor Green
    Write-Host "=================================================================" -ForegroundColor Green
}
catch {
    Write-Host "`nFinal Release Readiness Verification Drill Failed: $_" -ForegroundColor Red
    exit 1
}
