param(
    [string]$ImageRegistry = "smartupcms",
    [string]$AppVersion = "dev",
    [string]$ClamavImage = "clamav/clamav-debian:1.5.3@sha256:741e6c447241220e0792a901befcaec1d55a755c5097fc9cd88d7fd8be251a5c",
    [string]$TrivyImage = "aquasec/trivy:0.74.0",
    [string]$TrivyCacheVolume = "dwh-trivy-cache"
)

$ErrorActionPreference = "Stop"

$images = @(
    "${ImageRegistry}/server:${AppVersion}",
    "${ImageRegistry}/web:${AppVersion}",
    "${ImageRegistry}/backup:${AppVersion}",
    "smartupcms/postgres:18-alpine-hardened",
    "smartupcms/typesense:27.1-hardened",
    $ClamavImage
)

foreach ($image in $images) {
    & docker image inspect $image *> $null
    if ($LASTEXITCODE -ne 0) {
        throw "Required runtime image was not built: $image"
    }

    Write-Host "Scanning runtime image: $image" -ForegroundColor Yellow
    $json = & docker run --rm `
        -v /var/run/docker.sock:/var/run/docker.sock `
        -v "${TrivyCacheVolume}:/root/.cache/" `
        $TrivyImage image `
        --scanners vuln `
        --severity HIGH,CRITICAL `
        --ignore-unfixed `
        --timeout 10m `
        --skip-version-check `
        --no-progress `
        --format json `
        $image

    if ($LASTEXITCODE -ne 0) {
        throw "Trivy could not scan runtime image: $image"
    }

    $report = $json | ConvertFrom-Json
    $vulnerabilities = @(
        $report.Results |
            ForEach-Object { $_.Vulnerabilities } |
            Where-Object { $null -ne $_ }
    )
    Write-Host "HIGH/CRITICAL findings: $($vulnerabilities.Count)"

    if ($vulnerabilities.Count -gt 0) {
        $vulnerabilities |
            Select-Object Severity, VulnerabilityID, PkgName, InstalledVersion, FixedVersion |
            Format-Table -AutoSize
        throw "Runtime image security gate failed: $image"
    }
}

Write-Host "Runtime image security checks passed." -ForegroundColor Green
