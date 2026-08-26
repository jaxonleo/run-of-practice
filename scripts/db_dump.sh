#!/usr/bin/env bash
# Pre-migration / manual backup of production: roles, schema, and data,
# dumped separately with pg_dump/pg_dumpall directly against PROD_DB_URL.
# Deliberately does not use `supabase db dump` -- on the installed CLI
# version that needs Docker, which this environment doesn't have.
#
# Run before every production `db push`, no exceptions.
set -euo pipefail

cd "$(dirname "$0")/.."

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

if [ -z "${PROD_DB_URL:-}" ]; then
  echo "PROD_DB_URL is not set (checked environment and .env). Aborting." >&2
  exit 1
fi

if ! command -v pg_dump >/dev/null 2>&1 || ! command -v pg_dumpall >/dev/null 2>&1; then
  echo "pg_dump/pg_dumpall not found on PATH. Refusing to run a partial or silent dump." >&2
  echo "Install Postgres client tools, e.g.: brew install libpq" >&2
  echo "then put it on PATH, e.g.: echo 'export PATH=\"/opt/homebrew/opt/libpq/bin:\$PATH\"' >> ~/.zshrc" >&2
  exit 1
fi

case "$PROD_DB_URL" in
  *:6543*)
    echo "PROD_DB_URL looks like it's on port 6543, Supabase's transaction-mode pooler." >&2
    echo "pg_dump needs the direct connection (port 5432) or the session-mode pooler string instead." >&2
    exit 1
    ;;
esac

TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
OUT_DIR="backups/${TIMESTAMP}"
mkdir -p "$OUT_DIR"

ROLES_FILE="${OUT_DIR}/roles.sql"
SCHEMA_FILE="${OUT_DIR}/schema.sql"
DATA_FILE="${OUT_DIR}/data.sql"

echo "Dumping production roles/grants -> ${ROLES_FILE}"
pg_dumpall --dbname="$PROD_DB_URL" --roles-only --no-role-passwords > "$ROLES_FILE"

echo "Dumping production schema -> ${SCHEMA_FILE}"
pg_dump --dbname="$PROD_DB_URL" --schema-only --quote-all-identifiers > "$SCHEMA_FILE"

echo "Dumping production data (all schemas, including supabase_migrations) -> ${DATA_FILE}"
pg_dump --dbname="$PROD_DB_URL" --data-only --quote-all-identifiers --disable-triggers > "$DATA_FILE"

if ! grep -q "schema_migrations" "$DATA_FILE"; then
  echo "WARNING: data dump does not appear to include supabase_migrations.schema_migrations." >&2
  echo "A restore from this dump won't know which migrations were already applied." >&2
  exit 1
fi

echo "Done. Dump written to ${OUT_DIR}/ ($(du -sh "$OUT_DIR" | cut -f1))"
