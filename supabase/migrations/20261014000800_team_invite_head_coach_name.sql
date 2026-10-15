-- Free / Pro / Organization packaging, Phase C: the team owner's first
-- name for an invite, so the invitee's "team is full" notice (catalog T2a)
-- can say who to ask. The invitee cannot read the owner's profile through
-- RLS, so this returns just that one field, and only to the invitee (the
-- same email match accept_team_invite uses) while the invite is pending.
create function public.get_team_invite_head_coach_name(p_invite_id uuid)
returns text
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(nullif(trim(pr.first_name), ''), 'the head coach')
  from public.team_invites ti
  join public.teams t on t.id = ti.team_id
  left join public.profiles pr on pr.id = t.owner_user_id
  where ti.id = p_invite_id
    and ti.status = 'pending'
    and lower(ti.email) = lower(auth.jwt() ->> 'email');
$$;

revoke all on function public.get_team_invite_head_coach_name(uuid) from public;
grant execute on function public.get_team_invite_head_coach_name(uuid) to authenticated;
