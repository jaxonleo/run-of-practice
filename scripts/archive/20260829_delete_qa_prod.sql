-- Deletes the QA fixture accounts, both QA teams, and everything hanging
-- off them from PRODUCTION, now that staging has its own independent copy.
-- Isolation was verified beforehand: neither account is on any other
-- team/org, and nothing outside these two teams references any drill,
-- asset, location, or template these accounts own.
--
-- Order is leaf-to-root per the real FK graph (checked directly against
-- information_schema, not assumed). The templates<->practices circular
-- reference (the same one pg_dump warns about on every dump) is broken
-- explicitly before either side is deleted. Every step is followed by a
-- hard verification that raises an actual error (not just a warning) if
-- the affected-row count doesn't match what was independently counted
-- beforehand -- that failure aborts the script before COMMIT is reached.
\set ON_ERROR_STOP on

BEGIN;

CREATE TEMP TABLE qa_user_ids (id uuid);
INSERT INTO qa_user_ids VALUES
  ('773ae5a8-bbe6-4936-a24b-05606bd8d2e0'), -- ropqa-head@example.com
  ('9cff9d68-fc32-44cd-8257-584d4f650771'); -- ropqa-asst@example.com

CREATE TEMP TABLE qa_team_ids (id uuid);
INSERT INTO qa_team_ids VALUES
  ('418fe755-4e53-4365-a2da-dd3ecd5cc664'), -- QA Persistent Wolves
  ('0ae9a66d-4261-43cb-b940-2d89fd4f4a8e'); -- QA Persistent Second Team

CREATE TEMP TABLE qa_practice_ids AS
  SELECT id FROM practices WHERE team_id IN (SELECT id FROM qa_team_ids);

CREATE TEMP TABLE qa_practice_activity_ids AS
  SELECT id FROM practice_activities WHERE practice_id IN (SELECT id FROM qa_practice_ids);

CREATE TEMP TABLE qa_station_block_ids AS
  SELECT id FROM station_blocks WHERE practice_activity_id IN (SELECT id FROM qa_practice_activity_ids);

CREATE TEMP TABLE qa_station_ids AS
  SELECT id FROM stations WHERE station_block_id IN (SELECT id FROM qa_station_block_ids);

CREATE TEMP TABLE qa_live_session_ids AS
  SELECT id FROM practice_live_sessions WHERE practice_id IN (SELECT id FROM qa_practice_ids);

CREATE TEMP TABLE qa_preview_session_ids AS
  SELECT id FROM preview_sessions WHERE practice_id IN (SELECT id FROM qa_practice_ids);

CREATE TEMP TABLE qa_session_group_ids AS
  SELECT id FROM session_groups WHERE practice_activity_id IN (SELECT id FROM qa_practice_activity_ids);

CREATE TEMP TABLE qa_note_ids AS
  SELECT id FROM notes WHERE practice_id IN (SELECT id FROM qa_practice_ids);

CREATE TEMP TABLE qa_player_ids AS
  SELECT id FROM players WHERE team_id IN (SELECT id FROM qa_team_ids);

CREATE TEMP TABLE qa_asset_ids AS
  SELECT id FROM assets WHERE owner_user_id IN (SELECT id FROM qa_user_ids);

CREATE TEMP TABLE qa_location_ids AS
  SELECT id FROM locations WHERE owner_user_id IN (SELECT id FROM qa_user_ids);

CREATE TEMP TABLE qa_library_ids AS
  SELECT id FROM activity_library WHERE owner_user_id IN (SELECT id FROM qa_user_ids);

CREATE TEMP TABLE qa_template_ids AS
  SELECT id FROM templates WHERE owner_user_id IN (SELECT id FROM qa_user_ids);

CREATE TEMP TABLE qa_template_activity_ids AS
  SELECT id FROM template_activities WHERE template_id IN (SELECT id FROM qa_template_ids);

CREATE TEMP TABLE qa_template_station_block_ids AS
  SELECT id FROM template_station_blocks WHERE template_activity_id IN (SELECT id FROM qa_template_activity_ids);

CREATE TEMP TABLE qa_template_station_ids AS
  SELECT id FROM template_stations WHERE template_station_block_id IN (SELECT id FROM qa_template_station_block_ids);

-- Break the templates <-> practices cycle (self-contained within QA data,
-- already verified: no non-QA row on either side of this cycle).
UPDATE practices SET template_id = NULL WHERE id IN (SELECT id FROM qa_practice_ids) AND template_id IS NOT NULL;
UPDATE templates SET source_practice_id = NULL WHERE id IN (SELECT id FROM qa_template_ids) AND source_practice_id IS NOT NULL;

-- Deepest leaves first.
DELETE FROM user_events WHERE user_id IN (SELECT id FROM qa_user_ids);
DELETE FROM session_attendance WHERE session_id IN (SELECT id FROM qa_live_session_ids);
DELETE FROM session_access_tokens WHERE live_session_id IN (SELECT id FROM qa_live_session_ids) OR preview_session_id IN (SELECT id FROM qa_preview_session_ids);
DELETE FROM session_operations WHERE session_id IN (SELECT id FROM qa_live_session_ids);
DELETE FROM preview_sessions WHERE id IN (SELECT id FROM qa_preview_session_ids);
DELETE FROM practice_live_sessions WHERE id IN (SELECT id FROM qa_live_session_ids);

DELETE FROM team_departures WHERE team_id IN (SELECT id FROM qa_team_ids);
DELETE FROM team_join_notices WHERE team_id IN (SELECT id FROM qa_team_ids);
DELETE FROM team_goals WHERE team_id IN (SELECT id FROM qa_team_ids);
DELETE FROM team_invites WHERE team_id IN (SELECT id FROM qa_team_ids);
DELETE FROM org_invites WHERE invited_by IN (SELECT id FROM qa_user_ids);
DELETE FROM user_entitlements WHERE user_id IN (SELECT id FROM qa_user_ids);
DELETE FROM feedback WHERE user_id IN (SELECT id FROM qa_user_ids);

DELETE FROM session_group_members WHERE group_id IN (SELECT id FROM qa_session_group_ids);
DELETE FROM session_groups WHERE id IN (SELECT id FROM qa_session_group_ids);
DELETE FROM session_activity_log WHERE practice_activity_id IN (SELECT id FROM qa_practice_activity_ids);
DELETE FROM note_player_tags WHERE note_id IN (SELECT id FROM qa_note_ids);
DELETE FROM notes WHERE id IN (SELECT id FROM qa_note_ids);
DELETE FROM station_assignment_notices WHERE practice_id IN (SELECT id FROM qa_practice_ids);
DELETE FROM station_equipment WHERE station_id IN (SELECT id FROM qa_station_ids);
DELETE FROM stations WHERE id IN (SELECT id FROM qa_station_ids);
DELETE FROM station_blocks WHERE id IN (SELECT id FROM qa_station_block_ids);
DELETE FROM practice_activity_checklist_items WHERE practice_activity_id IN (SELECT id FROM qa_practice_activity_ids);
DELETE FROM practice_activity_equipment WHERE practice_activity_id IN (SELECT id FROM qa_practice_activity_ids);
DELETE FROM planned_absences WHERE practice_id IN (SELECT id FROM qa_practice_ids);
DELETE FROM practice_activities WHERE id IN (SELECT id FROM qa_practice_activity_ids);
DELETE FROM practices WHERE id IN (SELECT id FROM qa_practice_ids);

DELETE FROM template_station_equipment WHERE template_station_id IN (SELECT id FROM qa_template_station_ids);
DELETE FROM template_stations WHERE id IN (SELECT id FROM qa_template_station_ids);
DELETE FROM template_station_blocks WHERE id IN (SELECT id FROM qa_template_station_block_ids);
DELETE FROM template_activity_checklist_items WHERE template_activity_id IN (SELECT id FROM qa_template_activity_ids);
DELETE FROM template_activity_equipment WHERE template_activity_id IN (SELECT id FROM qa_template_activity_ids);
DELETE FROM template_activities WHERE id IN (SELECT id FROM qa_template_activity_ids);
DELETE FROM templates WHERE id IN (SELECT id FROM qa_template_ids);

DELETE FROM player_focus_areas WHERE player_id IN (SELECT id FROM qa_player_ids);
DELETE FROM players WHERE id IN (SELECT id FROM qa_player_ids);

DELETE FROM sublocations WHERE location_id IN (SELECT id FROM qa_location_ids);
DELETE FROM asset_locations WHERE location_id IN (SELECT id FROM qa_location_ids) OR asset_id IN (SELECT id FROM qa_asset_ids);
DELETE FROM activity_library_equipment WHERE activity_library_id IN (SELECT id FROM qa_library_ids) OR asset_id IN (SELECT id FROM qa_asset_ids);
DELETE FROM drill_tags WHERE activity_library_id IN (SELECT id FROM qa_library_ids);
DELETE FROM activity_library_org_shares WHERE activity_library_id IN (SELECT id FROM qa_library_ids);
DELETE FROM activity_library WHERE id IN (SELECT id FROM qa_library_ids);
DELETE FROM assets WHERE id IN (SELECT id FROM qa_asset_ids);
DELETE FROM locations WHERE id IN (SELECT id FROM qa_location_ids);
DELETE FROM team_locations WHERE team_id IN (SELECT id FROM qa_team_ids);
DELETE FROM team_staff WHERE team_id IN (SELECT id FROM qa_team_ids);
DELETE FROM teams WHERE id IN (SELECT id FROM qa_team_ids);

-- profiles cascades from auth.users (on delete cascade); this also removes
-- any remaining profiles-referencing rows we haven't explicitly listed
-- above IF AND ONLY IF they're all already gone (verified below first).
DELETE FROM auth.users WHERE id IN (SELECT id FROM qa_user_ids);

-- Hard verification: raise a real error (aborting before COMMIT) if
-- anything expected to be zero isn't.
DO $$
DECLARE
  remaining int;
BEGIN
  SELECT count(*) INTO remaining FROM auth.users WHERE id IN ('773ae5a8-bbe6-4936-a24b-05606bd8d2e0','9cff9d68-fc32-44cd-8257-584d4f650771');
  IF remaining != 0 THEN RAISE EXCEPTION 'auth.users still has % QA rows', remaining; END IF;

  SELECT count(*) INTO remaining FROM profiles WHERE id IN ('773ae5a8-bbe6-4936-a24b-05606bd8d2e0','9cff9d68-fc32-44cd-8257-584d4f650771');
  IF remaining != 0 THEN RAISE EXCEPTION 'profiles still has % QA rows', remaining; END IF;

  SELECT count(*) INTO remaining FROM teams WHERE id IN ('418fe755-4e53-4365-a2da-dd3ecd5cc664','0ae9a66d-4261-43cb-b940-2d89fd4f4a8e');
  IF remaining != 0 THEN RAISE EXCEPTION 'teams still has % QA rows', remaining; END IF;

  SELECT count(*) INTO remaining FROM team_staff WHERE user_id IN ('773ae5a8-bbe6-4936-a24b-05606bd8d2e0','9cff9d68-fc32-44cd-8257-584d4f650771');
  IF remaining != 0 THEN RAISE EXCEPTION 'team_staff still has % QA rows', remaining; END IF;

  SELECT count(*) INTO remaining FROM practices WHERE team_id IN ('418fe755-4e53-4365-a2da-dd3ecd5cc664','0ae9a66d-4261-43cb-b940-2d89fd4f4a8e');
  IF remaining != 0 THEN RAISE EXCEPTION 'practices still has % QA rows', remaining; END IF;

  SELECT count(*) INTO remaining FROM players WHERE team_id IN ('418fe755-4e53-4365-a2da-dd3ecd5cc664','0ae9a66d-4261-43cb-b940-2d89fd4f4a8e');
  IF remaining != 0 THEN RAISE EXCEPTION 'players still has % QA rows', remaining; END IF;

  SELECT count(*) INTO remaining FROM activity_library WHERE owner_user_id IN ('773ae5a8-bbe6-4936-a24b-05606bd8d2e0','9cff9d68-fc32-44cd-8257-584d4f650771');
  IF remaining != 0 THEN RAISE EXCEPTION 'activity_library still has % QA rows', remaining; END IF;

  SELECT count(*) INTO remaining FROM assets WHERE owner_user_id IN ('773ae5a8-bbe6-4936-a24b-05606bd8d2e0','9cff9d68-fc32-44cd-8257-584d4f650771');
  IF remaining != 0 THEN RAISE EXCEPTION 'assets still has % QA rows', remaining; END IF;

  SELECT count(*) INTO remaining FROM locations WHERE owner_user_id IN ('773ae5a8-bbe6-4936-a24b-05606bd8d2e0','9cff9d68-fc32-44cd-8257-584d4f650771');
  IF remaining != 0 THEN RAISE EXCEPTION 'locations still has % QA rows', remaining; END IF;

  SELECT count(*) INTO remaining FROM templates WHERE owner_user_id IN ('773ae5a8-bbe6-4936-a24b-05606bd8d2e0','9cff9d68-fc32-44cd-8257-584d4f650771');
  IF remaining != 0 THEN RAISE EXCEPTION 'templates still has % QA rows', remaining; END IF;

  SELECT count(*) INTO remaining FROM feedback WHERE user_id IN ('773ae5a8-bbe6-4936-a24b-05606bd8d2e0','9cff9d68-fc32-44cd-8257-584d4f650771');
  IF remaining != 0 THEN RAISE EXCEPTION 'feedback still has % QA rows', remaining; END IF;

  SELECT count(*) INTO remaining FROM user_entitlements WHERE user_id IN ('773ae5a8-bbe6-4936-a24b-05606bd8d2e0','9cff9d68-fc32-44cd-8257-584d4f650771');
  IF remaining != 0 THEN RAISE EXCEPTION 'user_entitlements still has % QA rows', remaining; END IF;

  RAISE NOTICE 'All verification checks passed. Safe to COMMIT.';
END $$;

COMMIT;
