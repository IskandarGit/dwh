$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$requiredFiles = @(
    'README.md',
    'LICENSE',
    'NOTICE',
    'RELICENSE.md',
    'CONTRIBUTING.md',
    'CODE_OF_CONDUCT.md',
    'DCO',
    'SECURITY.md',
    'GOVERNANCE.md',
    'SUPPORT.md',
    'CHANGELOG.md',
    'docs/README.md',
    'docs/ai-context.md',
    'docs/technical-specification.md',
    'docs/adr/ADR-0014-unified-open-source-runtime.md',
    '.github/pull_request_template.md',
    '.github/ISSUE_TEMPLATE/bug_report.yml',
    '.github/ISSUE_TEMPLATE/feature_request.yml',
    '.github/workflows/dco.yml'
)

$errors = [System.Collections.Generic.List[string]]::new()

foreach ($relativePath in $requiredFiles) {
    if (-not (Test-Path -LiteralPath (Join-Path $repoRoot $relativePath))) {
        $errors.Add("Missing public project file: $relativePath")
    }
}

$activeDocs = @(
    'README.md',
    'CONTRIBUTING.md',
    'docs/README.md',
    'docs/ai-context.md',
    'docs/technical-specification.md',
    'docs/onboarding.md',
    'docs/architecture/biruni-smartup-conventions.md',
    'docs/architecture/monorepo-structure.md',
    'docs/guidelines/database-migrations.md',
    'docs/guidelines/module-development-guide.md',
    'docs/guidelines/testing-strategy.md',
    'docs/security/threat-model.md',
    'docs/ops/architecture-overview.md',
    'docs/ops/deployment-guide.md',
    'docs/ops/maintenance-guide.md',
    'docs/ops/operations-runbook.md',
    'docs/ops/production-launch-checklist.md',
    'docs/ops/rollback.md',
    'docs/runbooks/RB-04-migration-failure-triage.md'
)

$currentAndPartiallyCurrentAdrs = @(
    'docs/adr/ADR-0001-architecture-model.md',
    'docs/adr/ADR-0002-backend-stack.md',
    'docs/adr/ADR-0003-tenancy-rbac.md',
    'docs/adr/ADR-0005-ai-ml-readiness.md',
    'docs/adr/ADR-0006-modular-monolith.md',
    'docs/adr/ADR-0008-security-baseline.md',
    'docs/adr/ADR-0009-observability.md',
    'docs/adr/ADR-0010-resilience-tiers.md',
    'docs/adr/ADR-0011-provider-spi.md',
    'docs/adr/ADR-0012-ui-foundation.md',
    'docs/adr/ADR-0013-data-scope.md',
    'docs/adr/ADR-0014-unified-open-source-runtime.md'
)

$retiredTerms = '(?i)apps/(?:instance|control-plane|web-instance|web-cp)|docker-compose\.fleet|migrate-cp|DWH_CP_|(?:TRD|TZ|ТЗ|ТРД)-[0-9]+'
$retiredIdentifierCompatibility = @{
    'docs/adr/ADR-0005-ai-ml-readiness.md' = @{
        Terms = @('ТЗ-01', 'ТЗ-02')
        Markers = @('Совместимость идентификаторов', 'FR-AUTH-03', 'FR-AUTH-04', 'FR-IAM-05', 'FR-WORK-04', 'FR-ADMIN-02')
    }
    'docs/adr/ADR-0012-ui-foundation.md' = @{
        Terms = @('ТЗ-02')
        Markers = @('Совместимость идентификаторов', 'AC-02', 'AC-06')
    }
}

$retiredTermDocs = @($activeDocs + $currentAndPartiallyCurrentAdrs) | Sort-Object -Unique
foreach ($relativePath in $retiredTermDocs) {
    $absolutePath = Join-Path $repoRoot $relativePath
    if (-not (Test-Path -LiteralPath $absolutePath)) {
        $errors.Add("Missing active document: $relativePath")
        continue
    }

    $content = Get-Content -LiteralPath $absolutePath -Raw -Encoding UTF8
    $compatibility = $retiredIdentifierCompatibility[$relativePath]
    $hasCompatibilityNote = $null -ne $compatibility -and
        @($compatibility.Markers | Where-Object { -not $content.Contains($_) }).Count -eq 0

    foreach ($match in [regex]::Matches($content, $retiredTerms)) {
        $isDocumentedHistoricalIdentifier = $hasCompatibilityNote -and
            $compatibility.Terms -contains $match.Value
        if (-not $isDocumentedHistoricalIdentifier) {
            $errors.Add("Retired platform terminology '$($match.Value)' remains in active document: $relativePath")
        }
    }
}

$supersededAdrs = @(
    'docs/adr/ADR-0004-deployment-model.md',
    'docs/adr/ADR-0007-fleet-strategy.md'
)
foreach ($relativePath in $supersededAdrs) {
    $content = Get-Content -LiteralPath (Join-Path $repoRoot $relativePath) -Raw -Encoding UTF8
    if ($content -notmatch 'Заменено ADR-0014') {
        $errors.Add("Historical ADR is not explicitly superseded: $relativePath")
    }
}

$partiallySupersededAdrs = @(
    'docs/adr/ADR-0001-architecture-model.md',
    'docs/adr/ADR-0003-tenancy-rbac.md',
    'docs/adr/ADR-0006-modular-monolith.md',
    'docs/adr/ADR-0008-security-baseline.md',
    'docs/adr/ADR-0009-observability.md',
    'docs/adr/ADR-0010-resilience-tiers.md',
    'docs/adr/ADR-0011-provider-spi.md'
)
foreach ($relativePath in $partiallySupersededAdrs) {
    $content = Get-Content -LiteralPath (Join-Path $repoRoot $relativePath) -Raw -Encoding UTF8
    if ($content -notmatch 'Частично заменено ADR-0014|Частично заменён ADR-0014') {
        $errors.Add("Historical ADR is not explicitly partially superseded: $relativePath")
    }
}

Push-Location $repoRoot
try {
    $trackedFiles = @(git ls-files --cached)
    if ($LASTEXITCODE -ne 0) {
        throw 'git ls-files failed'
    }
}
finally {
    Pop-Location
}

$trackedFileSet = [System.Collections.Generic.HashSet[string]]::new(
    [System.StringComparer]::Ordinal
)
foreach ($relativePath in $trackedFiles) {
    [void]$trackedFileSet.Add($relativePath.Replace('\', '/'))
}

$markdownFiles = @($trackedFiles | Where-Object { $_ -match '(?i)\.md$' }) |
    Sort-Object -Unique

foreach ($relativePath in $markdownFiles) {
    $absolutePath = Join-Path $repoRoot $relativePath
    if (-not (Test-Path -LiteralPath $absolutePath)) {
        $errors.Add("Tracked Markdown file is missing from the working tree: $relativePath")
        continue
    }

    $content = Get-Content -LiteralPath $absolutePath -Raw -Encoding UTF8
    foreach ($match in [regex]::Matches($content, '!?\[[^\]]*\]\(([^)]+)\)')) {
        $target = $match.Groups[1].Value.Trim()
        if ($target -match '(?i)^(?:[a-z][a-z0-9+.-]*:|//|#)') {
            continue
        }

        $pathOnly = (($target -split '#', 2)[0] -split '\?', 2)[0].Trim('<', '>')
        if ([string]::IsNullOrWhiteSpace($pathOnly)) {
            continue
        }

        try {
            $decodedPath = [System.Uri]::UnescapeDataString($pathOnly)
            $resolved = [System.IO.Path]::GetFullPath(
                (Join-Path (Split-Path $absolutePath -Parent) $decodedPath)
            )
            if ($null -ne [System.IO.Path].GetMethod('GetRelativePath', [type[]]@([string], [string]))) {
                $trackedTarget = [System.IO.Path]::GetRelativePath($repoRoot, $resolved).Replace('\', '/')
            } else {
                $repoUri = [System.Uri]($repoRoot.TrimEnd('\', '/') + '/')
                $targetUri = [System.Uri]$resolved
                $trackedTarget = [System.Uri]::UnescapeDataString($repoUri.MakeRelativeUri($targetUri).ToString()).Replace('\', '/')
            }
        }
        catch {
            $errors.Add("Invalid relative link in ${relativePath}: $target ($($_.Exception.Message))")
            continue
        }

        if ($trackedTarget -eq '..' -or
            $trackedTarget.StartsWith('../', [System.StringComparison]::Ordinal) -or
            [System.IO.Path]::IsPathRooted($trackedTarget) -or
            -not $trackedFileSet.Contains($trackedTarget)) {
            $errors.Add("Relative link target is not Git-tracked in ${relativePath}: $target")
        }
    }
}

if ($errors.Count -gt 0) {
    $errors | ForEach-Object { Write-Error $_ -ErrorAction Continue }
    exit 1
}

Write-Host "Public documentation contract passed ($($requiredFiles.Count) required files, $($markdownFiles.Count) Markdown files)."
