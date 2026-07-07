-- Two sources: stations.team_staff_id had this gap from the original
-- schema build (pre-existing, same class of bug as the equipment join
-- tables); practice_activities.team_staff_id is my own oversight from
-- earlier this session (added in 20260707100000 with no ON DELETE
-- specified, defaulting to RESTRICT). Confirmed via the same delete-user
-- repro: deleting a team_staff member (which cascades when their
-- team/owner is deleted) was blocked by "stations_team_staff_id_fkey".
-- Unlike the equipment join tables, these aren't pure link rows -- a
-- station/activity is a real practice-planning entity that should survive
-- its assigned coach disappearing, just with the assignment cleared, so
-- SET NULL is correct here, not CASCADE.
alter table public.practice_activities drop constraint practice_activities_team_staff_id_fkey;
alter table public.practice_activities
  add constraint practice_activities_team_staff_id_fkey
  foreign key (team_staff_id) references public.team_staff(id) on delete set null;

alter table public.stations drop constraint stations_team_staff_id_fkey;
alter table public.stations
  add constraint stations_team_staff_id_fkey
  foreign key (team_staff_id) references public.team_staff(id) on delete set null;
