-- Fourth schema gap found starting stage 4: planned player assignments for
-- a station ("Generate Random Groups" in Builder) had no column at all.
-- Confirmed with Jax this should persist, not reset on every reload, even
-- though session_groups (stage 5) remains the authoritative attendance-
-- based grouping once a practice actually goes live. Simple array column,
-- same convention as players.positions/focus_areas -- no join table needed
-- for a plain list of player ids, and no cross-referential validation
-- trigger, consistent with those existing array columns.
alter table public.stations add column assignments uuid[] not null default '{}';
