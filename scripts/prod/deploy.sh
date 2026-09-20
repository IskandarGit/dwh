#!/usr/bin/env bash
set -euo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-deploy/compose/docker-compose.prod.yml}"
ENV_FILE="${ENV_FILE:-.env.production}"
HEALTH_TIMEOUT_SECONDS="${HEALTH_TIMEOUT_SECONDS:-180}"
DEPLOYMENT_HISTORY_FILE="${DEPLOYMENT_HISTORY_FILE:-deployments/history.jsonl}"
compose=(docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE")

capture_running_digests() {
    local services=(server web backup postgres typesense clamav)
    local entries=()
    for s in "${services[@]}"; do
        local cid
        cid="$("${compose[@]}" ps -q "$s" 2>/dev/null || true)"
        if [[ -n "$cid" ]]; then
            local image_ref image_id
            image_ref="$(docker inspect --format '{{.Config.Image}}' "$cid" 2>/dev/null || true)"
            image_id="$(docker inspect --format '{{.Image}}' "$cid" 2>/dev/null || true)"
            entries+=("\"$s\":{\"image\":\"$image_ref\",\"id\":\"$image_id\"}")
        fi
    done
    local joined
    joined="$(IFS=,; echo "${entries[*]}")"
    echo "{$joined}"
}

PREVIOUS_DIGESTS="{}"

record_deployment_event() {
    local status="$1"
    local message="${2:-}"
    local timestamp
    timestamp="$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
    local active_digests
    active_digests="$(capture_running_digests)"
    mkdir -p "$(dirname "$DEPLOYMENT_HISTORY_FILE")" 2>/dev/null || true
    cat >> "$DEPLOYMENT_HISTORY_FILE" 2>/dev/null <<EOF || true
{"timestamp":"$timestamp","status":"$status","action":"deploy","envFile":"$ENV_FILE","previousDigests":$PREVIOUS_DIGESTS,"activeDigests":$active_digests,"message":"$message"}
EOF
}

on_error() {
    local exit_code=$?
    echo "[ERROR] Deployment failed. Current service state:" >&2
    "${compose[@]}" ps >&2 || true
    record_deployment_event "FAILED" "Deployment failed with exit code $exit_code"
    exit "$exit_code"
}
trap on_error ERR

[[ -f "$ENV_FILE" ]] || { echo "[ERROR] Environment file '$ENV_FILE' was not found." >&2; exit 1; }
[[ "$HEALTH_TIMEOUT_SECONDS" =~ ^[1-9][0-9]*$ ]] \
    || { echo '[ERROR] HEALTH_TIMEOUT_SECONDS must be a positive integer.' >&2; exit 1; }

echo '[1/7] Validating the unified production configuration...'
docker compose version >/dev/null
"${compose[@]}" config --quiet
PREVIOUS_DIGESTS="$(capture_running_digests)"

# Release verification gate
VERIFY_RELEASE="${VERIFY_RELEASE:-0}"
RELEASE_DIRECTORY="${RELEASE_DIRECTORY:-}"
for arg in "$@"; do
    case "$arg" in
        --verify-release) VERIFY_RELEASE=1 ;;
        --release-dir=*) RELEASE_DIRECTORY="${arg#*=}" ;;
    esac
done

resolved_release_dir=""
if [[ -n "$RELEASE_DIRECTORY" ]]; then
    resolved_release_dir="$RELEASE_DIRECTORY"
elif [[ -f "SHA256SUMS" ]]; then
    resolved_release_dir="."
fi

if [[ "$VERIFY_RELEASE" -eq 1 && -z "$resolved_release_dir" ]]; then
    echo "[ERROR] Release verification requested (--verify-release), but no release directory or SHA256SUMS was found." >&2
    exit 1
fi

if [[ -n "$resolved_release_dir" ]]; then
    echo "Verifying release integrity in '$resolved_release_dir'..."
    if [[ -f "$resolved_release_dir/SHA256SUMS" ]]; then
        (cd "$resolved_release_dir" && sha256sum -c --ignore-missing SHA256SUMS) || {
            echo "[ERROR] Release integrity check failed: SHA256SUMS mismatch." >&2
            exit 1
        }
    fi
    images_txt="$resolved_release_dir/IMAGES.txt"
    if [[ ! -f "$images_txt" && -f "$resolved_release_dir/scripts/prod/IMAGES.txt" ]]; then
        images_txt="$resolved_release_dir/scripts/prod/IMAGES.txt"
    fi
    if [[ -f "$images_txt" ]]; then
        configured_images="$("${compose[@]}" config --format json | grep -o '"image":\s*"[^"]*"' | sed -E 's/.*"image":\s*"([^"]*)".*/\1/' || true)"
        while IFS= read -r cimg; do
            [[ -z "$cimg" ]] && continue
            matched=0
            while IFS= read -r aimp; do
                [[ -z "$aimp" ]] && continue
                if [[ "$cimg" == "$aimp" || "$cimg" == *"/$aimp" || "$aimp" == *"/$cimg" ]]; then
                    matched=1
                    break
                fi
                aimp_digest="$(echo "$aimp" | grep -o 'sha256:[a-f0-9]\{64\}' || true)"
                if [[ -n "$aimp_digest" && "$cimg" =~ $aimp_digest ]]; then
                    matched=1
                    break
                fi
            done < "$images_txt"
            if [[ "$matched" -eq 0 ]]; then
                echo "[ERROR] Release verification failed: image '$cimg' is not in approved release IMAGES.txt." >&2
                exit 1
            fi
        done <<< "$configured_images"
    fi
    echo "Release integrity verification passed."
fi

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
    table_count="$("${compose[@]}" exec -T postgres psql -U "${POSTGRES_USER:-postgres}" -d "${DB_NAME:-smartupcms}" -t -A -c "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'" 2>/dev/null || echo "check_failed")"
    if [[ "$table_count" == "0" ]]; then
        echo 'PostgreSQL database contains no existing tables; skipping pre-migration backup for fresh install.'
    else
        echo 'Existing PostgreSQL data detected; refreshing backup role and creating pre-migration backup...'
        "${compose[@]}" run --rm backup-bootstrap
        COMPOSE_FILE="$COMPOSE_FILE" ENV_FILE="$ENV_FILE" bash scripts/prod/backup.sh
    fi
else
    echo 'No existing PostgreSQL container or volume found; treating this as an initial deployment.'
fi

echo '[4/7] Starting dependencies...'
"${compose[@]}" up -d --wait --wait-timeout "$HEALTH_TIMEOUT_SECONDS" postgres typesense

echo '[5/7] Applying forward-only database migrations...'
"${compose[@]}" run --rm backup-bootstrap
"${compose[@]}" run --rm migrate

echo '[6/7] Refreshing database roles and permissions...'
"${compose[@]}" run --rm backup-bootstrap

echo '[7/7] Starting SmartupCMS and waiting for readiness...'
"${compose[@]}" up -d --remove-orphans --wait --wait-timeout "$HEALTH_TIMEOUT_SECONDS"
"${compose[@]}" ps

record_deployment_event "SUCCESS" "Deployment completed successfully"
trap - ERR
echo 'Deployment completed successfully.'
