-- Baseball/Basketball skill tags were double-seeded. 20260711000000 gives
-- every coach a personal scope='coach' copy of the Baseball/Basketball
-- starter tags (so they could individually archive one without hiding it
-- for other coaches, since scope='global' rows can't be managed per-coach).
-- 20260718040000 later gave Football/Soccer/Lacrosse/Volleyball real
-- scope='global' rows directly -- and, in the same migration, upgraded
-- Baseball/Basketball's starter tags to real scope='global' rows too,
-- without removing the older per-coach copy mechanism for those two sports.
-- Net effect: every coach has had two identically-named tags (their own
-- private copy + the now-global one) in the same category ever since.
-- Confirmed via direct query before writing this: 947 duplicate coach-scope
-- rows across 17 coaches, 15 real drill_tags rows pointing at a duplicate
-- (not just the global twin), 0 player_focus_areas rows affected.
--
-- Fix has two parts: stop creating new duplicates (the function below),
-- and clean up the ones that already exist (the DML below). A coach's own
-- genuinely custom tags (name doesn't exactly match a global tag in the
-- same category) are untouched by any of this -- only exact
-- (category_id, name) matches against an existing global tag are treated
-- as the seeded duplicate.

-- Re-point any real drill/player-focus references from the duplicate
-- coach-scope tag onto the global tag before removing the duplicate, so no
-- existing tagging is silently lost.
create temp table dup_map as
select coach_t.id as coach_tag_id, global_t.id as global_tag_id
from public.skill_tags coach_t
join public.skill_categories sc on sc.id = coach_t.category_id and sc.sport in ('Baseball', 'Basketball')
join public.skill_tags global_t on global_t.category_id = coach_t.category_id
  and global_t.name = coach_t.name and global_t.scope = 'global' and global_t.archived_at is null
where coach_t.scope = 'coach' and coach_t.archived_at is null;

-- A drill already tagged with both the duplicate and its global twin would
-- violate drill_tags' UNIQUE(activity_library_id, skill_tag_id) once
-- re-pointed -- drop the redundant row first in that case (the global tag
-- already covers it).
delete from public.drill_tags dt
using dup_map dm
where dt.skill_tag_id = dm.coach_tag_id
  and exists (
    select 1 from public.drill_tags dt2
    where dt2.activity_library_id = dt.activity_library_id and dt2.skill_tag_id = dm.global_tag_id
  );

update public.drill_tags dt set skill_tag_id = dm.global_tag_id
from dup_map dm where dt.skill_tag_id = dm.coach_tag_id;

update public.player_focus_areas pfa set skill_tag_id = dm.global_tag_id
from dup_map dm where pfa.skill_tag_id = dm.coach_tag_id;

delete from public.skill_tags st using dup_map dm where st.id = dm.coach_tag_id;

drop table dup_map;

-- Baseball/Basketball no longer need a per-coach copy -- they're
-- scope='global' now, same as every other seeded sport. Collapses to the
-- same no-op every other sport already fell through to; left in place
-- (rather than dropping the function/trigger) since ensureDefaultSkillTags
-- is still called client-side on every sign-in and a future sport could
-- legitimately want per-coach starter tags again.
create or replace function public.seed_default_skill_tags_for_coach(p_coach_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cat record;
  v_name text;
  v_names text[];
begin
  for v_cat in select id, sport, name from public.skill_categories loop
    v_names := array[]::text[];
    foreach v_name in array v_names loop
      insert into public.skill_tags (category_id, scope, owner_user_id, name)
      select v_cat.id, 'coach', p_coach_id, v_name
      where not exists (
        select 1 from public.skill_tags
        where category_id = v_cat.id and owner_user_id = p_coach_id and name = v_name
      );
    end loop;
  end loop;
end;
$$;
