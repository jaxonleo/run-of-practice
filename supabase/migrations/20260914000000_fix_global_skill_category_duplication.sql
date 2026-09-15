-- Football/Lacrosse/Soccer/Volleyball skill_categories were double-seeded at
-- the database level sometime after 20260718040000_seed_public_library_taxonomy.sql
-- first ran (that migration's skill_categories insert has no ON CONFLICT/NOT
-- EXISTS guard, unlike its own skill_tags insert right below it -- the tags
-- insert's NOT EXISTS guard checks per category_id, not per (sport, name), so
-- when skill_categories got a second set of 7 rows per sport, the tags insert
-- happily fanned out a fresh set of 4 global tags under each new duplicate
-- category_id too, since none existed yet under that specific id).
-- Confirmed via direct query before writing this: 28 duplicate (sport, name)
-- skill_categories pairs across these 4 sports (should be 7 each, are 14),
-- 56 duplicate global skill_tags (should be 28 each, are 56). Every
-- duplicate pair splits cleanly on created_at: the original 20260718040000
-- run's rows (2026-07-19) carry every real drill_tags reference; the later
-- rows (2026-07-24) are fully orphaned twins with zero references. Baseball/
-- Basketball are unaffected -- their skill_categories only ever came from
-- 20260707090000, never touched by the unguarded insert. 0 player_focus_areas
-- rows affected (checked).
--
-- Same two-part shape as 20260727010000_fix_baseball_basketball_tag_duplication.sql:
-- re-point real references off the orphan before removing it, then remove.
-- Here the merge happens at both levels -- orphan tags get merged into their
-- name-matching twin under the surviving category, then the orphan
-- categories themselves are deleted.

-- Per duplicated (sport, name), keep the earliest-created row -- ties never
-- occur in practice (all 28 pairs split by five days) but min(id) breaks any
-- that would.
create temp table keep_category as
select distinct on (sc.sport, sc.name)
  sc.sport, sc.name, sc.id as keep_id
from public.skill_categories sc
where sc.sport in ('Football', 'Lacrosse', 'Soccer', 'Volleyball')
order by sc.sport, sc.name, sc.created_at asc, sc.id asc;

create temp table dup_category as
select sc.id as dup_id, kc.keep_id
from public.skill_categories sc
join keep_category kc on kc.sport = sc.sport and kc.name = sc.name
where sc.id <> kc.keep_id;

-- Map each orphan-category tag onto its name-matching twin under the
-- surviving category (same scope + name; all rows here are scope='global',
-- but matched on scope too in case a coach had already added an org/coach
-- tag under the orphan category before this fix ran).
create temp table dup_tag_map as
select dup_t.id as dup_tag_id, keep_t.id as keep_tag_id
from public.skill_tags dup_t
join dup_category dc on dc.dup_id = dup_t.category_id
join public.skill_tags keep_t on keep_t.category_id = dc.keep_id
  and keep_t.scope = dup_t.scope and keep_t.name = dup_t.name
  and coalesce(keep_t.organization_id::text,'') = coalesce(dup_t.organization_id::text,'')
  and coalesce(keep_t.owner_user_id::text,'') = coalesce(dup_t.owner_user_id::text,'');

-- A drill already tagged with both the orphan tag and its surviving twin
-- would violate drill_tags' UNIQUE(activity_library_id, skill_tag_id) once
-- re-pointed -- drop the redundant row first (the surviving tag already
-- covers it). Not expected to fire given the orphans have zero references,
-- kept for safety/symmetry with the earlier fix.
delete from public.drill_tags dt
using dup_tag_map dtm
where dt.skill_tag_id = dtm.dup_tag_id
  and exists (
    select 1 from public.drill_tags dt2
    where dt2.activity_library_id = dt.activity_library_id and dt2.skill_tag_id = dtm.keep_tag_id
  );

update public.drill_tags dt set skill_tag_id = dtm.keep_tag_id
from dup_tag_map dtm where dt.skill_tag_id = dtm.dup_tag_id;

update public.player_focus_areas pfa set skill_tag_id = dtm.keep_tag_id
from dup_tag_map dtm where pfa.skill_tag_id = dtm.dup_tag_id;

delete from public.skill_tags st using dup_tag_map dtm where st.id = dtm.dup_tag_id;

-- Any orphan-category tag with no name match on the surviving category
-- (wouldn't happen for the 4x28 seeded set matched above, but could for a
-- one-off coach/org tag someone added under the orphan category before this
-- fix ran) -- re-point it onto the surviving category instead of deleting,
-- so nothing a coach created is silently lost.
update public.skill_tags st set category_id = dc.keep_id
from dup_category dc
where st.category_id = dc.dup_id;

delete from public.skill_categories sc using dup_category dc where sc.id = dc.dup_id;

drop table dup_tag_map;
drop table dup_category;
drop table keep_category;
