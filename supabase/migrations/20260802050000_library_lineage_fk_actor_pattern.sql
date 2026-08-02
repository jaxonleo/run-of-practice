-- Real bug found live during this session's disposable-test-account
-- cleanup (Goals & Insights enhancements verification, 2026-08-02): hard-
-- deleting the test account failed with
-- practice_activities_library_activity_id_fkey violated. A fourth-ish
-- instance of the already-documented "hard account deletion blocked by an
-- FK-cascade ordering issue" gap (see practice_series.created_by,
-- organizations.created_by, feedback.user_id, practice_live_sessions'
-- actor columns) -- this time not an actor-identity column but a content-
-- lineage one: activity_library.owner_user_id is `on delete cascade`, so
-- deleting a coach's account cascades into deleting their library drills,
-- but nothing referencing those drills as a *lineage pointer* had any
-- ON DELETE action at all (confirmed via pg_constraint: all four were
-- confdeltype 'a', no action).
--
-- practice_activities/stations/template_activities/template_stations all
-- already store a full copy of the drill's fields at add-time -- this
-- schema's own established comment on practice_activities says so
-- explicitly ("Full copy of whatever drill/template-activity this came
-- from... library_activity_id and template_activity_id are lineage
-- pointers only; editing the source later never changes a practice that
-- already copied it"). Losing the pointer when the source is gone doesn't
-- lose any displayed content, so SET NULL is correct here, not a special
-- case -- the same actor-identity pattern this project already uses
-- everywhere else for "historical truth that should outlive the thing it
-- points at."
alter table public.practice_activities drop constraint practice_activities_library_activity_id_fkey;
alter table public.practice_activities add constraint practice_activities_library_activity_id_fkey
  foreign key (library_activity_id) references public.activity_library(id) on delete set null;

alter table public.stations drop constraint stations_library_activity_id_fkey;
alter table public.stations add constraint stations_library_activity_id_fkey
  foreign key (library_activity_id) references public.activity_library(id) on delete set null;

alter table public.template_activities drop constraint template_activities_library_activity_id_fkey;
alter table public.template_activities add constraint template_activities_library_activity_id_fkey
  foreign key (library_activity_id) references public.activity_library(id) on delete set null;

alter table public.template_stations drop constraint template_stations_library_activity_id_fkey;
alter table public.template_stations add constraint template_stations_library_activity_id_fkey
  foreign key (library_activity_id) references public.activity_library(id) on delete set null;
