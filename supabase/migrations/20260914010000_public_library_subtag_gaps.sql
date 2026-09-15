-- Sub-tag gaps found while expanding the public drill library to ~15 drills
-- per global skill category (ROP-Public-Drills-Seed-Spec.md §1/§4). Each
-- category has carried exactly 4 global sub-tags since
-- 20260718040000_seed_public_library_taxonomy.sql; writing real, proven
-- drills at volume surfaced ten skill areas that coaches actually run
-- practice reps on and that had nowhere honest to land. Without these the
-- drills either sit in the app's "Untagged" bucket or get force-fitted onto
-- a sub-tag that doesn't describe them (a sacrifice bunt station tagged
-- "Contact to all fields", outfield route work tagged "First-step reads").
--
-- Deliberately restrained: ten tags across six sports, each one expected to
-- carry at least three drills in the seed library rather than existing to
-- round out a list. Category-level gaps found in the same pass are NOT
-- addressed here and are listed at the bottom, since adding an 8th category
-- to a sport is a bigger, separate decision than adding a leaf tag.
--
-- No backfill needed for coaches. Since
-- 20260727010000_fix_baseball_basketball_tag_duplication.sql collapsed the
-- per-coach starter copies into scope='global' rows and turned
-- seed_default_skill_tags_for_coach into a no-op, every coach reads these
-- global tags directly, so new rows here are visible to everyone the moment
-- this runs. Nothing assumes a fixed count of 4 sub-tags per category:
-- PublicLibraryScreen groups by category and sorts tags by name, and
-- skill_tags has no sort_order column.
--
-- Same NOT EXISTS guard as the seed migration, so this is safe to re-run.
-- skill_categories is untouched, so this cannot reintroduce the duplication
-- that 20260914000000 had to clean up.
insert into public.skill_tags (category_id, scope, name)
select sc.id, 'global', v.tag_name
from (values
  -- Baseball: bunting had no home at all (bunt drills were landing on
  -- "Contact to all fields"); Fielding's four sub-tags are entirely
  -- infield-centric, leaving fly ball routes on "First-step reads"; arm care
  -- is a Pitch Smart-era staple of every youth practice with no tag.
  ('Baseball', 'Hitting', 'Bunting / bat control'),
  ('Baseball', 'Fielding', 'Outfield reads / routes'),
  ('Baseball', 'Throwing', 'Arm care / warm-up'),

  -- Basketball: finishing at the rim (Mikan work, angles, off-hand layups)
  -- is the single most-run youth shooting block and none of Form, Catch-and-
  -- shoot, Off the dribble or Free throws covers it. Screening and cutting
  -- is the off-ball half of team offense; Spacing and Ball movement describe
  -- the result, not the action.
  ('Basketball', 'Shooting', 'Finishing at the rim'),
  ('Basketball', 'Team Play', 'Screening and cutting'),

  -- Football: the Blocking category only describes the offensive side, so
  -- defensive line and linebacker work on shedding and defeating blocks had
  -- no tag. Filed under Blocking deliberately, since that is where a coach
  -- looks for line play.
  ('Football', 'Blocking', 'Defeating blocks'),

  -- Lacrosse: goalies and faceoffs are both full position specialties with
  -- their own practice blocks and neither had a tag. Goalie work sits under
  -- Defending and faceoff work under Ground Balls, which is where the reps
  -- actually end up in a practice plan.
  ('Lacrosse', 'Defending', 'Goalie play & saves'),
  ('Lacrosse', 'Ground Balls', 'Faceoffs & wing play'),

  -- Soccer: restarts are a standing practice block at every level and are
  -- not possession, small-sided, transition or combination play.
  ('Soccer', 'Team Play', 'Set pieces & restarts'),

  -- Volleyball: the Passing category covers platform and serve receive but
  -- not digging a hard-driven ball or emergency floor defense, which is a
  -- separate skill with its own drills. Team Play's "Defense & coverage" is
  -- the systems view, not the individual technique.
  ('Volleyball', 'Passing', 'Digging & floor defense')
) as v(sport, category, tag_name)
join public.skill_categories sc on sc.sport = v.sport and sc.name = v.category
where not exists (
  select 1 from public.skill_tags st
  where st.category_id = sc.id and st.scope = 'global' and st.name = v.tag_name
);

-- Category-level gaps noted but intentionally NOT fixed here, since each
-- would mean an 8th skill_category for that sport and a re-think of the
-- "exactly 7, curated" shape:
--   Football  -- no home for defensive backs / pass coverage. Passing's
--                "Reading coverage" is the quarterback's side of it.
--   Lacrosse  -- goalies are handled above as a Defending sub-tag, but they
--                arguably deserve their own category the way Soccer's
--                Goalkeeping does.
--   Soccer    -- heading has no tag. Left out on purpose rather than by
--                oversight: US Soccer's heading guidelines prohibit heading
--                for players 11 and under and limit heading in practice for
--                ages 11 to 13, so a heading tag in a youth library would
--                invite drills many leagues do not permit. Worth revisiting
--                only if ROP ever distinguishes age groups on a drill.
