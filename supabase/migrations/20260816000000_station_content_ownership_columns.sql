-- Multi-Coach Builder: a station's own drills/notes/equipment can now be
-- edited independently by its assigned coach (see update_station_content
-- RPC in the next migration), pre-live and possibly simultaneously with
-- other coaches editing their own stations. The head coach's summary view
-- needs to show "last edited by Coach X, N minutes ago" per station --
-- same actor-identity pattern already used for practices.created_by/
-- last_edited_by (20260805140000_practice_authors.sql), just per-station
-- instead of per-practice.
alter table public.stations add column station_updated_at timestamptz;
alter table public.stations add column station_updated_by uuid references public.team_staff(id) on delete set null;

comment on column public.stations.station_updated_at is
  'Set only by update_station_content -- when this station''s own content (not its skeleton position/leader) was last saved. Null until the first per-station save.';
comment on column public.stations.station_updated_by is
  'team_staff.id of whoever last called update_station_content for this station -- may be the head coach or the assigned coach, since either can write (see the RPC''s own authorization check).';
