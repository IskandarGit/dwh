#!/usr/bin/env bash
set -euo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-deploy/compose/docker-compose.prod.yml}"
ENV_FILE="${ENV_FILE:-.env.production}"
HEALTH_TIMEOUT_SECONDS="${HEALTH_TIMEOUT_SECONDS:-180}"
DEPLOYMENT_HISTORY_FILE="${DEPLOYMENT_HISTORY_FILE:-deployments/history.jsonl}"
ROLLBACK_TARGET="${1:-}"
ROLLBACK_SERVICES="${2:-server web}"
compose=(docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE")

[[ -f "$ENV_FILE" ]] || { echo "[ERROR] Environment file '$ENV_FILE' was not found." >&2; exit 1; }

echo "Starting rollback procedure for services: $ROLLBACK_SERVICES..."

# If rollback target is not provided via CLI, inspect deployment history
if [[ -z "$ROLLBACK_TARGET" ]]; then
    if [[ -f "$DEPLOYMENT_HISTORY_FILE" ]]; then
        echo "Inspecting deployment history in $DEPLOYMENT_HISTORY_FILE..."
        # Extract the most recent successful previous deployment
        last_success="$(grep '"status":"SUCCESS"' "$DEPLOYMENT_HISTORY_FILE" | tail -n 1 || true)"
        if [[ -n "$last_success" ]]; then
            echo "Found previous successful deployment record: $last_success"
        fi
    fi
fi

echo '[1/4] Stopping active server writers to prevent data divergence...'
"${compose[@]}" stop server

echo '[2/4] Pulling / verifying rollback target images...'
if [[ -n "$ROLLBACK_TARGET" ]]; then
    APP_VERSION="$ROLLBACK_TARGET" "${compose[@]}" pull $ROLLBACK_SERVICES
else
    "${compose[@]}" pull $ROLLBACK_SERVICES
fi

echo '[3/4] Starting rolled-back services and awaiting readiness...'
if [[ -n "$ROLLBACK_TARGET" ]]; then
    APP_VERSION="$ROLLBACK_TARGET" "${compose[@]}" up -d --wait --wait-timeout "$HEALTH_TIMEOUT_SECONDS" $ROLLBACK_SERVICES
else
    "${compose[@]}" up -d --wait --wait-timeout "$HEALTH_TIMEOUT_SECONDS" $ROLLBACK_SERVICES
fi

echo '[4/4] Verifying service state...'
"${compose[@]}" ps $ROLLBACK_SERVICES

# Record rollback in deployment history
timestamp="$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
mkdir -p "$(dirname "$DEPLOYMENT_HISTORY_FILE")" 2>/dev/null || true
cat >> "$DEPLOYMENT_HISTORY_FILE" 2>/dev/null <<EOF || true
{"timestamp":"$timestamp","status":"SUCCESS","action":"rollback","envFile":"$ENV_FILE","target":"${ROLLBACK_TARGET:-previous}","services":"$ROLLBACK_SERVICES"}
EOF

echo "Rollback completed successfully."
