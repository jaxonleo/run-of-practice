-- Goals feature (ROP-Goals-TeamNav-Handoff.md §2.7, decision D4). Opt-in
-- activity type for deliberate non-drill time (water breaks, team talks).
-- No library link, no tags -- excluded from the goal denominator entirely
-- on both the planned and actual sides (§3.1 rule 4). Builder is not
-- changed to nag/prompt coaches toward it; adoption is being observed via
-- the derived "Other / transitions" metric, not forced.
--
-- Constraint names verified against the live schema before writing this
-- (practice_activities_type_check / template_activities_type_check --
-- confirmed via pg_constraint, unchanged since the 20260707130000 migration
-- that added 'checklist').
alter table public.practice_activities drop constraint practice_activities_type_check;
alter table public.practice_activities add constraint practice_activities_type_check
  check (type in ('activity', 'station_block', 'checklist', 'break'));

alter table public.template_activities drop constraint template_activities_type_check;
alter table public.template_activities add constraint template_activities_type_check
  check (type in ('activity', 'station_block', 'checklist', 'break'));
