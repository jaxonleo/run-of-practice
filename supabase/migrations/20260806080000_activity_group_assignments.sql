-- Direct feedback: when Partners/Groups is picked for a plain (non-station)
-- drill, a coach should be able to manually decide who lands in which group
-- back in Builder, instead of it always being silently randomized fresh
-- once attendance is taken live. Stations already carry their own
-- per-station `assignments` array (on the stations table); plain activities
-- had no equivalent column to seed groups from, so add one here. Stored as
-- an array of player-id arrays (one per group/pair), against the full
-- roster since attendance isn't known yet at plan time -- Practice Setup
-- filters it down to whoever actually shows up. Left null/empty, behavior
-- is unchanged: random split generated fresh once attendance is taken.
alter table public.practice_activities add column group_assignments jsonb;
alter table public.template_activities add column group_assignments jsonb;
