-- fetchMyTeams needs to hide deactivated coaches from teammates' rosters,
-- but profiles has deliberately no general cross-user SELECT policy (see
-- its own comment: "No cross-user profile reads are needed anywhere in
-- this schema -- team_staff stores display names directly for exactly
-- this reason"). Adding one would leak email/name to any teammate just to
-- answer one boolean. Instead, a narrow security-definer function that
-- returns only the user_ids to hide, gated by can_access_team per row so a
-- caller can't probe teams they don't belong to.
create function public.get_deactivated_staff_user_ids(p_team_ids uuid[])
returns uuid[]
language sql security definer stable set search_path = public as $$
  select coalesce(array_agg(distinct p.id), array[]::uuid[])
  from public.profiles p
  join public.team_staff ts on ts.user_id = p.id
  where ts.team_id = any(p_team_ids)
    and ts.archived_at is null
    and p.deactivated_at is not null
    and public.can_access_team(ts.team_id)
$$;

grant execute on function public.get_deactivated_staff_user_ids(uuid[]) to authenticated;
