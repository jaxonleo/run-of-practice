-- Bug found live: a director creating a team via org_create_team got
-- owner_user_id = null (correct, it's org-owned) but the existing
-- handle_new_team_head_coach trigger only fires "when new.owner_user_id is
-- not null" -- so the director who just created the team never got a
-- team_staff row on it at all. Every client-side "can I manage this team"
-- check (isHeadCoach/myTeamRole in constants.js) reads team_staff rows
-- only, with no separate org-admin branch, so +Add Coach, +Add Player, and
-- Edit Team (name/sport/color) all silently vanished for the very person
-- who created the team. can_manage_team's RLS (is_org_admin branch) was
-- always correct server-side -- this was purely a missing-row bug, same
-- class as handle_new_team_head_coach's own original purpose, just not
-- extended to cover the org-owned case.
--
-- Fix: org_create_team now inserts the director's own team_staff row
-- (head_coach) in the same statement, mirroring what
-- handle_new_team_head_coach already does for personal teams. Backfilled
-- for the one team this has already happened to in production.
create or replace function public.org_create_team(
  p_organization_id uuid,
  p_name text,
  p_sport text,
  p_season_label text default null,
  p_start_date date default null,
  p_end_date date default null,
  p_timezone text default null,
  p_color_primary text default null,
  p_color_secondary text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_first_name text;
  v_last_name text;
begin
  if not public.is_org_admin(p_organization_id) then
    raise exception 'not authorized';
  end if;

  insert into public.teams (
    organization_id, name, sport, season_label, start_date, end_date,
    timezone, color_primary, color_secondary
  )
  values (
    p_organization_id, p_name, p_sport, p_season_label, p_start_date, p_end_date,
    p_timezone, p_color_primary, p_color_secondary
  )
  returning id into v_id;

  select first_name, last_name into v_first_name, v_last_name
  from public.profiles where id = auth.uid();

  insert into public.team_staff (team_id, user_id, first_name, last_name, role, added_by)
  values (v_id, auth.uid(), v_first_name, coalesce(v_last_name, ''), 'head_coach', auth.uid());

  return v_id;
end;
$$;

-- Backfill: the one org-owned team already created in production before
-- this fix, for its actual director (confirmed via org_staff -- exactly one
-- director exists for that team's org).
insert into public.team_staff (team_id, user_id, first_name, last_name, role, added_by)
select t.id, os.user_id, p.first_name, coalesce(p.last_name, ''), 'head_coach', os.user_id
from public.teams t
join public.org_staff os on os.organization_id = t.organization_id and os.archived_at is null
join public.profiles p on p.id = os.user_id
where t.organization_id is not null
  and t.archived_at is null
  and not exists (
    select 1 from public.team_staff ts where ts.team_id = t.id and ts.archived_at is null
  );
