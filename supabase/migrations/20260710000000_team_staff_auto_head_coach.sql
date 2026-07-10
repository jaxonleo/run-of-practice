-- Testing-round-1 addendum §2(a)+(b): owner_user_id already grants a team
-- creator power via RLS (can_manage_team/can_access_team both check it
-- directly), but the staff list, station coach assignment
-- (stations.team_staff_id), and helper-view coach-name resolution all read
-- team_staff -- an owner with no staff row can't be assigned to a station
-- at their own practice. Personal teams only (owner_user_id set); an
-- org-owned team's creator isn't necessarily that team's head coach, so
-- org-owned teams are deliberately excluded here (revisit when orgs go
-- live). Not exception-wrapped, unlike the user_events triggers -- this is
-- core functionality a team needs, not a best-effort analytics side table.

create function public.handle_new_team_head_coach()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_first_name text;
  v_last_name text;
begin
  select first_name, last_name into v_first_name, v_last_name
  from public.profiles where id = new.owner_user_id;

  insert into public.team_staff (team_id, user_id, role, first_name, last_name)
  values (new.id, new.owner_user_id, 'head_coach', v_first_name, v_last_name);

  return new;
end;
$$;

create trigger on_team_created_add_head_coach
  after insert on public.teams
  for each row
  when (new.owner_user_id is not null)
  execute function public.handle_new_team_head_coach();

-- One-time backfill for teams created before this trigger existed. Dedupes
-- on user_id so a team where the owner already added themselves manually
-- (any role) is left alone rather than getting a second row.
insert into public.team_staff (team_id, user_id, role, first_name, last_name)
select t.id, t.owner_user_id, 'head_coach', p.first_name, p.last_name
from public.teams t
join public.profiles p on p.id = t.owner_user_id
where t.owner_user_id is not null
  and t.archived_at is null
  and not exists (
    select 1 from public.team_staff ts
    where ts.team_id = t.id and ts.user_id = t.owner_user_id
  );
