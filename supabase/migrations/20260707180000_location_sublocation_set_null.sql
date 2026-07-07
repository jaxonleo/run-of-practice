-- Same pattern as the previous two migrations, checked comprehensively this
-- time instead of one table at a time: every sublocation_id/location_id FK
-- in the schema was missing ON DELETE behavior (RESTRICT by default).
-- stations/template_stations.sublocation_id are pre-existing gaps from the
-- original schema build; practice_activities/template_activities.
-- sublocation_id and practices/templates.location_id are my own additions
-- from earlier this session (20260707100000), added without ON DELETE
-- specified. All SET NULL, not CASCADE -- a practice, template, activity,
-- or station is a substantive planning entity that should survive its
-- location/area being deleted, just with that reference cleared.
alter table public.stations drop constraint stations_sublocation_id_fkey;
alter table public.stations
  add constraint stations_sublocation_id_fkey
  foreign key (sublocation_id) references public.sublocations(id) on delete set null;

alter table public.template_stations drop constraint template_stations_sublocation_id_fkey;
alter table public.template_stations
  add constraint template_stations_sublocation_id_fkey
  foreign key (sublocation_id) references public.sublocations(id) on delete set null;

alter table public.practice_activities drop constraint practice_activities_sublocation_id_fkey;
alter table public.practice_activities
  add constraint practice_activities_sublocation_id_fkey
  foreign key (sublocation_id) references public.sublocations(id) on delete set null;

alter table public.template_activities drop constraint template_activities_sublocation_id_fkey;
alter table public.template_activities
  add constraint template_activities_sublocation_id_fkey
  foreign key (sublocation_id) references public.sublocations(id) on delete set null;

alter table public.practices drop constraint practices_location_id_fkey;
alter table public.practices
  add constraint practices_location_id_fkey
  foreign key (location_id) references public.locations(id) on delete set null;

alter table public.templates drop constraint templates_location_id_fkey;
alter table public.templates
  add constraint templates_location_id_fkey
  foreign key (location_id) references public.locations(id) on delete set null;
