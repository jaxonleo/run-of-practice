#!/usr/bin/env bash
# Read-only production query. Usage: bash scripts/prod_read.sh "select ..."
#
# Every statement runs in a read-only transaction (default_transaction_read_only
# is set for the whole connection), so an INSERT/UPDATE/DELETE/DDL fails with
# "cannot execute ... in a read-only transaction" instead of touching prod.
# This is the one sanctioned way for Claude Code to read production; manual
# prod data changes still follow Working Conventions in BUILD-STATUS.md.
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
if [ $# -ne 1 ] || [ -z "$1" ]; then
  echo "Usage: bash scripts/prod_read.sh \"<one SQL query>\"" >&2
  exit 1
fi

PSQL=/opt/homebrew/opt/libpq/bin/psql
PGOPTIONS="-c default_transaction_read_only=on -c statement_timeout=15000" \
  "$PSQL" "$PROD_DB_URL" -v ON_ERROR_STOP=1 -X -c "$1"
