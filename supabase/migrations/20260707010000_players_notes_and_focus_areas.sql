-- Two POC roster features had no home in the new schema:
--
-- notes: free-text note per player, shown on the player detail card. Real
-- schema simply never carried this column over from the POC data model.
--
-- focus_areas: freeform per-player coaching cues (up to 10), shown to
-- helpers. The *target* design for this is a skill_tags-based
-- player_focus_areas table (chunk 6, deferred to post-August per the
-- Future-State build order). This column is a deliberate stopgap so
-- coaches don't lose the feature for the August beta season -- superseded
-- by the real table when chunk 6 lands, not a permanent design.
alter table public.players add column notes text;
alter table public.players add column focus_areas text[] not null default '{}';
