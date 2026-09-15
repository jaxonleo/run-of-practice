-- Local-only: `supabase start`/`db reset` runs this file, staging and
-- production never do (staging was seeded from a pg_dump, prod obviously
-- never runs it) -- safe place for test-only extensions and fixture data
-- that must never touch a live project.
--
-- pgTAP itself, plus a small, realistic fixture (two unrelated coaches/teams
-- so cross-tenant RLS has something real to fail against, an assistant with
-- delegated build rights and one without) that supabase/tests/database/*.sql
-- reads from. Fixed ids so tests can reference them directly instead of
-- re-querying for "the team I just made."

create extension if not exists pgtap with schema extensions;

-- auth.users insert fires on_auth_user_created -> handle_new_user, which
-- creates the matching public.profiles row (and its own downstream
-- entitlements/skill-tags triggers) -- mirrors a real signup, not a
-- profiles-table shortcut.
insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-000000000001', 'test-coach-a@example.com'),
  ('a0000000-0000-0000-0000-000000000002', 'test-coach-b@example.com'),
  ('a0000000-0000-0000-0000-000000000003', 'test-assistant-builder@example.com'),
  ('a0000000-0000-0000-0000-000000000004', 'test-assistant-viewer@example.com')
on conflict (id) do nothing;

-- on_team_created_add_head_coach (teams trigger) auto-inserts the owner's
-- own team_staff row from profiles.first_name/last_name and has no
-- coalesce on first_name -- needs real names set before any team exists,
-- or team creation itself fails a not-null constraint.
update public.profiles set first_name = 'Coach', last_name = 'A' where id = 'a0000000-0000-0000-0000-000000000001';
update public.profiles set first_name = 'Coach', last_name = 'B' where id = 'a0000000-0000-0000-0000-000000000002';
update public.profiles set first_name = 'Assistant', last_name = 'Builder' where id = 'a0000000-0000-0000-0000-000000000003';
update public.profiles set first_name = 'Assistant', last_name = 'Viewer' where id = 'a0000000-0000-0000-0000-000000000004';

insert into public.teams (id, owner_user_id, name, sport, timezone) values
  ('b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'Test Team A', 'Basketball', 'America/Phoenix'),
  ('b0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000002', 'Test Team B', 'Basketball', 'America/Phoenix')
on conflict (id) do nothing;

-- The two head-coach team_staff rows above come from the trigger; only the
-- assistants need inserting by hand.
insert into public.team_staff (id, team_id, user_id, first_name, last_name, role, can_build_practices) values
  ('f0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000003', 'Assistant', 'Builder', 'assistant_coach', true),
  ('f0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000004', 'Assistant', 'Viewer', 'assistant_coach', false)
on conflict (id) do nothing;

insert into public.players (id, team_id, first_name, last_name) values
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'Player', 'A1'),
  ('c0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000002', 'Player', 'B1')
on conflict (id) do nothing;

insert into public.locations (id, owner_user_id, name) values
  ('d0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'Test Gym A'),
  ('d0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000002', 'Test Gym B')
on conflict (id) do nothing;

insert into public.practices (id, team_id, status, name) values
  ('e0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'draft', 'Test Practice A')
on conflict (id) do nothing;
