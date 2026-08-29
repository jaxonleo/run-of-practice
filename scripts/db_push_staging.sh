#!/usr/bin/env bash
# Pushes pending migrations to staging. This is the default target for every
# db push, db query, and dry-run per Working Conventions -- staging first,
# always. Targets the project directly via --db-url so the CLI's linked
# project (whatever it happens to be) doesn't matter.
# Usage: npm run db:push:staging  (pass --dry-run to just check first)
set -euo pipefail

cd "$(dirname "$0")/.."

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

if [ -z "${STAGING_DB_URL:-}" ]; then
  echo "STAGING_DB_URL is not set (checked environment and .env). Aborting." >&2
  exit 1
fi

npx supabase db push --db-url "$STAGING_DB_URL" "$@"
