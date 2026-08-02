-- Enhancement 6, Drill Performance Insights. Two-tier query architecture
-- per the spec: a batch summary RPC for every visible card (one call per
-- shelf, not per card), and a full detail RPC fetched only when a coach
-- actually opens one drill's insights.
--
-- Lineage: attributed strictly through library_activity_id on
-- practice_activities/stations (confirmed before writing this -- templates
-- copy library_activity_id into template_activities and BuilderScreen
-- copies it again from a started template's activities into the saved
-- practice, so usage through a template traces back correctly; a copied
-- drill gets its own new activity_library.id via copyDrillToMyLibrary, so
-- it naturally starts its own history with zero fuzzy name matching
-- anywhere here). "Completed use" means a real logged occurrence: the
-- session reached status='completed' and the specific execution unit (the
-- practice_activity or station referencing this drill) has at least one
-- meaningful session_activity_log row. A session excluded from goals
-- (excluded_at) is also excluded from usage counting here -- exclusion in
-- this schema already means "a test run, a throwaway Run Again" (see
-- set_session_exclusion's own migration comment), which shouldn't inflate
-- a drill's real-world usage count either. Documented as a judgment call,
-- not something the spec stated explicitly either way.

-- Batch card summaries. Authorization is per-drill (owner or org-admin of
-- an org-owned drill) -- unauthorized ids are silently omitted, never
-- trusted from the client, per the spec.
create function public.get_drill_insight_summaries(p_library_activity_ids uuid[])
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_result jsonb;
begin
  with capped as (
    select distinct id from unnest(p_library_activity_ids[1:300]) as id
  ),
  authorized as (
    select al.id from public.activity_library al
    join capped c on c.id = al.id
    where al.owner_user_id = auth.uid()
      or (al.organization_id is not null and public.is_org_admin(al.organization_id))
  ),
  occurrences as (
    select pa.library_activity_id as lib_id, pls.ended_at
    from public.practice_activities pa
    join public.practices p on p.id = pa.practice_id
    join public.practice_live_sessions pls on pls.practice_id = p.id and pls.status = 'completed' and pls.excluded_at is null
    where pa.library_activity_id in (select id from authorized) and pa.archived_at is null
      and exists (select 1 from public.session_activity_log sal where sal.session_id = pls.id and sal.practice_activity_id = pa.id and sal.ended_at is not null and sal.ended_at > sal.started_at)
    union all
    select stn.library_activity_id, pls.ended_at
    from public.stations stn
    join public.station_blocks sb on sb.id = stn.station_block_id
    join public.practice_activities pa on pa.id = sb.practice_activity_id
    join public.practices p on p.id = pa.practice_id
    join public.practice_live_sessions pls on pls.practice_id = p.id and pls.status = 'completed' and pls.excluded_at is null
    where stn.library_activity_id in (select id from authorized) and stn.archived_at is null
      and exists (select 1 from public.session_activity_log sal where sal.session_id = pls.id and sal.station_id = stn.id and sal.ended_at is not null and sal.ended_at > sal.started_at)
  ),
  agg as (
    select lib_id,
      count(*) filter (where ended_at >= now() - interval '12 months') as n12,
      count(*) as n_all,
      max(ended_at) as last_used
    from occurrences group by lib_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'library_activity_id', a.id,
    'completed_uses_trailing_12_months', coalesce(agg.n12, 0),
    'last_used_at', agg.last_used,
    'has_insight_data', coalesce(agg.n_all, 0) > 0
  )), '[]'::jsonb) into v_result
  from authorized a
  left join agg on agg.lib_id = a.id;

  return v_result;
end;
$$;
grant execute on function public.get_drill_insight_summaries(uuid[]) to authenticated;

-- On-demand full detail for one drill. Same authorization as the batch
-- summary (owner or org-admin), plus every usage/note row is additionally
-- filtered to a team the caller can *currently* access
-- (can_access_team) -- a personal drill's history can span teams the coach
-- has since left, and neither those sessions nor their notes should leak.
create function public.get_drill_insights(p_library_activity_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_owner_user_id uuid;
  v_organization_id uuid;
  v_result jsonb;
begin
  select owner_user_id, organization_id into v_owner_user_id, v_organization_id
  from public.activity_library where id = p_library_activity_id;

  if v_owner_user_id is null and v_organization_id is null then
    raise exception 'drill not found';
  end if;
  if not (v_owner_user_id = auth.uid() or (v_organization_id is not null and public.is_org_admin(v_organization_id))) then
    raise exception 'not authorized';
  end if;

  with occurrences as (
    select pa.id as unit_id, 'activity'::text as unit_kind, pa.duration_minutes::numeric as planned_minutes,
      p.id as practice_id, p.team_id, pls.id as session_id, pls.ended_at
    from public.practice_activities pa
    join public.practices p on p.id = pa.practice_id
    join public.practice_live_sessions pls on pls.practice_id = p.id and pls.status = 'completed' and pls.excluded_at is null
    where pa.library_activity_id = p_library_activity_id and pa.archived_at is null
      and public.can_access_team(p.team_id)
    union all
    select stn.id, 'station', round(coalesce(sb.station_duration_seconds, 0) / 60.0, 1),
      p.id, p.team_id, pls.id, pls.ended_at
    from public.stations stn
    join public.station_blocks sb on sb.id = stn.station_block_id
    join public.practice_activities pa on pa.id = sb.practice_activity_id
    join public.practices p on p.id = pa.practice_id
    join public.practice_live_sessions pls on pls.practice_id = p.id and pls.status = 'completed' and pls.excluded_at is null
    where stn.library_activity_id = p_library_activity_id and stn.archived_at is null
      and public.can_access_team(p.team_id)
  ),
  occurrence_actuals as (
    select o.*,
      (select sum(extract(epoch from (sal.ended_at - sal.started_at))) / 60.0
       from public.session_activity_log sal
       where sal.session_id = o.session_id and sal.ended_at is not null and sal.ended_at > sal.started_at
         and (case when o.unit_kind = 'activity' then sal.practice_activity_id = o.unit_id else sal.station_id = o.unit_id end)
      ) as actual_minutes
    from occurrences o
  ),
  used as (select * from occurrence_actuals where actual_minutes is not null),
  window_counts as (
    select
      count(*) filter (where ended_at >= now() - interval '4 weeks') as n4w,
      count(*) filter (where ended_at >= now() - interval '12 weeks') as n12w,
      count(*) filter (where ended_at >= now() - interval '12 months') as n12mo,
      count(*) as n_all,
      max(ended_at) as last_used,
      avg(planned_minutes) as avg_planned,
      avg(actual_minutes) as avg_actual
    from used
  ),
  variance_counts as (
    select
      count(*) filter (where (actual_minutes * 60 - planned_minutes * 60) > 60) as n_extended,
      count(*) filter (where (planned_minutes * 60 - actual_minutes * 60) > 60) as n_shortened,
      count(*) filter (where abs(actual_minutes * 60 - planned_minutes * 60) <= 60) as n_on_plan,
      count(*) as n_total
    from used
  ),
  -- "Skipped" here means a planned occurrence in a completed session with
  -- no usable log at all -- only reliably countable, per the spec, when
  -- every occurrence for this drill is a plain activity (not inside a
  -- station block, where a missing log is ambiguous between "skipped" and
  -- "logged at the block/phase level"). Omitted (null) rather than a
  -- guessed number when any station occurrences exist.
  skip_eligible as (select bool_and(unit_kind = 'activity') as all_plain from occurrences),
  skipped as (select count(*) as n from occurrence_actuals where actual_minutes is null and unit_kind = 'activity'),
  teams_ctx as (
    select jsonb_agg(distinct jsonb_build_object('team_id', t.id, 'team_name', t.name, 'sport', t.sport)) as teams
    from occurrences o join public.teams t on t.id = o.team_id
  ),
  history as (
    select jsonb_agg(jsonb_build_object(
      'session_id', oa.session_id, 'practice_id', oa.practice_id, 'team_name', t.name,
      'ended_at', oa.ended_at, 'planned_minutes', round(oa.planned_minutes, 1),
      'actual_minutes', case when oa.actual_minutes is null then null else round(oa.actual_minutes, 1) end,
      'diff_minutes', case when oa.actual_minutes is null then null else round(oa.actual_minutes - oa.planned_minutes, 1) end
    ) order by oa.ended_at desc) as rows
    from occurrence_actuals oa join public.teams t on t.id = oa.team_id
  ),
  note_practice_ids as (select distinct practice_id from occurrences),
  recent_notes as (
    select jsonb_agg(jsonb_build_object(
      'note_id', n.id, 'text', n.text, 'created_at', n.created_at,
      'author_kind', n.author_kind, 'author_label', n.author_label,
      'author_name', coalesce(prof.first_name || ' ' || prof.last_name, ts.first_name || ' ' || ts.last_name)
    ) order by n.created_at desc) as rows
    from (
      select n.* from public.notes n
      where n.practice_id in (select practice_id from note_practice_ids)
        and n.archived_at is null
        and (
          n.practice_activity_id in (select unit_id from occurrences where unit_kind = 'activity')
          or n.station_id in (select unit_id from occurrences where unit_kind = 'station')
        )
      order by n.created_at desc
      limit 5
    ) n
    left join public.profiles prof on prof.id = n.created_by
    left join public.team_staff ts on ts.user_id = n.created_by and ts.team_id = (select team_id from occurrences o where o.practice_id = n.practice_id limit 1)
  )
  select jsonb_build_object(
    'library_activity_id', p_library_activity_id,
    'uses_last_4_weeks', coalesce((select n4w from window_counts), 0),
    'uses_last_12_weeks', coalesce((select n12w from window_counts), 0),
    'uses_trailing_12_months', coalesce((select n12mo from window_counts), 0),
    'uses_all_time', coalesce((select n_all from window_counts), 0),
    'last_used_at', (select last_used from window_counts),
    'avg_planned_minutes', (select round(avg_planned, 1) from window_counts),
    'avg_actual_minutes', (select round(avg_actual, 1) from window_counts),
    'pct_extended', case when (select n_total from variance_counts) > 0 then round((select n_extended from variance_counts)::numeric / (select n_total from variance_counts) * 100, 0) else null end,
    'pct_shortened', case when (select n_total from variance_counts) > 0 then round((select n_shortened from variance_counts)::numeric / (select n_total from variance_counts) * 100, 0) else null end,
    'pct_on_plan', case when (select n_total from variance_counts) > 0 then round((select n_on_plan from variance_counts)::numeric / (select n_total from variance_counts) * 100, 0) else null end,
    'skipped_count', case when (select all_plain from skip_eligible) then (select n from skipped) else null end,
    'teams', coalesce((select teams from teams_ctx), '[]'::jsonb),
    'usage_history', coalesce((select rows from history), '[]'::jsonb),
    'recent_notes', coalesce((select rows from recent_notes), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;
grant execute on function public.get_drill_insights(uuid) to authenticated;
