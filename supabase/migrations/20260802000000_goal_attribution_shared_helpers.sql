-- Goals & Insights enhancements (RUN-OF-PRACTICE-GOALS-INSIGHTS-ENHANCEMENTS.md,
-- "Shared calculation and attribution rules"). Every new report (Trends,
-- Next Practice Guidance, Builder projection, Execution Scorecard, Drill
-- Insights) must use the exact same category-attribution math
-- get_team_goal_report/get_team_session_history already use -- multi-tag
-- drills split evenly across their tags (n_tags), station-block minutes
-- split evenly across that block's stations, 'break'-type activities
-- excluded from the denominator entirely. Rather than re-copy that logic
-- into five more hand-written CTUs (verbatim copies already drift once --
-- see the 2026-07-30 get_team_goal_report stale-column incident), it's
-- extracted here into small composable functions the new report RPCs call.
--
-- These are internal building blocks only, never meant to be called
-- directly by a client -- each one takes a bare id with no caller-identity
-- check of its own, trusting the outer RPC (get_team_goal_trends, etc.) to
-- have already verified access via can_access_team/can_manage_team. They're
-- security definer (same convention as can_access_team/can_manage_team in
-- 20260704000800_rls_functions.sql) so a security-definer caller's nested
-- calls run with the same elevated privileges regardless of RLS, but PUBLIC
-- execute is explicitly revoked below so PostgREST can't expose them as
-- directly callable RPCs that would leak another team's session timing.

create type public.activity_minute_row as (
  library_activity_id uuid,
  pa_type text,
  minutes numeric
);

-- Actual, log-based minutes for one completed (or in-progress) session, at
-- log-row grain, station-block-divided -- same shape as
-- get_team_goal_report's actual_attributed CTE. Open-ended rows (no
-- ended_at yet) are clamped to the session's own ended_at/now(), matching
-- the existing report's exact clamping.
create function public.session_activity_minutes(p_session_id uuid)
returns setof public.activity_minute_row
language sql stable security definer set search_path = public as $$
  with log_rows as (
    select
      pa.type as pa_type,
      coalesce(pa.library_activity_id, stn.library_activity_id) as library_activity_id,
      stn.station_block_id,
      extract(epoch from (
        least(coalesce(sal.ended_at, pls.ended_at, now()), coalesce(pls.ended_at, now()))
        - sal.started_at
      )) / 60.0 as raw_minutes
    from public.session_activity_log sal
    join public.practice_live_sessions pls on pls.id = sal.session_id
    left join public.practice_activities pa on pa.id = sal.practice_activity_id
    left join public.stations stn on stn.id = sal.station_id
    where sal.session_id = p_session_id
  ),
  station_counts as (
    select station_block_id, count(*) as n from log_rows where station_block_id is not null group by station_block_id
  )
  select lr.library_activity_id, lr.pa_type,
    (case when lr.station_block_id is not null then lr.raw_minutes / nullif(sc.n, 0) else lr.raw_minutes end)::numeric as minutes
  from log_rows lr
  left join station_counts sc on sc.station_block_id = lr.station_block_id;
$$;
revoke all on function public.session_activity_minutes(uuid) from public;

-- Planned minutes for one practice's saved activity tree, at activity/
-- station grain -- same shape as get_team_goal_report's planned_all CTE,
-- but keyed to one specific practice_id rather than "every currently
-- scheduled practice in a window." practice_activities/stations are full
-- copies at build time (never live references, see BUILD-STATUS's RLS
-- conventions), so this reads the exact plan that was in place for that
-- practice, stable regardless of later library-drill edits.
create function public.practice_activity_planned_minutes(p_practice_id uuid)
returns setof public.activity_minute_row
language sql stable security definer set search_path = public as $$
  with planned_activity_rows as (
    select pa.library_activity_id, pa.type as pa_type, pa.duration_minutes::numeric as minutes
    from public.practice_activities pa
    where pa.practice_id = p_practice_id and pa.archived_at is null and pa.type <> 'station_block'
  ),
  planned_station_rows as (
    select stn.library_activity_id, 'activity'::text as pa_type,
           (coalesce(sb.station_duration_seconds, 0) / 60.0)::numeric as minutes
    from public.stations stn
    join public.station_blocks sb on sb.id = stn.station_block_id
    join public.practice_activities pa on pa.id = sb.practice_activity_id
    where pa.practice_id = p_practice_id and stn.archived_at is null
  )
  select * from planned_activity_rows
  union all
  select * from planned_station_rows;
$$;
revoke all on function public.practice_activity_planned_minutes(uuid) from public;

-- Rolls a set of activity_minute_row up to skill_category_id, splitting a
-- multi-tag drill's minutes evenly across its tags (n_tags) -- identical
-- rule to get_team_goal_report's actual_categories/planned_categories
-- CTEs. 'break'-type rows are excluded, same as the denominator rule.
create function public.category_minutes_from_rows(p_rows public.activity_minute_row[])
returns table(skill_category_id uuid, minutes numeric)
language sql stable security definer set search_path = public as $$
  with tag_counts as (
    select activity_library_id, count(*) as n_tags from public.drill_tags group by activity_library_id
  ),
  base as (select (r).library_activity_id, (r).pa_type, (r).minutes from unnest(p_rows) as r)
  select st.category_id as skill_category_id, sum(b.minutes / nullif(tc.n_tags, 0)) as minutes
  from base b
  join public.drill_tags dt on dt.activity_library_id = b.library_activity_id
  join tag_counts tc on tc.activity_library_id = b.library_activity_id
  join public.skill_tags st on st.id = dt.skill_tag_id
  where b.pa_type is distinct from 'break'
  group by st.category_id;
$$;
revoke all on function public.category_minutes_from_rows(public.activity_minute_row[]) from public;

-- The denominator: total attributable minutes (tagged or not), excluding
-- 'break' rows -- same rule get_team_goal_report's actual_denom/
-- planned_denom CTEs use. Used both to compute a category's percentage and
-- to derive the "untagged" bucket (denominator minus the sum of every
-- category's minutes).
create function public.total_attributable_minutes(p_rows public.activity_minute_row[])
returns numeric
language sql immutable security definer set search_path = public as $$
  select coalesce(sum((r).minutes), 0) from unnest(p_rows) as r where (r).pa_type is distinct from 'break';
$$;
revoke all on function public.total_attributable_minutes(public.activity_minute_row[]) from public;
