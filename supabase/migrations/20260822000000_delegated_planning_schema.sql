-- Delegated Planning, Goals & Insights, Private Assets, and Practice History
-- spec (2026-08-22). Schema additions only; RLS/RPC/backfill land in
-- companion migrations that follow this one.

-- 1. Location team-availability, explicit opt-in (replaces the automatic
-- "any team_staff member's location is auto-usable by a build-delegate"
-- rule from 20260805090000_delegated_planner_location_access.sql -- the new
-- spec is explicit that using a location once must not silently make it
-- reusable for future planning, since a coach's library can hold sensitive
-- locations like a home address). Coach-owned only in practice (an org
-- location is already visible/usable team-wide via can_access_owned), but
-- left un-constrained at the column level since org locations simply never
-- need this flag checked.
alter table public.locations
  add column available_to_team_planners boolean not null default false;

-- 2. Practice-level location snapshot (Section 4 / Edge Case D+F: a
-- historical practice must keep showing its location even after the
-- source location is archived or deleted). Mirrors the existing
-- practice_activities "copy the fields you need to render/rebuild the
-- practice, don't rely on a live join" convention -- practices.location_id
-- stays as the live FK/lineage pointer (still used for "is this location
-- reusable" checks going forward), these two are the durable copy.
alter table public.practices
  add column location_name_snapshot text,
  add column location_address_snapshot text;

-- 3. Sublocation (area) name snapshot, same reasoning, on the two places an
-- area is actually referenced inside a built practice.
alter table public.practice_activities add column sublocation_name_snapshot text;
alter table public.stations add column sublocation_name_snapshot text;

-- 4. Skill-tag attribution snapshot (Edge Case F: deleting a source drill
-- must not corrupt Goals & Insights attribution for practices that already
-- used it). Today, category_minutes_from_rows joins live drill_tags by
-- library_activity_id -- once a drill is deleted, that FK is already
-- set-null (20260802050000_library_lineage_fk_actor_pattern.sql), so the
-- activity's minutes silently fall out of every category and into
-- "untagged" for every historical report, forever. This snapshot is a
-- fallback only (see the companion RLS/function migration): it is never
-- consulted while the source drill still exists, so a coach re-tagging a
-- drill continues to retroactively affect its own history exactly as it
-- does today -- this column only prevents the *deletion* case from
-- corrupting past reports.
alter table public.practice_activities add column tag_snapshot uuid[];
alter table public.stations add column tag_snapshot uuid[];

-- 5. Private-drill disclosure warning, user-level dismissal (Section 3).
-- A profiles column, not localStorage, per the spec's own "dismissal
-- should be user-level" framing -- this app has no user_preferences table,
-- and a single boolean doesn't warrant inventing one.
alter table public.profiles add column dismissed_private_drill_warning boolean not null default false;
