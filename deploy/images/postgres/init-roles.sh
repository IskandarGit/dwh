#!/bin/sh
set -eu

PGDATABASE="${POSTGRES_DB:-smartupcms}"
MIGRATE_USER="${MIGRATE_DB_USER:-smartupcms_migrator}"
MIGRATE_PASSWORD="${MIGRATE_DB_PASSWORD:-${POSTGRES_PASSWORD}}"
APP_USER="${APP_DB_USER:-${DB_USER:-smartupcms}}"
APP_PASSWORD="${APP_DB_PASSWORD:-${DB_PASSWORD:-${POSTGRES_PASSWORD}}}"
BACKUP_USER="${BACKUP_DB_USER:-smartupcms_backup}"
BACKUP_PASSWORD="${BACKUP_DB_PASSWORD:-${POSTGRES_PASSWORD}}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$PGDATABASE" \
    --set=migrate_user="$MIGRATE_USER" --set=migrate_password="$MIGRATE_PASSWORD" \
    --set=app_user="$APP_USER" --set=app_password="$APP_PASSWORD" \
    --set=backup_user="$BACKUP_USER" --set=backup_password="$BACKUP_PASSWORD" <<'SQL'
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
    'CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION',
    :'app_user', :'app_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'app_user') \gexec

SELECT format(
    'CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION',
    :'backup_user', :'backup_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'backup_user') \gexec

-- Migrator Schema ownership and permissions
SELECT format('GRANT CONNECT, CREATE ON DATABASE %I TO %I', current_database(), :'migrate_user') \gexec
SELECT format('ALTER SCHEMA %I OWNER TO %I', nspname, :'migrate_user')
FROM pg_namespace WHERE nspname = 'public' \gexec
SELECT format('GRANT ALL ON SCHEMA %I TO %I', nspname, :'migrate_user')
FROM pg_namespace WHERE nspname = 'public' \gexec

-- Default privileges for tables/sequences created by migrator
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

-- App user permissions
SELECT format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), :'app_user') \gexec
SELECT format('GRANT USAGE ON SCHEMA %I TO %I', nspname, :'app_user')
FROM pg_namespace WHERE nspname = 'public' \gexec
SELECT format('REVOKE CREATE ON SCHEMA %I FROM %I', nspname, :'app_user')
FROM pg_namespace WHERE nspname = 'public' \gexec

-- Backup user read-only permissions
SELECT format('ALTER ROLE %I SET default_transaction_read_only = on', :'backup_user') \gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), :'backup_user') \gexec
SELECT format('GRANT USAGE ON SCHEMA %I TO %I', nspname, :'backup_user')
FROM pg_namespace WHERE nspname = 'public' \gexec
SQL