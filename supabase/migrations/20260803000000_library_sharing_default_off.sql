-- Direct feedback from the real coach testing the Permissions feature
-- (twenty-fifth session, same day as it shipped): defaulting a head coach's
-- and assistant's personal libraries to auto-shared with each other was
-- the wrong default -- a head coach should not see an assistant's drills
-- in their own library automatically; they should go to Explore, find the
-- assistant's shelf, and copy in what they want. Flipping the column
-- defaults to false for future team_staff rows, and backfilling the 8
-- existing rows (all still sitting at the original default -- confirmed
-- via direct query that none had been explicitly toggled by anyone before
-- this fix landed, so backfilling everyone uniformly doesn't clobber a
-- real choice).
alter table public.team_staff alter column head_coach_shares_library set default false;
alter table public.team_staff alter column assistant_shares_library set default false;

update public.team_staff set head_coach_shares_library = false, assistant_shares_library = false
where archived_at is null;
