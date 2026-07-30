-- Reverses 20260721050000_org_create_team_head_coach.sql's own fix, on
-- purpose, now that the client side is being retrofitted to match: a
-- director creating a team in Org mode should be able to build out their
-- club (create teams, optionally add coaches and players) without
-- automatically becoming personal head coach of every single one. That
-- auto-insert was a real fix at the time (client-side isHeadCoach/
-- myTeamRole checks had no org-admin branch, so a director with no
-- team_staff row on a team they'd just created lost Add Coach/Add Player/
-- Edit Team entirely) -- but the actual bug was the client checks, not the
-- missing row. This migration removes the insert; the companion frontend
-- change swaps every affected screen's isHeadCoach/myTeamRole check for
-- canManageTeamInMode (already exists, already correctly treats any org
-- team as manageable by that org's director -- see constants.js), so org
-- teams stay fully manageable by their director with no personal staff row
-- required.
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

  return v_id;
end;
$$;
