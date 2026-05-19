#!/bin/sh
set -e

PGDATA="${PGDATA:-/var/lib/postgresql/data}"

# Initialise Postgres data directory on first boot
if [ ! -f "$PGDATA/PG_VERSION" ]; then
  mkdir -p "$PGDATA"
  chown postgres:postgres "$PGDATA"
  su-exec postgres initdb -D "$PGDATA" --username=muster --pwfile=<(echo "muster") --auth=md5 -q
  # Allow local connections without password for the muster user
  echo "host all muster 127.0.0.1/32 trust" >> "$PGDATA/pg_hba.conf"
  echo "host all muster ::1/128 trust"       >> "$PGDATA/pg_hba.conf"
fi

# Start Postgres in the background
su-exec postgres postgres -D "$PGDATA" -c listen_addresses=localhost &
PG_PID=$!

# Wait until Postgres is ready
until su-exec postgres pg_isready -q 2>/dev/null; do
  sleep 0.2
done

# Create DB if this is a fresh volume
su-exec postgres createdb -U muster muster 2>/dev/null || true

export DATABASE_URL="postgres://muster:muster@127.0.0.1:5432/muster"

# Start the HTTP server (applies schema on boot via applySchema())
exec node --import tsx /app/src/server.ts
