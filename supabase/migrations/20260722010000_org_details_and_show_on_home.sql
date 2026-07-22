-- Two independent asks from live testing:
--
-- 1. Org edit needs a sport field (organizations had none -- teams have
--    their own sport already, this is the club's primary/overall sport for
--    display purposes on the org-edit screen).
-- 2. A coach added to a team they don't personally plan for (an org's team
--    they're not responsible for, or another coach's team they help on)
--    wants to hide it from their own Home agenda without leaving it --
--    "I want to see it if I click into the team, just not on Home." New
--    per-team-staff preference, default true (unchanged behavior for
--    everyone until they actively opt out).
alter table public.organizations add column sport text;

alter table public.team_staff add column show_on_home boolean not null default true;
comment on column public.team_staff.show_on_home is
  'Personal Home-agenda visibility preference, not an access-control column -- can_access_team/RLS are unaffected. Team-workspace pages always show full detail regardless of this flag.';

-- Self-service only, mirrors leave_team's narrow pattern: team_staff's
-- existing UPDATE policy (team_staff_update_manage) is can_manage_team-gated,
-- which a plain assistant_coach/helper doesn't pass -- but this preference
-- is about their own row and nobody else's, so it needs its own tightly
-- scoped path rather than a broader grant.
create function public.set_team_staff_show_on_home(p_team_staff_id uuid, p_show boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.team_staff
  set show_on_home = p_show
  where id = p_team_staff_id and user_id = auth.uid();
end;
$$;

grant execute on function public.set_team_staff_show_on_home(uuid, boolean) to authenticated;
