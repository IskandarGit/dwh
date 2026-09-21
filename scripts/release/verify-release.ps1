param(
    [string]$WorkflowPath = '.github/workflows/release.yml'
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$errors = [System.Collections.Generic.List[string]]::new()

function Add-ContractError([string]$Message) {
    $errors.Add($Message)
}

function Assert-Matches([string]$Text, [string]$Pattern, [string]$Message) {
    if ($Text -notmatch $Pattern) { Add-ContractError $Message }
}

function Assert-DoesNotMatch([string]$Text, [string]$Pattern, [string]$Message) {
    if ($Text -match $Pattern) { Add-ContractError $Message }
}

$stableSemVerPattern = '^v(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$'
foreach ($validRef in @('v0.1.0', 'v1.0.0', 'v12.34.56')) {
    if ($validRef -notmatch $stableSemVerPattern) {
        Add-ContractError "Stable SemVer validator rejected '$validRef'."
    }
}
foreach ($invalidRef in @('main', 'refs/tags/v1.2.3', 'v1.2', 'v01.2.3', 'v1.02.3', 'v1.2.03', 'v1.2.3-rc.1', 'v1.2.3+build')) {
    if ($invalidRef -match $stableSemVerPattern) {
        Add-ContractError "Stable SemVer validator accepted '$invalidRef'."
    }
}

$absoluteWorkflowPath = if ([System.IO.Path]::IsPathRooted($WorkflowPath)) {
    $WorkflowPath
} else {
    Join-Path $repoRoot $WorkflowPath
}
if (-not (Test-Path -LiteralPath $absoluteWorkflowPath -PathType Leaf)) {
    Add-ContractError "Missing release workflow: $WorkflowPath"
    $workflow = ''
}
else {
    $workflow = Get-Content -LiteralPath $absoluteWorkflowPath -Raw
}

Assert-Matches $workflow '(?ms)^on:\s*\r?\n\s+push:\s*\r?\n\s+tags:' 'Release workflow must be triggered by tag pushes.'
Assert-DoesNotMatch $workflow '(?m)^\s*(pull_request|pull_request_target|workflow_dispatch|schedule)\s*:' 'Release workflow must not run for pull requests, manual dispatch, or schedules.'
Assert-Matches $workflow '(?m)^permissions:\s*\{\}\s*$' 'Release workflow must deny token permissions by default.'
Assert-DoesNotMatch $workflow '\$\{\{\s*secrets\.' 'Release workflow must not depend on repository release secrets.'
Assert-Matches $workflow 'git merge-base --is-ancestor' 'Release commit must be verified as reachable from the default branch.'
Assert-Matches $workflow 'stableSemVer|stable_semver|STABLE_SEMVER' 'Workflow must contain an anchored stable SemVer gate.'
Assert-Matches $workflow '(?m)^concurrency:' 'Release workflow must serialize a release tag.'

$usesMatches = [regex]::Matches($workflow, '(?m)^\s*-?\s*uses:\s*([^\s#]+)')
$node24ActionPins = @{
    'actions/checkout'          = 'd23441a48e516b6c34aea4fa41551a30e30af803'
    'actions/setup-node'        = '249970729cb0ef3589644e2896645e5dc5ba9c38'
    'actions/setup-java'        = '03ad4de0992f5dab5e18fcb136590ce7c4a0ac95'
    'actions/upload-artifact'   = 'b7c566a772e6b6bfb58ed0dc250532a479d7789f'
    'actions/download-artifact' = '37930b1c2abaa49bbe596cd826c3c89aef350131'
}
foreach ($workflowFile in Get-ChildItem -LiteralPath (Join-Path $repoRoot '.github/workflows') -Filter '*.yml') {
    $candidateWorkflow = Get-Content -LiteralPath $workflowFile.FullName -Raw
    foreach ($usesMatch in [regex]::Matches($candidateWorkflow, '(?m)^\s*-?\s*uses:\s*([^\s#]+)')) {
        $reference = $usesMatch.Groups[1].Value
        if ($reference.StartsWith('./')) { continue }
        if ($reference -notmatch '@[0-9a-f]{40}$') {
            Add-ContractError "External action is not pinned to a full commit SHA in $($workflowFile.Name): $reference"
        }
        $referenceParts = $reference -split '@', 2
        if ($referenceParts.Count -eq 2 -and $node24ActionPins.ContainsKey($referenceParts[0]) -and
            $referenceParts[1] -ne $node24ActionPins[$referenceParts[0]]) {
            Add-ContractError "Official action is not pinned to the approved Node 24 release in $($workflowFile.Name): $reference"
        }
    }
}

if ($workflow -and $usesMatches.Count -eq 0) {
    Add-ContractError 'Release workflow does not contain pinned actions.'
}

foreach ($image in @('server', 'web', 'backup', 'postgres', 'typesense')) {
    Assert-Matches $workflow "(?m)^\s*-?\s*image:\s*$image\s*$" "Release matrix is missing image '$image'."
    Assert-Matches $workflow ([regex]::Escape("smartupcms/$image")) "Release workflow is missing the versioned '$image' image reference."
}

Assert-Matches $workflow 'linux/amd64,linux/arm64' 'Release images must target linux/amd64 and linux/arm64.'
Assert-Matches $workflow '(?m)^\s*push:\s*true\s*$' 'Release build must push immutable image manifests.'
Assert-Matches $workflow '(?i)scan-type:\s*image' 'Release workflow must scan published image digests with Trivy.'
Assert-Matches $workflow 'aquasecurity/trivy-action@a9c7b0f06e461e9d4b4d1711f154ee024b8d7ab8' 'Release workflow must use pinned Trivy action.'
Assert-Matches $workflow 'test-secret-scan\.ps1' 'Release workflow verify job must include secret scanning.'
Assert-Matches $workflow 'rollback\.ps1' 'Release bundle must contain rollback automation.'
Assert-Matches $workflow 'test-recovery\.ps1' 'Release bundle must contain recovery drill test.'
Assert-Matches (Get-Content -LiteralPath (Join-Path $repoRoot 'scripts/security/scan-runtime-images.ps1') -Raw) 'clamav' 'Runtime image scanner must include ClamAV.'
Assert-Matches $workflow 'attest-build-provenance' 'Release workflow must emit GitHub build provenance attestations.'
Assert-Matches $workflow 'cosign sign --yes' 'Release workflow must create keyless Cosign signatures.'
Assert-Matches $workflow '@\$\{[^\r\n]+digest' 'Cosign and attestations must address images by digest.'
Assert-Matches $workflow '(?i)syft.+cyclonedx|cyclonedx.+syft' 'Release workflow must generate CycloneDX SBOM files.'
Assert-Matches $workflow '(?i)spdx' 'Release workflow must generate SPDX SBOM files.'
Assert-Matches $workflow 'sha256sum' 'Release workflow must generate release checksums.'
Assert-Matches $workflow 'docker-compose\.prod\.yml' 'Release bundle must contain production Compose.'
Assert-Matches $workflow 'deploy/compose/\.env\.example' 'Release bundle must contain the production environment template.'
Assert-Matches $workflow 'invoke-managed-preflight\.ps1' 'Release bundle must contain the managed target preflight.'
Assert-Matches $workflow 'invoke-managed-host-check\.ps1' 'Release bundle must contain the managed target host check.'
Assert-Matches $workflow 'restore-combined\.ps1' 'Release bundle must contain combined database/object recovery.'
Assert-Matches $workflow 'verify-published-release\.ps1' 'Release bundle must contain independent target-side release verification.'
Assert-Matches $workflow 'test-release-gates\.ps1' 'Release bundle must contain release gates drill.'
Assert-Matches $workflow '\.env\.managed\.example' 'Release bundle must contain the non-secret managed acceptance template.'
Assert-Matches $workflow 'dist/\$\{bundle\}/scripts/prod' 'Release bundle must preserve the scripts/prod layout used by runbooks and cross-script calls.'
Assert-Matches $workflow 'cp -R docs ' 'Release bundle must include the documentation tree referenced by its README.'
Assert-Matches $workflow 'CODE_OF_CONDUCT\.md' 'Release bundle must include the root governance documents referenced by its README.'
Assert-Matches $workflow 'gh release create' 'Release workflow must publish a GitHub Release.'
Assert-Matches $workflow '(?ms)permissions:\s*\r?\n(?:\s+[^\r\n]+\r?\n)*?\s+id-token:\s*write' 'Only a release job may explicitly receive OIDC permission.'
Assert-Matches $workflow '(?ms)permissions:\s*\r?\n(?:\s+[^\r\n]+\r?\n)*?\s+packages:\s*write' 'Image publishing job requires packages: write.'
Assert-Matches $workflow '(?ms)permissions:\s*\r?\n(?:\s+[^\r\n]+\r?\n)*?\s+attestations:\s*write' 'Provenance publishing job requires attestations: write.'

$dockerfiles = @(
    'Dockerfile',
    'apps/web/Dockerfile',
    'deploy/images/backup/Dockerfile',
    'deploy/images/postgres/Dockerfile',
    'deploy/images/typesense/Dockerfile'
)
foreach ($dockerfile in $dockerfiles) {
    $absoluteDockerfile = Join-Path $repoRoot $dockerfile
    $source = Get-Content -LiteralPath $absoluteDockerfile -Raw
    foreach ($from in [regex]::Matches($source, '(?im)^FROM\s+([^\s]+)')) {
        $base = $from.Groups[1].Value
        if ($base -match '^\$\{([^}]+)\}$') {
            $argument = [regex]::Escape($Matches[1])
            if ($source -notmatch "(?im)^ARG\s+$argument=[^\s]+@sha256:[0-9a-f]{64}\s*$") {
                Add-ContractError "Unpinned build argument '$($Matches[1])' in $dockerfile."
            }
        }
        elseif ($base -notmatch '@sha256:[0-9a-f]{64}$') {
            Add-ContractError "Unpinned base image '$base' in $dockerfile."
        }
    }
}

$composePath = Join-Path $repoRoot 'deploy/compose/docker-compose.prod.yml'
$compose = Get-Content -LiteralPath $composePath -Raw
foreach ($image in @('server', 'web', 'backup', 'postgres', 'typesense')) {
    Assert-Matches $compose ([regex]::Escape("/${image}:" + '${APP_VERSION')) "Production Compose does not pin '$image' to APP_VERSION."
}

if ($errors.Count -gt 0) {
    $errors | ForEach-Object { Write-Error $_ -ErrorAction Continue }
    exit 1
}

Write-Host 'Release supply-chain contract passed: tag gate, pinned actions/bases, five signed multi-arch images, SBOM, provenance, checksums, and bundle.'
