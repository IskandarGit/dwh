param(
    [ValidateRange(65, 300)]
    [int]$ObservationSeconds = 70,
    [string]$ProjectName = "smartupcms-no-egress",
    [string]$NetshootImage = "nicolaka/netshoot:v0.14@sha256:7f08c4aff13ff61a35d30e30c5c1ea8396eac6ab4ce19fd02d5a4b3b5d0d09a2"
)

$ErrorActionPreference = "Stop"

$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
$composeFiles = @(
    "-f", (Join-Path $repositoryRoot "docker-compose.yml"),
    "-f", (Join-Path $repositoryRoot "scripts/security/no-default-egress.compose.yml")
)
$composeProject = @("compose", "-p", $ProjectName) + $composeFiles
$monitorName = "${ProjectName}-tcpdump"
$environmentNames = @(
    "ADMIN_PASSWORD",
    "DB_PORT",
    "TYPESENSE_PORT",
    "WEB_PORT"
)
$previousEnvironment = @{}

foreach ($name in $environmentNames) {
    $previousEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, "Process")
}

function Invoke-Docker {
    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)

    & docker @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Docker command failed: docker $($Arguments -join ' ')"
    }
}

function Get-ContainerId {
    param([string]$Service)

    $id = (& docker @composeProject ps -q $Service).Trim()
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($id)) {
        throw "Container is not running for service: $Service"
    }
    return $id
}

try {
    Set-Location $repositoryRoot

    $composeText = Get-Content (Join-Path $repositoryRoot "docker-compose.yml") -Raw
    $requiredLocalDefaults = @(
        'DWH_PROVIDER_STORAGE: ${DWH_PROVIDER_STORAGE:-local_disk}',
        'DWH_PROVIDER_MAIL: ${DWH_PROVIDER_MAIL:-console_mail}',
        'DWH_PROVIDER_SMS: ${DWH_PROVIDER_SMS:-console_sms}',
        'DWH_PROVIDER_MESSENGER: ${DWH_PROVIDER_MESSENGER:-console_messenger}',
        'DWH_WEBHOOKS_ENABLED: ${DWH_WEBHOOKS_ENABLED:-false}',
        'DWH_WEBHOOKS_ALLOW_PRIVATE_ADDRESSES: ${DWH_WEBHOOKS_ALLOW_PRIVATE_ADDRESSES:-false}'
    )
    foreach ($requiredDefault in $requiredLocalDefaults) {
        if (-not $composeText.Contains($requiredDefault)) {
            throw "Local-by-default provider contract is missing: $requiredDefault"
        }
    }

    if ($composeText -match '(?im)^\s*(?:CONTROL_PLANE|TELEMETRY|PHONE_HOME|HEARTBEAT)[A-Z0-9_]*\s*:') {
        throw "A control-plane, telemetry, phone-home, or heartbeat setting is present in the default runtime."
    }

    $env:ADMIN_PASSWORD = "No-Egress-Disposable-2026!"
    $env:DB_PORT = "55439"
    $env:TYPESENSE_PORT = "58109"
    $env:WEB_PORT = "54209"

    Invoke-Docker @composeProject config --quiet
    Invoke-Docker @composeProject down --volumes --remove-orphans
    Invoke-Docker @composeProject build postgres typesense server web
    Invoke-Docker @composeProject --profile tools run --rm migrate
    Invoke-Docker @composeProject up -d --wait postgres typesense server web

    $serverId = Get-ContainerId "server"
    Invoke-Docker pull $NetshootImage
    $monitorArguments = @(
        "run", "-d",
        "--name", $monitorName,
        "--network", "container:$serverId",
        "--cap-add", "NET_RAW",
        $NetshootImage,
        "tcpdump", "-i", "any", "-nn", "-l", "-vv", "ip or ip6"
    )
    Invoke-Docker -Arguments $monitorArguments

    Write-Host "Observing default runtime traffic for $ObservationSeconds seconds..." -ForegroundColor Yellow
    Start-Sleep -Seconds $ObservationSeconds

    $allowedIps = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($loopback in @("127.0.0.1", "127.0.0.11", "0.0.0.0")) {
        [void]$allowedIps.Add($loopback)
    }
    foreach ($service in @("postgres", "typesense", "server", "web")) {
        $containerId = Get-ContainerId $service
        $addresses = (& docker inspect --format '{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}' $containerId).Trim()
        if ($LASTEXITCODE -ne 0) {
            throw "Could not inspect network addresses for service: $service"
        }
        foreach ($address in ($addresses -split '\s+')) {
            if (-not [string]::IsNullOrWhiteSpace($address)) {
                [void]$allowedIps.Add($address)
            }
        }
    }

    $traffic = @(& docker logs $monitorName 2>&1)
    if ($LASTEXITCODE -ne 0) {
        throw "Could not read the runtime traffic capture."
    }

    $violations = [System.Collections.Generic.List[string]]::new()
    $allowedDnsNames = @("postgres", "typesense", "server", "web", "localhost")
    foreach ($line in $traffic) {
        if ($line -match '>\s+(?<destination>\d{1,3}(?:\.\d{1,3}){3})(?:\.\d+)?(?:\s|:)') {
            $destination = $Matches.destination
            if (-not $allowedIps.Contains($destination) -and
                -not $destination.StartsWith("224.") -and
                $destination -ne "255.255.255.255") {
                $violations.Add("external destination $destination :: $line")
            }
        }

        if ($line -match '(?:A|AAAA)\?\s+(?<name>[A-Za-z0-9._-]+)\.') {
            $dnsName = $Matches.name.TrimEnd('.').ToLowerInvariant()
            if ($allowedDnsNames -notcontains $dnsName) {
                $violations.Add("external DNS name $dnsName :: $line")
            }
        }
    }

    if ($violations.Count -gt 0) {
        $violations | Select-Object -Unique | ForEach-Object { Write-Host $_ -ForegroundColor Red }
        throw "Default runtime attempted external network access."
    }

    Write-Host "No external runtime traffic was observed; all default providers remain local." -ForegroundColor Green
}
finally {
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = 'SilentlyContinue'
    & docker rm -f $monitorName 2>&1 | Out-Null
    & docker @composeProject down --volumes --remove-orphans 2>&1 | Out-Null
    $ErrorActionPreference = $prevEap

    foreach ($name in $environmentNames) {
        [Environment]::SetEnvironmentVariable($name, $previousEnvironment[$name], "Process")
    }
    Set-Location $repositoryRoot
    Write-Host "Removed disposable no-egress containers, network, and volumes." -ForegroundColor DarkGray
}
