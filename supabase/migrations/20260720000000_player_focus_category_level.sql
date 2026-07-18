-- Per-tag notes turned out to be too many fields on the player card --
-- Shooting alone had four (Form/Mechanics, Catch-and-Shoot, Off the
-- Dribble, Free Throws). One note per category is enough ("Shooting:
-- keep the elbow in"), so player_focus_areas now keys off
-- skill_categories instead of individual skill_tags. skill_tag_id is
-- kept and made optional rather than dropped -- cheap to preserve
-- whatever early rows exist, and nothing here depends on it being gone.
alter table public.player_focus_areas alter column skill_tag_id drop not null;
alter table public.player_focus_areas add column category_id uuid references public.skill_categories(id) on delete cascade;
alter table public.player_focus_areas drop constraint player_focus_areas_player_id_skill_tag_id_key;
alter table public.player_focus_areas add constraint player_focus_areas_player_id_category_id_key unique (player_id, category_id);
