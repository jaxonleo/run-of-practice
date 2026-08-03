-- Found while cleaning up disposable Development Pulse test data: deleting
-- a team (which cascades practices -> practice_activities/stations) fails
-- with a bare FK violation whenever session_activity_log still references
-- those rows, because practice_activity_id/station_id had no ON DELETE
-- action at all (confdeltype='a'). Every other link in this same chain
-- already cascades (practices->practice_activities, practices->
-- practice_live_sessions, practice_live_sessions->session_activity_log via
-- session_id) -- a log row whose practice_activity/station was deleted
-- (which in practice only happens via that same team/practice cascade, not
-- from a coach removing one drill mid-edit -- that path is a soft
-- archived_at, not a real delete) is orphan data, not something worth
-- keeping around nulled-out the way activity_library's lineage pointers
-- are. CASCADE, not SET NULL, matches session_id's own behavior on this
-- table.
alter table public.session_activity_log
  drop constraint session_activity_log_practice_activity_id_fkey,
  add constraint session_activity_log_practice_activity_id_fkey
    foreign key (practice_activity_id) references public.practice_activities(id) on delete cascade;

alter table public.session_activity_log
  drop constraint session_activity_log_station_id_fkey,
  add constraint session_activity_log_station_id_fkey
    foreign key (station_id) references public.stations(id) on delete cascade;
