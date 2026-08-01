-- RPCs for the new Permissions screen's toggles. team_staff's existing
-- UPDATE policy (team_staff_update_manage) is can_manage_team-gated only,
-- which a plain assistant/helper doesn't pass -- mirrors
-- set_team_staff_show_on_home's exact self-service pattern for the
-- assistant's own toggle, and a matching manager-side RPC for the two
-- head-coach-controlled ones.
create function public.set_own_library_share(p_team_staff_id uuid, p_shared boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.team_staff
  set assistant_shares_library = p_shared
  where id = p_team_staff_id and user_id = auth.uid();
end;
$$;

grant execute on function public.set_own_library_share(uuid, boolean) to authenticated;

create function public.set_manager_library_share(p_team_staff_id uuid, p_shared boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team_id uuid;
begin
  select team_id into v_team_id from public.team_staff where id = p_team_staff_id;
  if v_team_id is null or not public.can_manage_team(v_team_id) then
    raise exception 'not authorized';
  end if;

  update public.team_staff
  set head_coach_shares_library = p_shared
  where id = p_team_staff_id;
end;
$$;

grant execute on function public.set_manager_library_share(uuid, boolean) to authenticated;

-- A friendly, explicit check ahead of team_staff_one_delegate_per_team's
-- raw constraint violation -- granting is a no-op if this row is already
-- the delegate, and clearing is always allowed regardless of the cap.
create function public.set_practice_delegate(p_team_staff_id uuid, p_can_build boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team_id uuid;
  v_existing_delegate uuid;
begin
  select team_id into v_team_id from public.team_staff where id = p_team_staff_id;
  if v_team_id is null or not public.can_manage_team(v_team_id) then
    raise exception 'not authorized';
  end if;

  if p_can_build then
    select id into v_existing_delegate from public.team_staff
    where team_id = v_team_id and can_build_practices and archived_at is null and id <> p_team_staff_id
    limit 1;
    if v_existing_delegate is not null then
      raise exception 'This team already has an assistant delegated to build practices. Remove that delegation first.';
    end if;
  end if;

  update public.team_staff
  set can_build_practices = p_can_build
  where id = p_team_staff_id;
end;
$$;

grant execute on function public.set_practice_delegate(uuid, boolean) to authenticated;
