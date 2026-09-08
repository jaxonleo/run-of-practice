-- Benchmarks stage 5: carry a benchmark version reference on a practice/template
-- activity and on a station, so a benchmark can be scheduled as a standalone
-- drill-like activity OR inside a station rotation. Spec: ROP-Benchmarks
-- handoff section 4.1.
--
-- Minimal extension, mirroring how scrimmage was added: a standalone benchmark
-- is a single practice_activities/template_activities row with type = 'benchmark'
-- carrying benchmark_id / benchmark_version_id; a station that administers a
-- benchmark carries the same two columns on the stations/template_stations row.
-- No assessment, score, or occurrence identity lives on these planning rows --
-- the row's own id IS the occurrence identity, resolved atomically when
-- recording starts (20260908000100 resolve_benchmark_assessment). Copies and
-- templates therefore need only fresh row ids, which the existing strip-id
-- helpers already produce.
--
-- benchmark_shared_occurrence lets two stations in one block deliberately
-- administer the SAME test and share one assessment (handoff 4.2). Default
-- false: a new same-version station is a separate occasion unless explicitly
-- joined.

alter table public.practice_activities add column if not exists benchmark_id uuid references public.benchmarks(id) on delete set null;
alter table public.practice_activities add column if not exists benchmark_version_id uuid references public.benchmark_versions(id) on delete set null;
alter table public.template_activities add column if not exists benchmark_id uuid references public.benchmarks(id) on delete set null;
alter table public.template_activities add column if not exists benchmark_version_id uuid references public.benchmark_versions(id) on delete set null;

alter table public.stations add column if not exists benchmark_id uuid references public.benchmarks(id) on delete set null;
alter table public.stations add column if not exists benchmark_version_id uuid references public.benchmark_versions(id) on delete set null;
alter table public.stations add column if not exists benchmark_shared_occurrence boolean not null default false;
alter table public.template_stations add column if not exists benchmark_id uuid references public.benchmarks(id) on delete set null;
alter table public.template_stations add column if not exists benchmark_version_id uuid references public.benchmark_versions(id) on delete set null;
alter table public.template_stations add column if not exists benchmark_shared_occurrence boolean not null default false;

comment on column public.practice_activities.benchmark_version_id is
  'When type = ''benchmark'', the immutable protocol version this planned occurrence measures. Pinned; updating to a newer version is explicit.';
comment on column public.stations.benchmark_shared_occurrence is
  'Two stations in one block with the same version and this flag set share ONE assessment (handoff 4.2). Default false: separate occasions.';

-- Activity type allow-list. Current list set by 20260907000000 (scrimmage):
-- ('activity','station_block','checklist','break','scrimmage').
alter table public.practice_activities drop constraint practice_activities_type_check;
alter table public.practice_activities add constraint practice_activities_type_check
  check (type in ('activity', 'station_block', 'checklist', 'break', 'scrimmage', 'benchmark'));

alter table public.template_activities drop constraint template_activities_type_check;
alter table public.template_activities add constraint template_activities_type_check
  check (type in ('activity', 'station_block', 'checklist', 'break', 'scrimmage', 'benchmark'));

-- Delegated station writes must not miss the benchmark reference. Three new
-- trailing params, so replace the old signature rather than overload it (an
-- 11-arg call still resolves, the new params default). Existing callers are
-- unaffected; a delegate editing a benchmark station's drill fields never
-- clears the benchmark (p_set_benchmark stays false).
drop function if exists public.update_station_content(uuid, uuid, uuid, text, text, text, uuid, uuid, text, integer, uuid[]);

create or replace function public.update_station_content(
  p_practice_id uuid, p_activity_id uuid, p_station_id uuid,
  p_name text, p_description text, p_coaching_points text,
  p_library_activity_id uuid, p_sublocation_id uuid,
  p_grouping text, p_num_groups integer, p_equipment_asset_ids uuid[],
  p_benchmark_id uuid default null, p_benchmark_version_id uuid default null,
  p_set_benchmark boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_team_id uuid;
  v_station_delegated_to uuid;
  v_caller_team_staff_id uuid;
  v_asset_id uuid;
  v_tag_snapshot uuid[];
  v_sublocation_name text;
begin
  select p.team_id, s.delegated_to
    into v_team_id, v_station_delegated_to
  from public.stations s
  join public.station_blocks sb on sb.id = s.station_block_id
  join public.practice_activities pa on pa.id = sb.practice_activity_id
  join public.practices p on p.id = pa.practice_id
  where s.id = p_station_id
    and sb.practice_activity_id = p_activity_id
    and pa.practice_id = p_practice_id
    and s.archived_at is null
    and pa.archived_at is null;

  if v_team_id is null then
    raise exception 'STATION_NOT_FOUND: this station no longer exists in this plan' using errcode = 'P0002';
  end if;

  select ts.id into v_caller_team_staff_id
  from public.team_staff ts
  where ts.id = v_station_delegated_to
    and ts.user_id = auth.uid()
    and ts.can_build_practices
    and ts.archived_at is null;

  if not (public.can_manage_team(v_team_id) or v_caller_team_staff_id is not null) then
    raise exception 'NOT_AUTHORIZED: you are not delegated to plan this station' using errcode = '42501';
  end if;

  if p_library_activity_id is not null then
    select array_agg(skill_tag_id) into v_tag_snapshot from public.drill_tags where activity_library_id = p_library_activity_id;
  end if;
  if p_sublocation_id is not null then
    select name into v_sublocation_name from public.sublocations where id = p_sublocation_id;
  end if;

  update public.stations set
    name = p_name,
    description = p_description,
    coaching_points = p_coaching_points,
    library_activity_id = p_library_activity_id,
    sublocation_id = p_sublocation_id,
    tag_snapshot = v_tag_snapshot,
    sublocation_name_snapshot = v_sublocation_name,
    grouping = coalesce(p_grouping, 'whole'),
    num_groups = p_num_groups,
    benchmark_id = case when p_set_benchmark then p_benchmark_id else benchmark_id end,
    benchmark_version_id = case when p_set_benchmark then p_benchmark_version_id else benchmark_version_id end,
    station_updated_at = now(),
    station_updated_by = (
      select id from public.team_staff
      where user_id = auth.uid() and team_id = v_team_id and archived_at is null
      limit 1
    )
  where id = p_station_id;

  delete from public.station_equipment where station_id = p_station_id;
  if p_equipment_asset_ids is not null then
    foreach v_asset_id in array p_equipment_asset_ids loop
      if v_asset_id is not null and public.can_link_asset_to_station(p_station_id, v_asset_id) then
        insert into public.station_equipment (station_id, asset_id)
        values (p_station_id, v_asset_id)
        on conflict (station_id, asset_id) do nothing;
      end if;
    end loop;
  end if;

  return jsonb_build_object('ok', true, 'station_id', p_station_id);
end;
$function$;

grant execute on function public.update_station_content(uuid, uuid, uuid, text, text, text, uuid, uuid, text, integer, uuid[], uuid, uuid, boolean) to authenticated;
