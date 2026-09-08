#!/usr/bin/env bash
# Pushes pending migrations to production. Guarded on purpose -- a migration
# only ever gets here after it's been dry-run and applied on staging and the
# affected flow clicked through on the staging domain (see Working
# Conventions). This script itself:
#   (a) refuses unless the working tree is clean and on main
#   (b) runs the §3.1 dump first, no exceptions
#   (c) requires typing the literal production project ref to proceed
# Usage: npm run db:push:prod
#
# Also runs the read-only production activity check first
# (scripts/prod_activity_check.sh): if anyone has a live session, a practice
# inside the deploy window, or was active in the last 15 minutes, this
# refuses. Override for a genuine emergency with FORCE_PROD_PUSH=1 (logged
# in the Session Log when used).
set -euo pipefail

cd "$(dirname "$0")/.."

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

if [ -z "${PROD_DB_URL:-}" ] || [ -z "${PROD_PROJECT_REF:-}" ]; then
  echo "PROD_DB_URL and PROD_PROJECT_REF must both be set in .env. Aborting." >&2
  exit 1
fi

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [ "$BRANCH" != "main" ]; then
  echo "Refusing to push to production from branch '$BRANCH' -- must be on main." >&2
  exit 1
fi

echo "Running the production activity check first (scripts/prod_activity_check.sh)..."
if [ "${FORCE_PROD_PUSH:-0}" = "1" ]; then
  bash scripts/prod_activity_check.sh || echo "Activity check reported HOLD -- continuing anyway because FORCE_PROD_PUSH=1."
else
  if ! bash scripts/prod_activity_check.sh; then
    echo "" >&2
    echo "Aborting: production has live or imminent activity. Wait, or re-run with" >&2
    echo "FORCE_PROD_PUSH=1 for a genuine emergency (and log it in the Session Log)." >&2
    exit 1
  fi
fi
echo ""

if [ -n "$(git status --porcelain)" ]; then
  echo "Refusing to push to production with a dirty working tree. Commit or stash first:" >&2
  git status --short >&2
  exit 1
fi

echo "Dumping production first (scripts/db_dump.sh), no exceptions..."
bash scripts/db_dump.sh

echo ""
echo "About to push migrations to PRODUCTION ($PROD_PROJECT_REF)."
echo "This should only happen after the migration was dry-run and applied on"
echo "staging, and the affected flow was clicked through on the staging domain."
echo ""
read -r -p "Type the production project ref to continue: " CONFIRM
if [ "$CONFIRM" != "$PROD_PROJECT_REF" ]; then
  echo "Ref did not match. Aborting, nothing was pushed." >&2
  exit 1
fi

echo "Confirmed. Pushing to production..."
npx supabase db push --db-url "$PROD_DB_URL" "$@"
