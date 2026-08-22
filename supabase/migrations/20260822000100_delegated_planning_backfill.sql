-- Backfill for 20260822000000_delegated_planning_schema.sql, so existing
-- rows aren't silently blank/behind the new columns the moment this ships.

-- Preserve every currently-working delegate/location pairing: any location
-- already referenced by an existing (non-archived) practice is marked
-- available to that team's planners going forward, so flipping the RLS
-- rule to explicit opt-in (companion RLS migration) doesn't retroactively
-- break a delegate who could already schedule at "the team's regular
-- spot" yesterday. Anything not yet used by a practice stays opt-in only.
update public.locations l
set available_to_team_planners = true
where exists (
  select 1 from public.practices p
  where p.location_id = l.id and p.archived_at is null
);

-- Snapshot the location/sublocation names already in place for every
-- existing practice/activity/station, so historical rows aren't blank
-- until their next (possibly never) edit.
update public.practices p
set location_name_snapshot = l.name, location_address_snapshot = l.address
from public.locations l
where p.location_id = l.id and p.location_name_snapshot is null;

update public.practice_activities pa
set sublocation_name_snapshot = sl.name
from public.sublocations sl
where pa.sublocation_id = sl.id and pa.sublocation_name_snapshot is null;

update public.stations stn
set sublocation_name_snapshot = sl.name
from public.sublocations sl
where stn.sublocation_id = sl.id and stn.sublocation_name_snapshot is null;

-- Best-effort recovery of skill-tag attribution for already-built practices
-- (their source drills are, for now, still live -- this is the only chance
-- to snapshot before any of them are ever deleted).
update public.practice_activities pa
set tag_snapshot = t.tag_ids
from (
  select activity_library_id, array_agg(skill_tag_id) as tag_ids
  from public.drill_tags group by activity_library_id
) t
where pa.library_activity_id = t.activity_library_id and pa.tag_snapshot is null;

update public.stations stn
set tag_snapshot = t.tag_ids
from (
  select activity_library_id, array_agg(skill_tag_id) as tag_ids
  from public.drill_tags group by activity_library_id
) t
where stn.library_activity_id = t.activity_library_id and stn.tag_snapshot is null;
