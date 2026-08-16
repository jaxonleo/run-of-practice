-- Multi-Coach Builder handoff section 2/9: Pro+ delegate cap changes from
-- 1 to unlimited-for-now (entitlements.js stays inert, matching this
-- project's existing pattern of shipping entitlement fields ahead of real
-- enforcement -- see Known Gaps). Station-level assignment eligibility
-- reuses can_build_practices as its gate (see the Builder UI change in the
-- same session), so a team that wants several coaches each owning
-- different stations now needs to be able to grant it to more than one
-- assistant. The one-per-team unique index and set_practice_delegate's own
-- friendly pre-check both enforced the old cap -- both removed together so
-- the RPC's error message doesn't contradict what the schema now allows.
drop index if exists public.team_staff_one_delegate_per_team;

-- Kept as a plain (non-unique) index -- can_build_practice_for_team and
-- set_practice_delegate's own existence check both filter on
-- (team_id, can_build_practices, archived_at), same shape the unique
-- index used to serve, just without the one-row cap.
create index team_staff_can_build_practices_idx
  on public.team_staff (team_id)
  where can_build_practices and archived_at is null;

create or replace function public.set_practice_delegate(p_team_staff_id uuid, p_can_build boolean)
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
  set can_build_practices = p_can_build
  where id = p_team_staff_id;
end;
$$;
