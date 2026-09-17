#!/bin/sh
set -eu
set -o pipefail

BACKUP_DIR="${BACKUP_DIR:-/backups}"
BACKUP_STATUS_FILE="${BACKUP_STATUS_FILE:-/status/status.json}"
BACKUP_INTERVAL_SECONDS="${BACKUP_INTERVAL_SECONDS:-86400}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
BACKUP_STORAGE_MODE="${BACKUP_STORAGE_MODE:-local}"
BACKUP_RUN_ONCE="${BACKUP_RUN_ONCE:-false}"
PGHOST="${PGHOST:-postgres}"
PGPORT="${PGPORT:-5432}"
PGDATABASE="${PGDATABASE:-smartupcms}"
PGUSER="${PGUSER:-smartupcms_backup}"
export BACKUP_STATUS_FILE PGHOST PGPORT PGDATABASE PGUSER

status() {
    /usr/local/bin/write-status "$@"
}

failed() {
    code="$1"
    status FAILED "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$code"
}

read_secret() {
    secret_file="$1"
    [ -f "$secret_file" ] || return 1
    value="$(cat "$secret_file")"
    [ -n "$value" ] || return 1
    printf '%s' "$value"
}

cleanup() {
    rm -f "${PGPASSFILE:-}" "${temporary_backup:-}" "${temporary_checksum:-}" \
        "${temporary_manifest:-}" "${temporary_manifest_checksum:-}"
}
trap cleanup EXIT HUP INT TERM

run_backup() {
    if [ -z "${AGE_RECIPIENT:-}" ] || [ -z "${PGPASSWORD_FILE:-}" ]; then
        failed CONFIGURATION_MISSING
        return 1
    fi
    case "$BACKUP_STORAGE_MODE" in
        local|s3) ;;
        *) failed CONFIGURATION_MISSING; return 1 ;;
    esac

    db_password="$(read_secret "$PGPASSWORD_FILE")" || {
        failed CONFIGURATION_MISSING
        return 1
    }

    mkdir -p "$BACKUP_DIR"
    umask 077
    PGPASSFILE="$(mktemp /tmp/.pgpass.XXXXXX)"
    printf '%s:%s:%s:%s:%s\n' "$PGHOST" "$PGPORT" "$PGDATABASE" "$PGUSER" "$db_password" > "$PGPASSFILE"
    chmod 0600 "$PGPASSFILE"
    export PGPASSFILE
    unset db_password

    timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
    final_backup="${BACKUP_DIR}/smartupcms-${timestamp}.dump.age"
    temporary_backup="${final_backup}.partial"
    final_checksum="${final_backup}.sha256"
    temporary_checksum="${final_checksum}.partial"
    final_manifest="${final_backup}.manifest.json"
    temporary_manifest="${final_manifest}.partial"
    final_manifest_checksum="${final_manifest}.sha256"
    temporary_manifest_checksum="${final_manifest_checksum}.partial"

    if ! pg_dump --format=custom --no-owner --no-privileges \
        | age --encrypt --recipient "$AGE_RECIPIENT" > "$temporary_backup"; then
        failed DATABASE_DUMP_FAILED
        return 1
    fi
    chmod 0600 "$temporary_backup"
    mv -f "$temporary_backup" "$final_backup"
    temporary_backup=""

    (cd "$BACKUP_DIR" && sha256sum "$(basename "$final_backup")") > "$temporary_checksum"
    chmod 0600 "$temporary_checksum"
    mv -f "$temporary_checksum" "$final_checksum"
    temporary_checksum=""

    captured_iso="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    backup_hash="$(awk '{print $1}' "$final_checksum")"
    printf '{"schemaVersion":1,"database":"%s","capturedAt":"%s","archiveFile":"%s","archiveSha256":"%s","backupRole":"%s"}\n' \
        "$PGDATABASE" "$captured_iso" "$(basename "$final_backup")" "$backup_hash" "$PGUSER" > "$temporary_manifest"
    chmod 0600 "$temporary_manifest"
    mv -f "$temporary_manifest" "$final_manifest"
    temporary_manifest=""

    (cd "$BACKUP_DIR" && sha256sum "$(basename "$final_manifest")") > "$temporary_manifest_checksum"
    chmod 0600 "$temporary_manifest_checksum"
    mv -f "$temporary_manifest_checksum" "$final_manifest_checksum"
    temporary_manifest_checksum=""

    if [ "$BACKUP_STORAGE_MODE" = "s3" ]; then
        if [ -z "${BACKUP_S3_ENDPOINT:-}" ] || [ -z "${BACKUP_S3_BUCKET:-}" ] \
            || [ -z "${BACKUP_S3_ACCESS_KEY_ID_FILE:-}" ] || [ -z "${BACKUP_S3_SECRET_ACCESS_KEY_FILE:-}" ]; then
            failed CONFIGURATION_MISSING
            return 1
        fi
        AWS_ACCESS_KEY_ID="$(read_secret "$BACKUP_S3_ACCESS_KEY_ID_FILE")" || { failed CONFIGURATION_MISSING; return 1; }
        AWS_SECRET_ACCESS_KEY="$(read_secret "$BACKUP_S3_SECRET_ACCESS_KEY_FILE")" || { failed CONFIGURATION_MISSING; return 1; }
        export AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_DEFAULT_REGION="${BACKUP_S3_REGION:-auto}"
        object_prefix="${BACKUP_S3_PREFIX:-backups}"
        if ! aws --endpoint-url "$BACKUP_S3_ENDPOINT" s3 cp "$final_backup" \
                "s3://${BACKUP_S3_BUCKET}/${object_prefix}/$(basename "$final_backup")" --only-show-errors \
            || ! aws --endpoint-url "$BACKUP_S3_ENDPOINT" s3 cp "$final_checksum" \
                "s3://${BACKUP_S3_BUCKET}/${object_prefix}/$(basename "$final_checksum")" --only-show-errors \
            || ! aws --endpoint-url "$BACKUP_S3_ENDPOINT" s3 cp "$final_manifest" \
                "s3://${BACKUP_S3_BUCKET}/${object_prefix}/$(basename "$final_manifest")" --only-show-errors \
            || ! aws --endpoint-url "$BACKUP_S3_ENDPOINT" s3 cp "$final_manifest_checksum" \
                "s3://${BACKUP_S3_BUCKET}/${object_prefix}/$(basename "$final_manifest_checksum")" --only-show-errors; then
            unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY
            failed UPLOAD_FAILED
            return 1
        fi
        unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY
    fi

    find "$BACKUP_DIR" -type f \( -name '*.dump.age*' -o -name '*.manifest.json*' \) \
        -mtime "+$BACKUP_RETENTION_DAYS" -delete
    status SUCCESS "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}

if [ ! -f "$BACKUP_STATUS_FILE" ]; then
    status NEVER
fi

while true; do
    result=0
    run_backup || result=$?
    if [ "$BACKUP_RUN_ONCE" = "true" ]; then
        exit "$result"
    fi
    sleep "$BACKUP_INTERVAL_SECONDS"
done
