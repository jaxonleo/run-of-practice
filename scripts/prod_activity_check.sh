#!/usr/bin/env bash
# Read-only safety check run before every production change (db:push:prod
# calls this automatically; run it by hand -- `npm run db:check:prod` --
# before any manual prod data change or a `git push origin main` that
# triggers a client deploy). It answers one question: is anyone actually
# using production right now, or about to?
#
# It prints its findings and a verdict line. Exit code:
#   0  -> SAFE   (no active sessions, no practice inside the window, no
#                 users active in the last 15 min)
#   10 -> HOLD   (one of the above is true -- do not deploy)
# Any other non-zero exit is a real error (bad connection, etc.).
#
# Deliberately read-only: SELECTs only, no transaction, nothing written.
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

PSQL="${PSQL_BIN:-/opt/homebrew/opt/libpq/bin/psql}"
[ -x "$PSQL" ] || PSQL="psql"

# WINDOW_MIN: how far ahead a scheduled practice still counts as "about to
# run" (default 120). A practice that started up to 90 min ago also counts.
WINDOW_MIN="${WINDOW_MIN:-120}"

VERDICT="$("$PSQL" "$PROD_DB_URL" -X -q -t -A -v ON_ERROR_STOP=1 -v win="$WINDOW_MIN" <<'SQL'
\pset pager off
with
active_sessions as (
  select pls.id, p.name as practice, t.name as team,
         round(extract(epoch from (now() - pls.created_at))/3600.0, 1) as age_hours
  from public.practice_live_sessions pls
  join public.practices p on p.id = pls.practice_id
  join public.teams t on t.id = p.team_id
  where pls.status = 'active'
),
window_practices as (
  select p.id, p.name, t.name as team,
         round(extract(epoch from (p.scheduled_at - now()))/60.0) as min_from_now
  from public.practices p
  join public.teams t on t.id = p.team_id
  where p.archived_at is null
    and p.status in ('draft','scheduled')
    and p.scheduled_at between now() - interval '90 min'
                          and now() + (:'win' || ' min')::interval
),
recent_users as (
  select
    count(distinct user_id) filter (where created_at > now() - interval '5 min')  as u5,
    count(distinct user_id) filter (where created_at > now() - interval '15 min') as u15,
    count(distinct user_id) filter (where created_at > now() - interval '60 min') as u60
  from public.user_events
  where created_at > now() - interval '60 min'
),
lines as (
  select 1 as n, 'AZ now: ' || to_char(now() at time zone 'America/Phoenix', 'Dy YYYY-MM-DD HH24:MI') as line
  union all
  select 2, 'active live sessions: ' || coalesce((select string_agg(practice || ' (' || team || ', ' || age_hours || 'h)', '; ') from active_sessions), 'none')
  union all
  select 3, 'practices within window: ' || coalesce((select string_agg(name || ' (' || team || ', ' || min_from_now || ' min)', '; ') from window_practices), 'none')
  union all
  select 4, 'users active last 5 / 15 / 60 min: ' || (select u5 || ' / ' || u15 || ' / ' || u60 from recent_users)
  union all
  select 5, case
    when (select count(*) from active_sessions) > 0
      or (select count(*) from window_practices) > 0
      or (select u15 from recent_users) > 0
    then 'VERDICT: HOLD'
    else 'VERDICT: SAFE'
  end
)
select line from lines order by n;
SQL
)"

echo "================ PROD ACTIVITY / SAFETY CHECK ================"
echo "$VERDICT"
echo "============================================================"

if printf '%s\n' "$VERDICT" | grep -q 'VERDICT: HOLD'; then
  echo "HOLD: production has live/imminent activity. Do not deploy now." >&2
  exit 10
fi
echo "SAFE: no live or imminent production activity detected."
exit 0
