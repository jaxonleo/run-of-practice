-- Direct feedback: a head coach who already shares their library with a
-- specific assistant on one personal team, then adds that exact same
-- person to a second team, saw the new team's Permissions page show
-- "not shared" -- even though is_library_peer (20260801060000) already
-- grants real access based on ANY matching team_staff row between that
-- head coach/assistant pair, not the specific row being viewed. The
-- stored flag was already effectively a per-(head coach, assistant)
-- relationship at the access-control layer; it just wasn't kept
-- consistent across every row for that pair, so the Permissions UI could
-- show a stale "off" next to a relationship that was actually already on.
--
-- Fixes both sides (head-coach-set and assistant-set) the same way:
-- toggling from any one team's Permissions page now writes the same value
-- to every other personal (non-org) team_staff row for that exact pair,
-- not just the one row the toggle was clicked from. Org teams are
-- untouched -- library sharing there is activity_library_org_shares'
-- separate, already-complete mechanism, and is_library_peer explicitly
-- never reads these two columns for an org team.

create or replace function public.set_manager_library_share(p_team_staff_id uuid, p_shared boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team_id uuid;
  v_assistant_user_id uuid;
  v_head_coach_user_id uuid;
  v_is_org boolean;
begin
  select ts.team_id, ts.user_id into v_team_id, v_assistant_user_id
  from public.team_staff ts where ts.id = p_team_staff_id;
  if v_team_id is null or not public.can_manage_team(v_team_id) then
    raise exception 'not authorized';
  end if;

  select (organization_id is not null) into v_is_org from public.teams where id = v_team_id;
  if v_is_org or v_assistant_user_id is null then
    update public.team_staff set head_coach_shares_library = p_shared where id = p_team_staff_id;
    return;
  end if;

  select hc.user_id into v_head_coach_user_id
  from public.team_staff hc
  where hc.team_id = v_team_id and hc.role = 'head_coach' and hc.archived_at is null
  limit 1;
  if v_head_coach_user_id is null then
    select owner_user_id into v_head_coach_user_id from public.teams where id = v_team_id;
  end if;

  update public.team_staff ts
  set head_coach_shares_library = p_shared
  from public.teams t2
  where ts.team_id = t2.id
    and t2.organization_id is null
    and ts.user_id = v_assistant_user_id
    and ts.role <> 'head_coach'
    and ts.archived_at is null
    and exists (
      select 1 from public.team_staff hc2
      where hc2.team_id = ts.team_id and hc2.role = 'head_coach' and hc2.archived_at is null
        and hc2.user_id = v_head_coach_user_id
    );
end;
$$;

create or replace function public.set_own_library_share(p_team_staff_id uuid, p_shared boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team_id uuid;
  v_head_coach_user_id uuid;
  v_is_org boolean;
begin
  select ts.team_id into v_team_id
  from public.team_staff ts where ts.id = p_team_staff_id and ts.user_id = auth.uid();
  if v_team_id is null then
    -- Not this caller's own row -- same silent no-op the plain
    -- id+user_id-scoped UPDATE this replaced already had.
    return;
  end if;

  select (organization_id is not null) into v_is_org from public.teams where id = v_team_id;
  if v_is_org then
    update public.team_staff set assistant_shares_library = p_shared where id = p_team_staff_id;
    return;
  end if;

  select hc.user_id into v_head_coach_user_id
  from public.team_staff hc
  where hc.team_id = v_team_id and hc.role = 'head_coach' and hc.archived_at is null
  limit 1;
  if v_head_coach_user_id is null then
    select owner_user_id into v_head_coach_user_id from public.teams where id = v_team_id;
  end if;

  update public.team_staff ts
  set assistant_shares_library = p_shared
  from public.teams t2
  where ts.team_id = t2.id
    and t2.organization_id is null
    and ts.user_id = auth.uid()
    and ts.role <> 'head_coach'
    and ts.archived_at is null
    and exists (
      select 1 from public.team_staff hc2
      where hc2.team_id = ts.team_id and hc2.role = 'head_coach' and hc2.archived_at is null
        and hc2.user_id = v_head_coach_user_id
    );
end;
$$;
