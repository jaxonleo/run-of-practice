-- Org Experience handoff, part 4: coach invite flow (Sec 5).
--
-- Deliberately NOT the same shape as add_team_staff/claim_pending_team_staff
-- (team_staff auto-links on insert, no consent step -- fine for a head
-- coach adding an assistant who needs access immediately). Joining an org is
-- a bigger commitment, so org_invites requires an explicit accept: nothing
-- is granted until accept_org_invite runs. No signup-time claim trigger is
-- needed either, unlike team_staff -- an invite row is plain-text email, so
-- it's already visible the moment the invited person signs in (matched
-- against their own auth.jwt() email in the select policy below), and nothing
-- is inserted until they actually accept.
create table public.org_invites (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email text not null,
  team_id uuid references public.teams(id) on delete set null,
  team_role text,
  invited_by uuid references public.profiles(id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  responded_at timestamptz
);

comment on table public.org_invites is
  'Pending org membership invites (handoff Sec 5). team_id/team_role are optional pre-assignment -- both supported per the handoff''s recommendation to support invite-time OR post-acceptance team assignment. No direct write policy: org_invite_coach/accept_org_invite/decline_org_invite are the only way to change rows.';

-- One live pending invite per (org, email) -- re-inviting refreshes the
-- existing row via org_invite_coach rather than stacking duplicates.
create unique index org_invites_pending_unique
  on public.org_invites (organization_id, lower(email)) where status = 'pending';
create index org_invites_email_idx on public.org_invites (lower(email));

alter table public.org_invites enable row level security;

-- Director sees invites for orgs they admin; the invited person sees their
-- own pending invites once signed in, matched against their auth email --
-- never a client-supplied value.
create policy "org_invites_select" on public.org_invites
  for select to authenticated using (
    public.is_org_admin(organization_id)
    or lower(email) = lower(auth.jwt() ->> 'email')
  );

grant select on public.org_invites to authenticated;

create function public.org_invite_coach(
  p_organization_id uuid,
  p_email text,
  p_team_id uuid default null,
  p_team_role text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not public.is_org_admin(p_organization_id) then
    raise exception 'not authorized';
  end if;
  if p_team_id is not null then
    if p_team_role is null then
      raise exception 'team_role is required when pre-assigning a team';
    end if;
    if not exists (
      select 1 from public.teams where id = p_team_id and organization_id = p_organization_id
    ) then
      raise exception 'team does not belong to this organization';
    end if;
  end if;

  insert into public.org_invites (organization_id, email, team_id, team_role, invited_by)
  values (p_organization_id, lower(p_email), p_team_id, p_team_role, auth.uid())
  on conflict (organization_id, lower(email)) where status = 'pending'
  do update set team_id = excluded.team_id, team_role = excluded.team_role,
    invited_by = excluded.invited_by, created_at = now()
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function public.org_invite_coach(uuid, text, uuid, text) to authenticated;

-- Email match is server-side against auth.jwt(), matching the handoff's
-- explicit requirement -- the invite_id alone isn't enough authorization,
-- since ids aren't secret and ownership must be proven by the caller's own
-- verified email, not anything they pass in.
create function public.accept_org_invite(p_invite_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite record;
  v_first_name text;
  v_last_name text;
  v_revive_id uuid;
begin
  select * into v_invite from public.org_invites where id = p_invite_id;
  if v_invite is null then
    raise exception 'invite not found';
  end if;
  if v_invite.status <> 'pending' then
    raise exception 'invite is no longer pending';
  end if;
  if lower(v_invite.email) <> lower(auth.jwt() ->> 'email') then
    raise exception 'not authorized';
  end if;

  update public.org_invites
  set status = 'accepted', responded_at = now()
  where id = p_invite_id;

  insert into public.org_staff (organization_id, user_id, role, invited_by)
  values (v_invite.organization_id, auth.uid(), 'director', v_invite.invited_by)
  on conflict (organization_id, user_id) where archived_at is null do nothing;

  if v_invite.team_id is not null then
    select first_name, last_name into v_first_name, v_last_name
    from public.profiles where id = auth.uid();

    select id into v_revive_id from public.team_staff
    where team_id = v_invite.team_id and user_id = auth.uid() and archived_at is not null
    limit 1;

    if v_revive_id is not null then
      update public.team_staff
      set role = v_invite.team_role, archived_at = null, added_by = v_invite.invited_by,
          first_name = v_first_name, last_name = coalesce(v_last_name, '')
      where id = v_revive_id;
    else
      -- No unique constraint on (team_id, user_id) exists in this schema
      -- (add_team_staff doesn't rely on one either) -- the archived-row
      -- check above is what actually prevents a duplicate in the realistic
      -- re-invite case.
      insert into public.team_staff (team_id, user_id, first_name, last_name, role, added_by)
      values (v_invite.team_id, auth.uid(), v_first_name, coalesce(v_last_name, ''), v_invite.team_role, v_invite.invited_by);
    end if;
  end if;
end;
$$;

grant execute on function public.accept_org_invite(uuid) to authenticated;

create function public.decline_org_invite(p_invite_id uuid)
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
  if v_invite.status <> 'pending' then
    raise exception 'invite is no longer pending';
  end if;
  if lower(v_invite.email) <> lower(auth.jwt() ->> 'email') then
    raise exception 'not authorized';
  end if;

  update public.org_invites
  set status = 'declined', responded_at = now()
  where id = p_invite_id;
end;
$$;

grant execute on function public.decline_org_invite(uuid) to authenticated;
