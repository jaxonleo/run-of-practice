-- Schema gap found starting stage 4 (Builder/PracticeDetail): the POC lets a
-- coach assign a coach + location to ANY drill when building a practice or
-- template, not just station blocks -- but practice_activities/
-- template_activities had no columns for it, only the station tables did.
-- Confirmed with Jax this is a real gap, not a POC affordance to drop.
--
-- Two more columns are mechanically required for the same feature to work
-- at all: sublocation_id on an activity is meaningless without knowing
-- which location it's a sublocation OF, and neither practices nor templates
-- had a location_id to anchor that -- so the per-activity Area picker (and
-- the POC's "Default Location" template setting) had no home either.
alter table public.practices add column location_id uuid references public.locations(id);
alter table public.templates add column location_id uuid references public.locations(id);

alter table public.practice_activities add column team_staff_id uuid references public.team_staff(id);
alter table public.practice_activities add column sublocation_id uuid references public.sublocations(id);

-- No team_staff_id on template_activities -- templates aren't team-scoped,
-- so there's no staff roster to assign from at template-authoring time
-- (mirrors template_stations, which also has sublocation_id but not
-- team_staff_id, for the same reason).
alter table public.template_activities add column sublocation_id uuid references public.sublocations(id);
