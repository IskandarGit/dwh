#!/bin/sh
set -eu

# ADR-0001: CMS database and DWH database are separate from day one.
# Runs after 01-init-roles.sh (roles already exist), only on an empty PGDATA.
# The application role owns pg-dwh: db/dwh migrations create their own schemas (raw/core/mart/cache).
DWH_DATABASE="${DWH_DB_NAME:-smartupcms_dwh}"
APP_USER="${APP_DB_USER:-${DB_USER:-smartupcms}}"

if [ "$DWH_DATABASE" = "${POSTGRES_DB:-smartupcms}" ]; then
    echo "init-dwh: DWH_DB_NAME must differ from the CMS database name (${POSTGRES_DB:-smartupcms})" >&2
    exit 1
fi

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "${POSTGRES_DB:-smartupcms}" \
    --set=dwh_database="$DWH_DATABASE" --set=app_user="$APP_USER" <<'SQL'
SELECT format('CREATE DATABASE %I OWNER %I', :'dwh_database', :'app_user')
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'dwh_database') \gexec
SQL
