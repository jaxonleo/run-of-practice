-- Testing-round-1 addendum §2(f)+(g): no formal accept/decline flow -- the
-- welcome card + leave IS it. Staying = accepting; leaving = declining.
--
-- Both RPCs are deliberately narrow, restricted to the caller's OWN row
-- (user_id = auth.uid()), NOT a general self-update policy on team_staff.
-- A broad self-update policy would let an assistant set their own
-- role='head_coach', which grants full team management through
-- can_manage_team -- privilege escalation, not a style point. Confirmed
-- the only existing UPDATE policy on team_staff (team_staff_update_manage)
-- has no self-match today and must stay that way.

alter table public.team_staff add column welcomed_at timestamptz;
comment on column public.team_staff.welcomed_at is
  'Set once the linked user has seen the one-time "you were added to X" welcome card. Not shown again after.';

create function public.mark_team_staff_welcomed(p_team_staff_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.team_staff
  set welcomed_at = now()
  where id = p_team_staff_id and user_id = auth.uid();
$$;

grant execute on function public.mark_team_staff_welcomed(uuid) to authenticated;

-- Owners exit by deactivating the team (already exists, archiveTeam);
-- archiving their own staff row instead would only break their station
-- assignments while leaving the team itself active for no one to manage.
-- Leaving is silent to the head coach beyond the roster reflecting it --
-- add_team_staff re-adding this person later revives the archived row
-- (see 20260710010000) rather than stacking a duplicate.
create function public.leave_team(p_team_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from public.teams where id = p_team_id and owner_user_id = auth.uid()) then
    raise exception 'team owners cannot leave their own team';
  end if;

  update public.team_staff
  set archived_at = now()
  where team_id = p_team_id and user_id = auth.uid() and archived_at is null;
end;
$$;

grant execute on function public.leave_team(uuid) to authenticated;
