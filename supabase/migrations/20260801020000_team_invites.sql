-- Real gap found live (2026-08-01): add_team_staff auto-links and grants
-- access immediately, with zero consent step -- fine when it shipped
-- (testing-round-1 addendum §2(c)+(d)), but a head coach just added a real
-- assistant and got direct feedback that they should have seen the same
-- kind of accept/decline experience org_invites already gives org members,
-- not silent access. Mirrors org_invites' shape closely on purpose (see
-- that migration's own comment on why a real consent gate needs a separate
-- table rather than team_staff's auto-link-on-insert pattern) -- same
-- pending/accepted/declined/cancelled states, same email-matched-against-
-- auth.jwt() RLS, same director-cancel carve-out. Unlike team_staff's old
-- claim_pending_team_staff trigger, no signup-time claim trigger is needed
-- here either, for the same reason org_invites never needed one: a plain-
-- text email row is already visible the moment the invited person signs
-- in, matched against their own verified email, so nothing has to
-- "pre-link" a user_id before they ever see it.
create table public.team_invites (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  email text not null,
  first_name text not null,
  last_name text,
  role text not null check (role in ('head_coach', 'assistant_coach', 'helper')),
  invited_by uuid references public.profiles(id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'cancelled')),
  created_at timestamptz not null default now(),
  responded_at timestamptz
);

comment on table public.team_invites is
  'Pending team_staff invites, requiring explicit accept/decline. Nothing is inserted into team_staff until accept_team_invite runs. Names/role are captured here (not looked up from profiles) so a head coach''s own naming for their roster is preserved, same convention team_staff itself already uses.';

create unique index team_invites_pending_unique
  on public.team_invites (team_id, lower(email)) where status = 'pending';
create index team_invites_email_idx on public.team_invites (lower(email));

alter table public.team_invites enable row level security;

-- Manager sees every invite for their team (any status, so declined ones
-- stay visible on the roster); the invited person sees their own invites
-- once signed in, matched against their verified auth email -- never a
-- client-supplied value.
create policy "team_invites_select" on public.team_invites
  for select to authenticated using (
    public.can_manage_team(team_id)
    or lower(email) = lower(auth.jwt() ->> 'email')
  );

grant select on public.team_invites to authenticated;

-- Upserts by (team_id, email) regardless of the existing row's status, so
-- this single function covers a fresh invite, a resend of a still-pending
-- one, and re-inviting after a decline/cancel -- all without stacking
-- duplicate rows for the same person.
create function public.invite_team_staff(
  p_team_id uuid,
  p_email text,
  p_first_name text,
  p_last_name text,
  p_role text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not public.can_manage_team(p_team_id) then
    raise exception 'not authorized';
  end if;

  select id into v_id from public.team_invites
  where team_id = p_team_id and lower(email) = lower(p_email)
  limit 1;

  if v_id is not null then
    update public.team_invites
    set first_name = p_first_name, last_name = p_last_name, role = p_role,
        invited_by = auth.uid(), status = 'pending', created_at = now(), responded_at = null
    where id = v_id;
  else
    insert into public.team_invites (team_id, email, first_name, last_name, role, invited_by)
    values (p_team_id, lower(p_email), p_first_name, p_last_name, p_role, auth.uid())
    returning id into v_id;
  end if;

  return v_id;
end;
$$;

grant execute on function public.invite_team_staff(uuid, text, text, text, text) to authenticated;

-- Same email-match-against-auth.jwt() authorization accept_org_invite
-- already uses -- the invite id alone isn't proof of identity, since ids
-- aren't secret. Reuses an archived team_staff row for this (team,user) if
-- one exists (someone who left and is being re-invited) rather than
-- stacking a duplicate -- same revival pattern add_team_staff used to do.
create function public.accept_team_invite(p_invite_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite record;
  v_revive_id uuid;
begin
  select * into v_invite from public.team_invites where id = p_invite_id;
  if v_invite is null then
    raise exception 'invite not found';
  end if;
  if v_invite.status <> 'pending' then
    raise exception 'invite is no longer pending';
  end if;
  if lower(v_invite.email) <> lower(auth.jwt() ->> 'email') then
    raise exception 'not authorized';
  end if;

  update public.team_invites
  set status = 'accepted', responded_at = now()
  where id = p_invite_id;

  select id into v_revive_id from public.team_staff
  where team_id = v_invite.team_id and user_id = auth.uid() and archived_at is not null
  limit 1;

  if v_revive_id is not null then
    update public.team_staff
    set role = v_invite.role, archived_at = null, added_by = v_invite.invited_by,
        first_name = v_invite.first_name, last_name = coalesce(v_invite.last_name, '')
    where id = v_revive_id;
  else
    insert into public.team_staff (team_id, user_id, first_name, last_name, role, added_by)
    values (v_invite.team_id, auth.uid(), v_invite.first_name, coalesce(v_invite.last_name, ''), v_invite.role, v_invite.invited_by);
  end if;
end;
$$;

grant execute on function public.accept_team_invite(uuid) to authenticated;

create function public.decline_team_invite(p_invite_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite record;
begin
  select * into v_invite from public.team_invites where id = p_invite_id;
  if v_invite is null then
    raise exception 'invite not found';
  end if;
  if v_invite.status <> 'pending' then
    raise exception 'invite is no longer pending';
  end if;
  if lower(v_invite.email) <> lower(auth.jwt() ->> 'email') then
    raise exception 'not authorized';
  end if;

  update public.team_invites
  set status = 'declined', responded_at = now()
  where id = p_invite_id;
end;
$$;

grant execute on function public.decline_team_invite(uuid) to authenticated;

-- Head-coach side "Clear" -- callable on a still-pending invite (e.g. sent
-- to the wrong person entirely) or an already-declined one (clearing it off
-- the roster view). Gated on can_manage_team, not the invitee's email,
-- since it's the sender clearing their own outgoing request.
create function public.cancel_team_invite(p_invite_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite record;
begin
  select * into v_invite from public.team_invites where id = p_invite_id;
  if v_invite is null then
    raise exception 'invite not found';
  end if;
  if not public.can_manage_team(v_invite.team_id) then
    raise exception 'not authorized';
  end if;
  if v_invite.status not in ('pending', 'declined') then
    raise exception 'invite cannot be cleared from its current state';
  end if;

  update public.team_invites
  set status = 'cancelled', responded_at = now()
  where id = p_invite_id;
end;
$$;

grant execute on function public.cancel_team_invite(p_invite_id uuid) to authenticated;

-- Head-coach side "Edit" -- fixes a typo'd email/name/role on a still-
-- pending or already-declined invite (e.g. a stranger with that email
-- declined a misaddressed invite) and puts it back to pending, same as a
-- fresh send. Not offered once accepted -- editing a real member's details
-- goes through update_staff on team_staff instead.
create function public.edit_team_invite(
  p_invite_id uuid,
  p_email text,
  p_first_name text,
  p_last_name text,
  p_role text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite record;
begin
  select * into v_invite from public.team_invites where id = p_invite_id;
  if v_invite is null then
    raise exception 'invite not found';
  end if;
  if not public.can_manage_team(v_invite.team_id) then
    raise exception 'not authorized';
  end if;
  if v_invite.status not in ('pending', 'declined') then
    raise exception 'invite cannot be edited from its current state';
  end if;

  update public.team_invites
  set email = lower(p_email), first_name = p_first_name, last_name = p_last_name, role = p_role,
      status = 'pending', created_at = now(), responded_at = null
  where id = p_invite_id;
end;
$$;

grant execute on function public.edit_team_invite(uuid, text, text, text, text) to authenticated;

-- Migrate existing team_staff rows that were never actually claimed
-- (user_id null -- nobody could act as that person yet, so this never
-- represented real membership) into team_invites as pending, then drop
-- them from team_staff. Any already-linked, already-active row is left
-- completely untouched -- per direct confirmation, an existing active
-- assistant should not lose access or see an unexpected invite prompt; the
-- new consent flow only applies to invites sent going forward.
insert into public.team_invites (team_id, email, first_name, last_name, role, invited_by, status, created_at)
select team_id, lower(invite_email), first_name, last_name, role, added_by, 'pending', created_at
from public.team_staff
where user_id is null and archived_at is null and invite_email is not null;

delete from public.team_staff
where user_id is null and archived_at is null and invite_email is not null;

-- Superseded entirely by invite_team_staff/accept_team_invite above.
drop trigger if exists on_profile_created_claim_team_staff on public.profiles;
drop function if exists public.claim_pending_team_staff();
drop function if exists public.add_team_staff(uuid, text, text, text, text);

-- Superseded by the team_invites-based notify trigger below -- every real
-- team_staff insert going forward only ever comes from accept_team_invite
-- (a real person, already consenting) or the team-creation head-coach
-- trigger (a coach adding themselves), neither of which needs a "you were
-- added, please respond" email.
drop trigger if exists on_team_staff_added_notify on public.team_staff;
drop function if exists public.notify_team_staff_added();

-- Fires the same deployed notify-team-staff-added function (reused as-is,
-- now rewritten to read team_invites instead of team_staff -- see that
-- function's own updated comment) on a fresh invite, and again whenever an
-- invite is resent/edited back to pending. Reuses the existing
-- 'team_staff_notify_webhook_secret' vault entry -- it's just a shared
-- webhook auth value, no reason to mint a second one for the same
-- function's URL.
create function public.notify_team_invite()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secret text;
begin
  begin
    select decrypted_secret into v_secret
    from vault.decrypted_secrets
    where name = 'team_staff_notify_webhook_secret';

    perform net.http_post(
      url := 'https://bepoojcbizxhqadrytjq.functions.supabase.co/notify-team-staff-added',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', v_secret),
      body := jsonb_build_object('invite_id', new.id)
    );
  exception when others then
    raise warning 'notify_team_invite failed to enqueue for invite %: %', new.id, sqlerrm;
  end;
  return new;
end;
$$;

create trigger on_team_invite_created_notify
  after insert on public.team_invites
  for each row execute function public.notify_team_invite();

create trigger on_team_invite_resent_notify
  after update on public.team_invites
  for each row
  when (new.status = 'pending' and old.status is distinct from 'pending')
  execute function public.notify_team_invite();
