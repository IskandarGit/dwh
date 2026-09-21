#!/bin/sh
set -eu

PGHOST="${PGHOST:-postgres}"
PGPORT="${PGPORT:-5432}"
PGDATABASE="${PGDATABASE:-smartupcms}"
PGUSER="${PGUSER:-postgres}"
MIGRATE_DB_USER="${MIGRATE_DB_USER:-smartupcms_migrator}"
APP_DB_USER="${APP_DB_USER:-${DB_USER:-smartupcms}}"
BACKUP_DB_USER="${BACKUP_DB_USER:-smartupcms_backup}"
export PGHOST PGPORT PGDATABASE PGUSER

if [ -z "${PGPASSWORD_FILE:-}" ] || [ ! -f "$PGPASSWORD_FILE" ]; then
    echo 'admin database credential file is required' >&2
    exit 64
fi
if [ -z "${BACKUP_DB_PASSWORD_FILE:-}" ] || [ ! -f "$BACKUP_DB_PASSWORD_FILE" ]; then
    echo 'backup database credential file is required' >&2
    exit 64
fi

admin_password="$(cat "$PGPASSWORD_FILE")"
backup_password="$(cat "$BACKUP_DB_PASSWORD_FILE")"

migrate_password="$admin_password"
if [ -n "${MIGRATE_DB_PASSWORD_FILE:-}" ] && [ -f "$MIGRATE_DB_PASSWORD_FILE" ]; then
    migrate_password="$(cat "$MIGRATE_DB_PASSWORD_FILE")"
fi

app_password="$admin_password"
if [ -n "${APP_DB_PASSWORD_FILE:-}" ] && [ -f "$APP_DB_PASSWORD_FILE" ]; then
    app_password="$(cat "$APP_DB_PASSWORD_FILE")"
fi

if [ -z "$admin_password" ] || [ -z "$backup_password" ] || [ -z "$migrate_password" ] || [ -z "$app_password" ]; then
    echo 'database credentials must not be empty' >&2
    exit 64
fi

umask 077
pgpass_file="$(mktemp /tmp/.pgpass.XXXXXX)"
trap 'rm -f "$pgpass_file"' EXIT HUP INT TERM
printf '%s:%s:%s:%s:%s\n' "$PGHOST" "$PGPORT" "$PGDATABASE" "$PGUSER" "$admin_password" > "$pgpass_file"
chmod 0600 "$pgpass_file"
export PGPASSFILE="$pgpass_file"
unset admin_password

psql --set=ON_ERROR_STOP=1 --no-psqlrc --quiet \
    --set=migrate_user="$MIGRATE_DB_USER" --set=migrate_password="$migrate_password" \
    --set=app_user="$APP_DB_USER" --set=app_password="$app_password" \
    --set=backup_user="$BACKUP_DB_USER" --set=backup_password="$backup_password" <<'SQL'
-- Extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "fuzzystrmatch";

-- Roles
SELECT format(
    'CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION',
    :'migrate_user', :'migrate_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'migrate_user') \gexec

SELECT format(
    'ALTER ROLE %I WITH LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION',
    :'migrate_user', :'migrate_password') \gexec

SELECT format(
    'CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION',
    :'app_user', :'app_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'app_user') \gexec

SELECT format(
    'ALTER ROLE %I WITH LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION',
    :'app_user', :'app_password') \gexec

SELECT format(
    'CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION',
    :'backup_user', :'backup_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'backup_user') \gexec

SELECT format(
    'ALTER ROLE %I WITH LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION',
    :'backup_user', :'backup_password') \gexec

-- Migrator Schema ownership and permissions
SELECT format('GRANT CONNECT, CREATE ON DATABASE %I TO %I', current_database(), :'migrate_user') \gexec
SELECT format('ALTER SCHEMA %I OWNER TO %I', nspname, :'migrate_user')
FROM pg_namespace WHERE nspname = 'public' \gexec
SELECT format('GRANT ALL ON SCHEMA %I TO %I', nspname, :'migrate_user')
FROM pg_namespace WHERE nspname = 'public' \gexec

-- Transfer table and sequence ownership to migrate_user if upgrading from single-user setup
DO $$
DECLARE
    r RECORD;
    v_migrator text := :'migrate_user';
BEGIN
    FOR r IN (
        SELECT tablename FROM pg_tables
        WHERE schemaname = 'public' AND tableowner <> v_migrator
    ) LOOP
        EXECUTE format('ALTER TABLE public.%I OWNER TO %I', r.tablename, v_migrator);
    END LOOP;

    FOR r IN (
        SELECT sequence_name FROM pg_sequences
        WHERE schemaname = 'public' AND sequenceowner <> v_migrator
    ) LOOP
        EXECUTE format('ALTER SEQUENCE public.%I OWNER TO %I', r.sequence_name, v_migrator);
    END LOOP;
END $$;

-- Default privileges for future tables/sequences created by migrator
SELECT format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %I',
    :'migrate_user', nspname, :'app_user')
FROM pg_namespace WHERE nspname = 'public' \gexec
SELECT format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I GRANT USAGE, SELECT ON SEQUENCES TO %I',
    :'migrate_user', nspname, :'app_user')
FROM pg_namespace WHERE nspname = 'public' \gexec
SELECT format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I REVOKE TRUNCATE ON TABLES FROM %I',
    :'migrate_user', nspname, :'app_user')
FROM pg_namespace WHERE nspname = 'public' \gexec

SELECT format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I GRANT SELECT ON TABLES TO %I',
    :'migrate_user', nspname, :'backup_user')
FROM pg_namespace WHERE nspname = 'public' \gexec
SELECT format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I GRANT SELECT ON SEQUENCES TO %I',
    :'migrate_user', nspname, :'backup_user')
FROM pg_namespace WHERE nspname = 'public' \gexec

-- App user permissions on current objects
SELECT format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), :'app_user') \gexec
SELECT format('GRANT USAGE ON SCHEMA %I TO %I', nspname, :'app_user')
FROM pg_namespace WHERE nspname = 'public' \gexec
SELECT format('REVOKE CREATE ON SCHEMA public FROM %I', :'app_user') \gexec
SELECT format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA %I TO %I', nspname, :'app_user')
FROM pg_namespace WHERE nspname = 'public' \gexec
SELECT format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA %I TO %I', nspname, :'app_user')
FROM pg_namespace WHERE nspname = 'public' \gexec

-- Explicitly revoke TRUNCATE and UPDATE/DELETE on audit_log
SELECT format('REVOKE TRUNCATE ON ALL TABLES IN SCHEMA %I FROM %I', nspname, :'app_user')
FROM pg_namespace WHERE nspname = 'public' \gexec
SELECT format('REVOKE UPDATE, DELETE, TRUNCATE ON audit_log, audit_log_default FROM %I', :'app_user')
WHERE EXISTS (SELECT 1 FROM pg_class WHERE relname = 'audit_log') \gexec

-- Backup user read-only permissions
SELECT format('ALTER ROLE %I SET default_transaction_read_only = on', :'backup_user') \gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), :'backup_user') \gexec
SELECT format('GRANT USAGE ON SCHEMA %I TO %I', nspname, :'backup_user')
FROM pg_namespace WHERE nspname = 'public' \gexec
SELECT format('GRANT SELECT ON ALL TABLES IN SCHEMA %I TO %I', nspname, :'backup_user')
FROM pg_namespace WHERE nspname = 'public' \gexec
SELECT format('GRANT SELECT ON ALL SEQUENCES IN SCHEMA %I TO %I', nspname, :'backup_user')
FROM pg_namespace WHERE nspname = 'public' \gexec
SQL

unset migrate_password app_password backup_password
echo 'database roles and privileges are ready'