-- Real gap found live: Jax invited sleo81613@gmail.com, the notification
-- email never arrived (no org-invite email exists yet, a known prior gap --
-- see accept/decline_org_invite's own comments), and the invite has sat
-- stuck as "Invited, awaiting response" with no way to clear it. Adds a
-- 'cancelled' status plus a director-side cancel RPC, mirroring
-- accept_org_invite/decline_org_invite's shape but gated on is_org_admin
-- instead of the invitee's own email (the director who sent it is the one
-- who needs to retract it, not the recipient).
alter table public.org_invites drop constraint org_invites_status_check;
alter table public.org_invites add constraint org_invites_status_check
  check (status in ('pending', 'accepted', 'declined', 'cancelled'));

create function public.cancel_org_invite(p_invite_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite record;
begin
  select * into v_invite from public.org_invites where id = p_invite_id;
  if v_invite is null then
    raise exception 'invite not found';
  end if;
  if not public.is_org_admin(v_invite.organization_id) then
    raise exception 'not authorized';
  end if;
  if v_invite.status <> 'pending' then
    raise exception 'invite is no longer pending';
  end if;

  update public.org_invites
  set status = 'cancelled', responded_at = now()
  where id = p_invite_id;
end;
$$;

grant execute on function public.cancel_org_invite(uuid) to authenticated;
