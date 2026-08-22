-- Delegated Planning spec, Edge Case F: deleting a source drill must not
-- corrupt Goals & Insights attribution for practices that already used it.
-- Today, every attribution helper joins drill_tags live by library_activity_id
-- -- once a drill is deleted that FK is already null (on delete set null,
-- 20260802050000), so the activity's minutes silently fall out of every
-- category and into "untagged" for every historical report, forever.
--
-- Fix: widen the shared activity_minute_row composite type with a
-- tag_ids_snapshot attribute (sourced from practice_activities/stations.
-- tag_snapshot, added in 20260822000000 and backfilled in 20260822000100),
-- and have category_minutes_from_rows fall back to it only when the source
-- drill is actually gone (library_activity_id is null) -- a drill that
-- still exists always uses its current live tags exactly as before, so
-- re-tagging a drill continues to retroactively affect its own history the
-- same way it always has. This migration must run before the Goals-access
-- migration that references the new column on session_activity_minutes'
-- output (hence the earlier timestamp).

alter type public.activity_minute_row add attribute tag_ids_snapshot uuid[];

create or replace function public.session_activity_minutes(p_session_id uuid)
returns setof public.activity_minute_row
language sql stable security definer set search_path = public as $$
  with log_rows as (
    select
      pa.type as pa_type,
      coalesce(pa.library_activity_id, stn.library_activity_id) as library_activity_id,
      coalesce(pa.tag_snapshot, stn.tag_snapshot) as tag_ids_snapshot,
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
    (case when lr.station_block_id is not null then lr.raw_minutes / nullif(sc.n, 0) else lr.raw_minutes end)::numeric as minutes,
    lr.tag_ids_snapshot
  from log_rows lr
  left join station_counts sc on sc.station_block_id = lr.station_block_id;
$$;
revoke all on function public.session_activity_minutes(uuid) from public;
grant execute on function public.session_activity_minutes(uuid) to authenticated;

create or replace function public.practice_activity_planned_minutes(p_practice_id uuid)
returns setof public.activity_minute_row
language sql stable security definer set search_path = public as $$
  with planned_activity_rows as (
    select pa.library_activity_id, pa.type as pa_type, pa.duration_minutes::numeric as minutes, pa.tag_snapshot as tag_ids_snapshot
    from public.practice_activities pa
    where pa.practice_id = p_practice_id and pa.archived_at is null and pa.type <> 'station_block'
  ),
  planned_station_rows as (
    select stn.library_activity_id, 'activity'::text as pa_type,
           (coalesce(sb.station_duration_seconds, 0) / 60.0)::numeric as minutes, stn.tag_snapshot as tag_ids_snapshot
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
grant execute on function public.practice_activity_planned_minutes(uuid) to authenticated;

create or replace function public.category_minutes_from_rows(p_rows public.activity_minute_row[])
returns table(skill_category_id uuid, minutes numeric)
language sql stable security definer set search_path = public as $$
  with tag_counts as (
    select activity_library_id, count(*) as n_tags from public.drill_tags group by activity_library_id
  ),
  base as (
    select (r).library_activity_id, (r).pa_type, (r).minutes, (r).tag_ids_snapshot
    from unnest(p_rows) as r
  ),
  live_rows as (
    select st.category_id as skill_category_id, b.minutes / nullif(tc.n_tags, 0) as split_minutes
    from base b
    join tag_counts tc on tc.activity_library_id = b.library_activity_id
    join public.drill_tags dt on dt.activity_library_id = b.library_activity_id
    join public.skill_tags st on st.id = dt.skill_tag_id
    where b.pa_type is distinct from 'break' and b.pa_type is distinct from 'checklist'
  ),
  fallback_rows as (
    select st.category_id as skill_category_id,
      b.minutes / nullif(array_length(b.tag_ids_snapshot, 1), 0) as split_minutes
    from base b
    join public.skill_tags st on st.id = any(b.tag_ids_snapshot)
    where b.pa_type is distinct from 'break' and b.pa_type is distinct from 'checklist'
      and b.library_activity_id is null
      and b.tag_ids_snapshot is not null and array_length(b.tag_ids_snapshot, 1) > 0
  )
  select skill_category_id, sum(split_minutes) as minutes
  from (select * from live_rows union all select * from fallback_rows) x
  group by skill_category_id;
$$;
revoke all on function public.category_minutes_from_rows(public.activity_minute_row[]) from public;
