# syntax=docker/dockerfile:1

# Pinned upstream digest; update deliberately after image scanning.
ARG POSTGRES_BASE=postgres:18-alpine@sha256:d3e1620b530c944afa6e887d22eb899824da68e19c52024bf98f5220c88a65b2
FROM ${POSTGRES_BASE}

USER root

# The upstream image currently ships outdated Alpine security packages and a
# vulnerable Go-built gosu binary. Database services run directly as postgres,
# so gosu is neither needed nor reachable at runtime.
RUN apk upgrade --no-cache \
    && rm -f /usr/local/bin/gosu

COPY --chmod=0755 init-roles.sh /docker-entrypoint-initdb.d/01-init-roles.sh
COPY --chmod=0755 init-dwh.sh /docker-entrypoint-initdb.d/02-init-dwh.sh

USER postgres
