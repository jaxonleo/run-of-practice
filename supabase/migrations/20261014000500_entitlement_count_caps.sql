-- Free / Pro / Organization packaging, Phase B part 2 of 4: server-side
-- count caps at every write path that can create (or bring back) a counted
-- thing. Each cap is a BEFORE trigger, so it covers direct table writes,
-- every RPC, and every archive-restore path in one place, and raises the
-- coded ENTITLEMENT_LIMIT error before RLS's generic message would.
--
-- Triggers are SECURITY DEFINER so the count sees every row, not just the
-- ones the caller's RLS shows. They only engage inside a request
-- (auth.uid() not null), so migrations and service-role maintenance are
-- never blocked. Nothing here deletes or archives anything: a coach already
-- over a cap keeps every item, only adding another is refused.

-- 1. Teams: active personal teams (teams.personal_count, handoff key
-- teams.owned_active) and contracted org teams (org.teams, 10% grace,
-- rounded up). Fires on insert and on any update that makes a team newly
-- count (restore from archive, or moving from an org to personal).
create function public.enforce_team_caps()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if auth.uid() is null or new.archived_at is not null then
    return new;
  end if;
  if tg_op = 'UPDATE'
     and old.archived_at is null
     and old.organization_id is not distinct from new.organization_id
     and old.owner_user_id is not distinct from new.owner_user_id then
    return new;
  end if;

  if new.organization_id is null then
    select count(*)::integer into v_count from public.teams
      where owner_user_id = new.owner_user_id and organization_id is null
        and archived_at is null and id <> new.id;
    perform public.enforce_counted_feature('teams.personal_count', v_count, 'user', new.owner_user_id, null);
  else
    select count(*)::integer into v_count from public.teams
      where organization_id = new.organization_id and archived_at is null and id <> new.id;
    perform public.enforce_counted_feature('org.teams', v_count, 'organization', null, new.organization_id, 10);
  end if;
  return new;
end;
$$;

create trigger enforce_team_caps
  before insert or update of archived_at, organization_id, owner_user_id on public.teams
  for each row execute function public.enforce_team_caps();

-- 2. Rostered staff (teams.assistants). Counts every non-archived staff row
-- except the team owner's own, plus every pending invite. Head-coach-role
-- rows count too: otherwise "Head Coach" would be an unlimited loophole
-- around the assistant cap. Declined/cancelled/accepted invites do not.
create function public.team_staff_cap_count(p_team_id uuid, p_exclude_staff_id uuid default null)
returns integer
language sql
security definer
stable
set search_path = public
as $$
  select
    (select count(*)::integer from public.team_staff ts
      join public.teams t on t.id = ts.team_id
      where ts.team_id = p_team_id and ts.archived_at is null
        and ts.user_id is distinct from t.owner_user_id
        and ts.id is distinct from p_exclude_staff_id)
    +
    (select count(*)::integer from public.team_invites ti
      where ti.team_id = p_team_id and ti.status = 'pending');
$$;

revoke all on function public.team_staff_cap_count(uuid, uuid) from public;

-- Staff rows becoming active: direct insert, accept_team_invite's insert or
-- revive (the invite is already marked accepted by then, so it no longer
-- counts as pending, and a refusal rolls that back so the invite stays
-- pending), and a head coach reviving an archived row.
create function public.enforce_team_staff_cap()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or new.archived_at is not null then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.archived_at is null then
    return new;
  end if;
  if new.user_id is not null and new.user_id = (select owner_user_id from public.teams where id = new.team_id) then
    return new;
  end if;
  declare
    s record;
  begin
    select * into s from public.team_entitlement_subject(new.team_id);
    perform public.enforce_counted_feature('teams.assistants',
      public.team_staff_cap_count(new.team_id, new.id), s.subject_type, s.user_id, s.organization_id);
  end;
  return new;
end;
$$;

create trigger enforce_team_staff_cap
  before insert or update of archived_at on public.team_staff
  for each row execute function public.enforce_team_staff_cap();

-- invite_team_staff: refuse a new (or re-sent, non-pending) invite at the
-- cap. Re-sending an invite that is already pending changes nothing.
create or replace function public.invite_team_staff(p_team_id uuid, p_email text, p_first_name text, p_last_name text, p_role text)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_id uuid;
  v_status text;
  s record;
begin
  if not public.can_manage_team(p_team_id) then
    raise exception 'not authorized';
  end if;

  select id, status into v_id, v_status from public.team_invites
  where team_id = p_team_id and lower(email) = lower(p_email)
  limit 1;

  if v_status is distinct from 'pending' then
    select * into s from public.team_entitlement_subject(p_team_id);
    perform public.enforce_counted_feature('teams.assistants',
      public.team_staff_cap_count(p_team_id), s.subject_type, s.user_id, s.organization_id);
  end if;

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
$function$;

-- 3. Personal drills (library.personal_drills). Insert was already capped
-- by activity_library_insert_manage (kept as a second line); this adds the
-- coded error and the archive-restore path. Catalog rows are never counted.
create function public.enforce_personal_drill_cap()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if auth.uid() is null or new.archived_at is not null
     or new.organization_id is not null or new.owner_user_id is null
     or new.source_catalog_id is not null then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.archived_at is null and old.organization_id is null then
    return new;
  end if;
  select count(*)::integer into v_count from public.activity_library
    where owner_user_id = new.owner_user_id and organization_id is null
      and archived_at is null and id <> new.id;
  perform public.enforce_counted_feature('library.personal_drills', v_count, 'user', new.owner_user_id, null);
  return new;
end;
$$;

create trigger enforce_personal_drill_cap
  before insert or update of archived_at, organization_id on public.activity_library
  for each row execute function public.enforce_personal_drill_cap();

-- 4. Personal templates (library.personal_templates, handoff key
-- library.templates). Org templates (organization_id not null) are uncapped.
create function public.can_create_personal_template()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select public.can_use_counted_feature(
    'library.personal_templates',
    (select count(*)::integer from public.templates
      where owner_user_id = auth.uid() and organization_id is null and archived_at is null),
    'user', auth.uid(), null
  );
$$;

revoke all on function public.can_create_personal_template() from public;
grant execute on function public.can_create_personal_template() to authenticated;

create function public.enforce_personal_template_cap()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if auth.uid() is null or new.archived_at is not null
     or new.organization_id is not null or new.owner_user_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.archived_at is null and old.organization_id is null then
    return new;
  end if;
  select count(*)::integer into v_count from public.templates
    where owner_user_id = new.owner_user_id and organization_id is null
      and archived_at is null and id <> new.id;
  perform public.enforce_counted_feature('library.personal_templates', v_count, 'user', new.owner_user_id, null);
  return new;
end;
$$;

create trigger enforce_personal_template_cap
  before insert or update of archived_at, organization_id on public.templates
  for each row execute function public.enforce_personal_template_cap();
