-- Superseded by player_focus_areas (structured, skill_tags-backed) --
-- migration 20260707250000. No remaining code reads or writes this column.
alter table public.players drop column focus_areas;
