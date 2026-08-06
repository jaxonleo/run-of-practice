-- Practice Setup rework: a plain (non-station) drill's assigned coach used
-- to only ever be a real roster team_staff_id, unlike stations (which
-- already support helper_name for a non-roster helper leading that
-- station). Direct feedback wants the same "assign a coach or type in a
-- non-roster helper" picker for every drill in the Run of Practice list,
-- not just stations, so practice_activities needs the same column stations
-- already have.
alter table public.practice_activities add column helper_name text;
