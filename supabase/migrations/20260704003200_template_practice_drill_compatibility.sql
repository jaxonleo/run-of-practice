-- Non-self-referential replacements for template_activities/practice_activities
-- own policies: these check permission via the FK column (template_id /
-- practice_id) against a DIFFERENT table, rather than looking up the row's
-- own id in the same table being inserted into. Removes any ambiguity about
-- same-command visibility during INSERT -- querying a different, already-
-- committed table is unambiguously safe in all cases.
create function public.can_access_template(p_template_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select public.can_access_owned(t.organization_id, t.owner_user_id)
  from public.templates t where t.id = p_template_id;
$$;

create function public.can_manage_template(p_template_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select public.can_manage_owned(t.organization_id, t.owner_user_id)
  from public.templates t where t.id = p_template_id;
$$;

-- Which drill can go into which template: org template -> only that same
-- org's drills; personal template -> the owner's own drills, or any org's
-- drills they belong to. Mirrors can_link_asset_to_template_activity exactly,
-- one level up (drill-to-template instead of asset-to-drill).
create function public.can_link_drill_to_template(p_template_id uuid, p_library_activity_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select
    case
      when t.organization_id is not null then la.organization_id = t.organization_id
      else (
        la.owner_user_id = t.owner_user_id
        or (la.organization_id is not null and public.is_org_member(la.organization_id))
      )
    end
  from public.templates t
  join public.activity_library la on la.id = p_library_activity_id
  where t.id = p_template_id;
$$;

create function public.can_link_drill_to_template_station(p_template_station_block_id uuid, p_library_activity_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select
    case
      when t.organization_id is not null then la.organization_id = t.organization_id
      else (
        la.owner_user_id = t.owner_user_id
        or (la.organization_id is not null and public.is_org_member(la.organization_id))
      )
    end
  from public.template_station_blocks b
  join public.template_activities ta on ta.id = b.template_activity_id
  join public.templates t on t.id = ta.template_id
  join public.activity_library la on la.id = p_library_activity_id
  where b.id = p_template_station_block_id;
$$;

-- Drills aren't team-owned, so a practice/station just needs "can the
-- builder access this drill at all" -- no team dimension required here,
-- unlike the equipment check.
create function public.can_link_drill_to_practice(p_library_activity_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select public.can_access_owned(la.organization_id, la.owner_user_id)
  from public.activity_library la where la.id = p_library_activity_id;
$$;

-- Rewrite template_activities policies to use the FK-based functions above.
drop policy if exists "template_activities_select_access" on public.template_activities;
create policy "template_activities_select_access" on public.template_activities
  for select using (public.can_access_template(template_id));

drop policy if exists "template_activities_insert_manage" on public.template_activities;
create policy "template_activities_insert_manage" on public.template_activities
  for insert with check (
    public.can_manage_template(template_id)
    and (library_activity_id is null or public.can_link_drill_to_template(template_id, library_activity_id))
  );

drop policy if exists "template_activities_update_manage" on public.template_activities;
create policy "template_activities_update_manage" on public.template_activities
  for update using (public.can_manage_template(template_id));

-- template_stations: not self-referential (looks up template_station_blocks,
-- a different table), so only adding the drill-compatibility check here.
drop policy if exists "template_stations_insert_manage" on public.template_stations;
create policy "template_stations_insert_manage" on public.template_stations
  for insert with check (
    public.can_manage_template_station_block(template_station_block_id)
    and (library_activity_id is null or public.can_link_drill_to_template_station(template_station_block_id, library_activity_id))
  );

-- Rewrite practice_activities policies to use the existing (already
-- non-self-referential) can_access_practice/can_manage_practice functions,
-- plus the new drill-compatibility check.
drop policy if exists "practice_activities_select_access" on public.practice_activities;
create policy "practice_activities_select_access" on public.practice_activities
  for select using (public.can_access_practice(practice_id));

drop policy if exists "practice_activities_insert_manage" on public.practice_activities;
create policy "practice_activities_insert_manage" on public.practice_activities
  for insert with check (
    public.can_manage_practice(practice_id)
    and (library_activity_id is null or public.can_link_drill_to_practice(library_activity_id))
  );

drop policy if exists "practice_activities_update_manage" on public.practice_activities;
create policy "practice_activities_update_manage" on public.practice_activities
  for update using (public.can_manage_practice(practice_id));

-- stations: not self-referential (looks up station_blocks, a different
-- table), so only adding the drill-compatibility check.
drop policy if exists "stations_insert_manage" on public.stations;
create policy "stations_insert_manage" on public.stations
  for insert with check (
    public.can_manage_station_block(station_block_id)
    and (library_activity_id is null or public.can_link_drill_to_practice(library_activity_id))
  );
