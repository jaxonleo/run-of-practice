-- Goals redesign, take 2 (Jax's call, 2026-07-19): goals move up one level
-- from individual skill tags ("Catch-and-shoot," "Form / mechanics") to
-- their global category ("Shooting"). A coach thinks in categories when
-- planning practice time, not in the tag-level granularity drill-tagging
-- needs -- that granularity stays exactly as-is everywhere else (drill
-- editor, Public Library, Skills tab), this is Goals/reporting only.
--
-- team_goals had zero rows in production at the time of this migration
-- (verified before writing it), so this is a clean column swap, not a
-- data migration.
--
-- tag_visible_via_team_goal/skill_tags_select_via_team_goal
-- (20260715020000) existed only to widen skill_tags visibility for a tag
-- referenced by a goal. Goals no longer reference skill_tags at all after
-- this, so that widening has nothing left to do -- skill_categories are
-- already visible to every signed-in coach regardless of goals
-- (skill_categories_select_authenticated). Dropping both rather than
-- leaving a policy whose function references a column that no longer
-- exists.
drop policy if exists skill_tags_select_via_team_goal on public.skill_tags;
drop function if exists public.tag_visible_via_team_goal(uuid);

drop index if exists team_goals_active_unique;
alter table public.team_goals drop constraint team_goals_skill_tag_id_fkey;
alter table public.team_goals drop column skill_tag_id;
alter table public.team_goals add column skill_category_id uuid references public.skill_categories(id) on delete cascade;
alter table public.team_goals alter column skill_category_id set not null;

create unique index team_goals_active_unique
  on public.team_goals (team_id, skill_category_id) where archived_at is null;
create index team_goals_skill_category_id_idx on public.team_goals (skill_category_id);

comment on column public.team_goals.skill_category_id is
  'References skill_categories, not skill_tags -- goals are set at the category level (Shooting), not the tag level (Catch-and-shoot) beneath it.';
