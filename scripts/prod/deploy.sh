#!/usr/bin/env bash
set -euo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-deploy/compose/docker-compose.prod.yml}"
ENV_FILE="${ENV_FILE:-.env.production}"
HEALTH_TIMEOUT_SECONDS="${HEALTH_TIMEOUT_SECONDS:-180}"
compose=(docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE")

on_error() {
    local exit_code=$?
    echo "[ERROR] Deployment failed. Current service state:" >&2
    "${compose[@]}" ps >&2 || true
    exit "$exit_code"
}
trap on_error ERR

[[ -f "$ENV_FILE" ]] || { echo "[ERROR] Environment file '$ENV_FILE' was not found." >&2; exit 1; }
[[ "$HEALTH_TIMEOUT_SECONDS" =~ ^[1-9][0-9]*$ ]] \
    || { echo '[ERROR] HEALTH_TIMEOUT_SECONDS must be a positive integer.' >&2; exit 1; }

echo '[1/7] Validating the unified production configuration...'
docker compose version >/dev/null
"${compose[@]}" config --quiet

echo '[2/7] Pulling immutable release images...'
"${compose[@]}" pull

echo '[3/7] Creating the mandatory pre-migration backup when data exists...'
postgres_id="$("${compose[@]}" ps -a -q postgres)"
has_existing_data=0
if [[ -n "$postgres_id" ]]; then
    has_existing_data=1
else
    postgres_volume="$("${compose[@]}" config --format json 2>/dev/null | grep -o '"postgres-data":\s*{[^}]*"name":\s*"[^"]*"' | sed -E 's/.*"name":\s*"([^"]*)".*/\1/' || true)"
    if [[ -n "$postgres_volume" ]] && docker volume inspect "$postgres_volume" >/dev/null 2>&1; then
        has_existing_data=1
    fi
fi

if [[ "$has_existing_data" -eq 1 ]]; then
    "${compose[@]}" up -d --wait --wait-timeout "$HEALTH_TIMEOUT_SECONDS" postgres
    COMPOSE_FILE="$COMPOSE_FILE" ENV_FILE="$ENV_FILE" bash scripts/prod/backup.sh
else
    echo 'No existing PostgreSQL container or volume found; treating this as an initial deployment.'
fi

echo '[4/7] Starting dependencies...'
"${compose[@]}" up -d --wait --wait-timeout "$HEALTH_TIMEOUT_SECONDS" postgres typesense

echo '[5/7] Applying forward-only database migrations...'
"${compose[@]}" run --rm migrate

echo '[6/7] Creating or refreshing the dedicated read-only backup role...'
"${compose[@]}" run --rm backup-bootstrap

echo '[7/7] Starting SmartupCMS and waiting for readiness...'
"${compose[@]}" up -d --remove-orphans --wait --wait-timeout "$HEALTH_TIMEOUT_SECONDS"
"${compose[@]}" ps

trap - ERR
echo 'Deployment completed successfully.'
