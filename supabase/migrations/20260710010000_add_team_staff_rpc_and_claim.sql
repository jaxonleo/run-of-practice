-- Testing-round-1 addendum §2(c)+(d): route staff-adding through a
-- SECURITY DEFINER RPC so the email->existing-account match happens
-- server-side and never leaks to the client -- the UI must show identical
-- copy whether or not an account already exists for the given email (mild
-- but real privacy leak otherwise, hence doing the lookup here rather than
-- returning "found"/"not found" to the caller). Re-adding someone who
-- previously left (see §2(g), leave_team, a later migration) revives their
-- archived row instead of stacking a duplicate.

alter table public.team_staff add column added_by uuid references public.profiles(id) on delete set null;
comment on column public.team_staff.added_by is
  'Who added this staff row, for the "suggest staff you already added on other teams" feature (testing-round-1 addendum §5). Not an access-control column.';

create function public.add_team_staff(
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
  v_matched_user_id uuid;
  v_revive_id uuid;
  v_id uuid;
begin
  if not public.can_manage_team(p_team_id) then
    raise exception 'not authorized';
  end if;

  select id into v_matched_user_id from public.profiles where lower(email) = lower(p_email);

  select id into v_revive_id from public.team_staff
  where team_id = p_team_id and lower(invite_email) = lower(p_email) and archived_at is not null
  limit 1;

  if v_revive_id is not null then
    update public.team_staff
    set user_id = v_matched_user_id, first_name = p_first_name, last_name = p_last_name,
        role = p_role, archived_at = null, added_by = auth.uid()
    where id = v_revive_id
    returning id into v_id;
  else
    insert into public.team_staff (team_id, user_id, invite_email, first_name, last_name, role, added_by)
    values (p_team_id, v_matched_user_id, p_email, p_first_name, p_last_name, p_role, auth.uid())
    returning id into v_id;
  end if;

  return v_id;
end;
$$;

grant execute on function public.add_team_staff(uuid, text, text, text, text) to authenticated;

-- Covers the invited-then-signs-up ordering; add_team_staff above covers
-- signed-up-then-invited. Together, zero recurring/boot-time checks needed.
create function public.claim_pending_team_staff()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.team_staff
  set user_id = new.id
  where user_id is null
    and archived_at is null
    and lower(invite_email) = lower(new.email);
  return new;
end;
$$;

create trigger on_profile_created_claim_team_staff
  after insert on public.profiles
  for each row
  execute function public.claim_pending_team_staff();
