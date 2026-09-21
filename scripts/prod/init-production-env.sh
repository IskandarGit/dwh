#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="${1:-.env.production}"
SECRETS_DIR="${SECRETS_DIR:-deploy/compose/.secrets}"
APP_VERSION="${APP_VERSION:-1.0.0}"
ORGANIZATION_CODE="${ORGANIZATION_CODE:-smartup}"
ORGANIZATION_NAME="${ORGANIZATION_NAME:-Smartup Enterprise}"
RESOURCE_PROFILE="${RESOURCE_PROFILE:-S}"
ADMIN_LOGIN="${ADMIN_LOGIN:-admin}"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@example.local}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-}"
AGE_IDENTITY_FILE="${AGE_IDENTITY_FILE:-backup-age-identity.txt}"
STORAGE_MODE="${STORAGE_MODE:-local_disk}"
BACKUP_STORAGE_MODE="${BACKUP_STORAGE_MODE:-local}"
HTTP_PORT="${HTTP_PORT:-8080}"
HTTP_BIND="${HTTP_BIND:-127.0.0.1}"
FORCE="${FORCE:-false}"
VALIDATE="${VALIDATE:-false}"

echo "=== SmartupCMS Production Environment Initializer ==="

if [[ -f "$ENV_FILE" && "$FORCE" != "true" ]]; then
    echo "Error: Target environment file '$ENV_FILE' already exists. Set FORCE=true or remove the file." >&2
    exit 1
fi

generate_hex_token() {
    if command -v openssl >/dev/null 2>&1; then
        openssl rand -hex 32
    else
        head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'
    fi
}

generate_secure_password() {
    if command -v openssl >/dev/null 2>&1; then
        openssl rand -base64 24 | tr -dc 'A-Za-z0-9!@#$%^&*-_=+' | head -c 24
    else
        head -c 64 /dev/urandom | tr -dc 'A-Za-z0-9!@#$%^&*-_=+' | head -c 24
    fi
}

# 1. Prepare secrets directory
mkdir -p "$SECRETS_DIR"
chmod 700 "$SECRETS_DIR"

# 2. Generate secrets
DB_PASSWORD="$(generate_hex_token)"
BACKUP_DB_PASSWORD="$(generate_hex_token)"
TYPESENSE_API_KEY="$(generate_hex_token)"

if [[ -z "$ADMIN_PASSWORD" ]]; then
    ADMIN_PASSWORD="$(generate_secure_password)"
fi

# Write secret files with strict 0600 permissions
printf "%s" "$DB_PASSWORD" > "$SECRETS_DIR/database-password"
printf "%s" "$BACKUP_DB_PASSWORD" > "$SECRETS_DIR/backup-database-password"
chmod 600 "$SECRETS_DIR/database-password" "$SECRETS_DIR/backup-database-password"

echo "[+] Wrote database secret files to $SECRETS_DIR (mode 0600)"

# 3. Generate Age Keypair
AGE_RECIPIENT=""

if command -v age-keygen >/dev/null 2>&1; then
    echo "[+] Generating Age keypair using host age-keygen..."
    age-keygen -o "$AGE_IDENTITY_FILE" 2>/dev/null || true
    if [[ -f "$AGE_IDENTITY_FILE" ]]; then
        AGE_RECIPIENT="$(grep -E '^# public key: age1' "$AGE_IDENTITY_FILE" | awk '{print $NF}' || true)"
        chmod 600 "$AGE_IDENTITY_FILE"
    fi
fi

if [[ -z "$AGE_RECIPIENT" ]] && command -v docker >/dev/null 2>&1; then
    echo "[+] Generating Age keypair via ephemeral Docker container..."
    DOCKER_OUT="$(docker run --rm alpine:latest sh -c "apk add --no-cache age >/dev/null 2>&1 && age-keygen" 2>/dev/null || true)"
    if [[ -n "$DOCKER_OUT" ]]; then
        AGE_RECIPIENT="$(echo "$DOCKER_OUT" | grep -E '(# public key:|Public key:)' | awk '{print $NF}' | head -n 1 || true)"
        PRIV_KEY="$(echo "$DOCKER_OUT" | grep '^AGE-SECRET-KEY-1' || true)"
        if [[ -n "$PRIV_KEY" && -n "$AGE_RECIPIENT" ]]; then
            cat > "$AGE_IDENTITY_FILE" <<EOF
# created: $(date -u +'%Y-%m-%dT%H:%M:%SZ')
# public key: $AGE_RECIPIENT
$PRIV_KEY
EOF
            chmod 600 "$AGE_IDENTITY_FILE"
        fi
    fi
fi

if [[ -z "$AGE_RECIPIENT" ]]; then
    AGE_RECIPIENT="age1$(generate_hex_token | head -c 56)"
    echo "[!] Warning: age-keygen not available. Generated placeholder Age recipient: $AGE_RECIPIENT"
    echo "    Replace BACKUP_AGE_RECIPIENT with your real public key from age-keygen."
else
    echo "[+] Age backup keypair generated successfully!"
    echo "    Public recipient: $AGE_RECIPIENT"
    echo "    Private key saved to: $AGE_IDENTITY_FILE (mode 0600)"
    echo "    IMPORTANT: Move $AGE_IDENTITY_FILE off this server to secure offline storage."
fi

# 4. Generate environment file
cat > "$ENV_FILE" <<EOF
# SmartupCMS: one installation, one organization, many users.
# Generated automatically by init-production-env.sh on $(date -u +'%Y-%m-%dT%H:%M:%SZ')
# Keep this file and all referenced secret files at mode 0600.

PROJECT_NAME=smartupcms
IMAGE_REGISTRY=ghcr.io/smartupcms
APP_VERSION=$APP_VERSION

ORGANIZATION_CODE=$ORGANIZATION_CODE
ORGANIZATION_NAME=$ORGANIZATION_NAME
RESOURCE_PROFILE=$RESOURCE_PROFILE

# Database credentials (I-02 Least Privilege role separation)
DB_NAME=smartupcms
POSTGRES_USER=postgres
POSTGRES_PASSWORD=$DB_PASSWORD
POSTGRES_PASSWORD_FILE=./.secrets/database-password
MIGRATE_DB_USER=smartupcms_migrator
MIGRATE_DB_PASSWORD=$DB_PASSWORD
MIGRATE_DB_PASSWORD_FILE=./.secrets/database-password
DB_USER=smartupcms
DB_PASSWORD=$DB_PASSWORD
DB_PASSWORD_FILE=./.secrets/database-password
BACKUP_DB_USER=smartupcms_backup
BACKUP_DB_PASSWORD_FILE=./.secrets/backup-database-password

ADMIN_LOGIN=$ADMIN_LOGIN
ADMIN_EMAIL=$ADMIN_EMAIL
ADMIN_PASSWORD=$ADMIN_PASSWORD

TYPESENSE_API_KEY=$TYPESENSE_API_KEY

# Storage configuration
DWH_PROVIDER_STORAGE=$STORAGE_MODE
DWH_S3_ENDPOINT=
DWH_S3_REGION=auto
DWH_S3_ACCESS_KEY=
# S3 secret key (leave blank for local_disk)
DWH_S3_SECRET_KEY=
# Target bucket name
DWH_S3_BUCKET=
DWH_S3_PATH_STYLE=true

# Malware protection (fail-closed)
CLAMAV_IMAGE=clamav/clamav-debian:1.5.3@sha256:741e6c447241220e0792a901befcaec1d55a755c5097fc9cd88d7fd8be251a5c
DWH_FILE_SCANNER_CLAMAV_HOST=clamav
DWH_FILE_SCANNER_CLAMAV_PORT=3310
DWH_FILE_SCANNER_CLAMAV_CONNECT_TIMEOUT=3s
DWH_FILE_SCANNER_CLAMAV_READ_TIMEOUT=60s

DWH_RATE_LIMIT_PUBLIC_READ_PER_MINUTE=600

# Outbound webhooks (disabled by default)
DWH_WEBHOOKS_ENABLED=false
DWH_WEBHOOKS_ALLOWED_HOSTS=
DWH_WEBHOOKS_ALLOW_PRIVATE_ADDRESSES=false
DWH_WEBHOOKS_CONNECT_TIMEOUT=3s
DWH_WEBHOOKS_READ_TIMEOUT=10s

# Network & Reverse Proxy
HTTP_BIND=$HTTP_BIND
HTTP_PORT=$HTTP_PORT

# Encrypted automated backups
BACKUP_AGE_RECIPIENT=$AGE_RECIPIENT
BACKUP_INTERVAL_SECONDS=86400
DWH_BACKUP_MAX_AGE=26h
BACKUP_RETENTION_DAYS=14
BACKUP_STORAGE_MODE=$BACKUP_STORAGE_MODE

BACKUP_S3_ENDPOINT=
BACKUP_S3_REGION=auto
BACKUP_S3_BUCKET=
BACKUP_S3_PREFIX=backups
BACKUP_S3_ACCESS_KEY_ID_FILE=./.secrets/backup-s3-access-key-id
BACKUP_S3_SECRET_ACCESS_KEY_FILE=./.secrets/backup-s3-secret-access-key
EOF

chmod 600 "$ENV_FILE"
echo "[+] Successfully created production environment file: $ENV_FILE (mode 0600)"

if [[ "$VALIDATE" == "true" ]]; then
    echo "[*] Validating generated configuration with Docker Compose..."
    docker compose -f deploy/compose/docker-compose.prod.yml --env-file "$ENV_FILE" --profile tools config >/dev/null
    echo "[+] Docker Compose configuration validation PASSED."
fi

echo ""
echo "=== Production Deployment Summary ==="
echo "Organization : $ORGANIZATION_NAME ($ORGANIZATION_CODE)"
echo "Admin user   : $ADMIN_LOGIN ($ADMIN_EMAIL)"
echo "Admin pass   : $ADMIN_PASSWORD"
echo "Environment  : $ENV_FILE"
echo "Secrets dir  : $SECRETS_DIR"
echo "Age public   : $AGE_RECIPIENT"
echo "Next step    : ./scripts/prod/deploy.sh $ENV_FILE"
