-- Free / Pro / Organization packaging, Phase B (2026-10-14): every cap in
-- both directions -- refused at the limit on Free (no cohort), allowed
-- after an upgrade or with the founding cohort restored. Coach B
-- (a...0002, owns Test Team B, no staff) is the Free subject throughout;
-- coach A (a...0001) directs Test Org. Everything rolls back.
begin;
select plan(40);

-- Coach B on Free with no cohort.
delete from public.entitlement_cohort_assignments where user_id = 'a0000000-0000-0000-0000-000000000002';

-- ── Active personal teams ────────────────────────────────────────────────
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-000000000002', true);
select throws_like(
  $$insert into public.teams (id, owner_user_id, name, sport) values ('b0000000-0000-0000-0000-0000000000b2', 'a0000000-0000-0000-0000-000000000002', 'Second Team', 'Basketball')$$,
  'ENTITLEMENT_LIMIT:teams.personal_count', 'Free refuses a 2nd active personal team'
);
reset role;
update public.entitlement_plan_state set plan_bundle_key = 'pro' where user_id = 'a0000000-0000-0000-0000-000000000002';
set local role authenticated;
select lives_ok(
  $$insert into public.teams (id, owner_user_id, name, sport) values ('b0000000-0000-0000-0000-0000000000b2', 'a0000000-0000-0000-0000-000000000002', 'Second Team', 'Basketball')$$,
  'Pro allows a 2nd active personal team'
);
reset role;
update public.entitlement_plan_state set plan_bundle_key = 'free' where user_id = 'a0000000-0000-0000-0000-000000000002';
set local role authenticated;
select lives_ok(
  $$update public.teams set archived_at = now() where id = 'b0000000-0000-0000-0000-0000000000b2'$$,
  'archiving an over-cap team is always allowed'
);
select throws_like(
  $$update public.teams set archived_at = null where id = 'b0000000-0000-0000-0000-0000000000b2'$$,
  'ENTITLEMENT_LIMIT:teams.personal_count', 'Free refuses restoring an archived team past the cap'
);
reset role;
select set_config('request.jwt.claim.sub', '', true);

-- ── Org teams: contracted 2, 10% grace rounds up to 3 ──────────────────
insert into public.entitlement_overrides (subject_type, organization_id, feature_key, state, limit_value, reason)
values ('organization', '90000000-0000-0000-0000-000000000001', 'org.teams', 'full', 2, 'test: contracted 2');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-000000000001', true);
select lives_ok($$select public.org_create_team('90000000-0000-0000-0000-000000000001', 'Org 1', 'Basketball')$$, 'org team 1 of 2');
select lives_ok($$select public.org_create_team('90000000-0000-0000-0000-000000000001', 'Org 2', 'Basketball')$$, 'org team 2 of 2');
select lives_ok($$select public.org_create_team('90000000-0000-0000-0000-000000000001', 'Org 3', 'Basketball')$$, 'org team 3 rides the 10% grace (ceil(2 x 1.1) = 3)');
select throws_like(
  $$select public.org_create_team('90000000-0000-0000-0000-000000000001', 'Org 4', 'Basketball')$$,
  'ENTITLEMENT_LIMIT:org.teams', 'beyond the grace margin is refused'
);
reset role;
select set_config('request.jwt.claim.sub', '', true);
delete from public.entitlement_overrides where organization_id = '90000000-0000-0000-0000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-000000000001', true);
select lives_ok($$select public.org_create_team('90000000-0000-0000-0000-000000000001', 'Org 4', 'Basketball')$$, 'a null org.teams limit is uncapped');
reset role;
select set_config('request.jwt.claim.sub', '', true);

-- ── Rostered staff: 2 on Free, pending invites count ───────────────────
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-000000000002', true);
select lives_ok($$select public.invite_team_staff('b0000000-0000-0000-0000-000000000002', 'inv1@example.com', 'Inv', 'One', 'assistant_coach')$$, 'invite 1 of 2');
select lives_ok($$select public.invite_team_staff('b0000000-0000-0000-0000-000000000002', 'inv2@example.com', 'Inv', 'Two', 'assistant_coach')$$, 'invite 2 of 2');
select throws_like(
  $$select public.invite_team_staff('b0000000-0000-0000-0000-000000000002', 'inv3@example.com', 'Inv', 'Three', 'assistant_coach')$$,
  'ENTITLEMENT_LIMIT:teams.assistants', 'a 3rd invite is refused because pending invites count'
);
select lives_ok(
  $$select public.invite_team_staff('b0000000-0000-0000-0000-000000000002', 'inv1@example.com', 'Inv', 'One', 'assistant_coach')$$,
  're-sending an already-pending invite is allowed at the cap'
);
select throws_like(
  $$insert into public.team_staff (team_id, first_name, last_name, role, invite_email) values ('b0000000-0000-0000-0000-000000000002', 'Direct', 'Add', 'head_coach', 'direct@example.com')$$,
  'ENTITLEMENT_LIMIT:teams.assistants', 'a direct roster insert is refused too, head-coach role included'
);
reset role;
select set_config('request.jwt.claim.sub', '', true);

-- Acceptance re-check: on Pro, invite a 3rd; back on Free, accepting it
-- is refused (the other two pending invites fill the cap) and it stays
-- pending; with the cohort restored it goes through.
update public.entitlement_plan_state set plan_bundle_key = 'pro' where user_id = 'a0000000-0000-0000-0000-000000000002';
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-000000000002', true);
select public.invite_team_staff('b0000000-0000-0000-0000-000000000002', 'inv3@example.com', 'Inv', 'Three', 'assistant_coach');
reset role;
update public.entitlement_plan_state set plan_bundle_key = 'free' where user_id = 'a0000000-0000-0000-0000-000000000002';
insert into auth.users (id, email) values ('a0000000-0000-0000-0000-0000000000c3', 'inv3@example.com');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-0000000000c3', true);
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000c3","email":"inv3@example.com"}', true);
select throws_like(
  $$select public.accept_team_invite((select id from public.team_invites where email = 'inv3@example.com'))$$,
  'ENTITLEMENT_LIMIT:teams.assistants', 'accepting after the team filled up is refused'
);
reset role;
select is(
  (select status from public.team_invites where email = 'inv3@example.com'),
  'pending', 'the refused invite is still pending'
);
insert into public.entitlement_cohort_assignments (subject_type, user_id, cohort_bundle_key, assigned_reason)
values ('user', 'a0000000-0000-0000-0000-000000000002', 'founding_coach', 'test: restore');
set local role authenticated;
select lives_ok(
  $$select public.accept_team_invite((select id from public.team_invites where email = 'inv3@example.com'))$$,
  'with the founding cohort restored, the same acceptance goes through'
);
reset role;
select set_config('request.jwt.claims', '', true);
select set_config('request.jwt.claim.sub', '', true);
delete from public.entitlement_cohort_assignments where user_id = 'a0000000-0000-0000-0000-000000000002';

-- ── Personal drills: archive-restore path ──────────────────────────────
insert into public.activity_library (owner_user_id, sport, name)
select 'a0000000-0000-0000-0000-000000000002', 'Basketball', 'B drill ' || g from generate_series(1, 20) g;
update public.activity_library set archived_at = now() where name = 'B drill 1';
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-000000000002', true);
select lives_ok(
  $$insert into public.activity_library (owner_user_id, sport, name) values ('a0000000-0000-0000-0000-000000000002', 'Basketball', 'B drill 21')$$,
  'the 20th active drill is allowed'
);
select throws_like(
  $$update public.activity_library set archived_at = null where name = 'B drill 1' and owner_user_id = 'a0000000-0000-0000-0000-000000000002'$$,
  'ENTITLEMENT_LIMIT:library.personal_drills', 'restoring an archived drill past the cap is refused'
);
reset role;
select set_config('request.jwt.claim.sub', '', true);

-- ── Personal templates: 2 on Free ──────────────────────────────────────
insert into public.templates (owner_user_id, sport, name) values
  ('a0000000-0000-0000-0000-000000000002', 'Basketball', 'T1'),
  ('a0000000-0000-0000-0000-000000000002', 'Basketball', 'T2');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-000000000002', true);
select ok(not public.can_create_personal_template(), 'can_create_personal_template is false at 2 on Free');
select throws_like(
  $$insert into public.templates (owner_user_id, sport, name) values ('a0000000-0000-0000-0000-000000000002', 'Basketball', 'T3')$$,
  'ENTITLEMENT_LIMIT:library.personal_templates', 'a 3rd personal template is refused on Free'
);
reset role;
update public.entitlement_plan_state set plan_bundle_key = 'pro' where user_id = 'a0000000-0000-0000-0000-000000000002';
set local role authenticated;
select lives_ok(
  $$insert into public.templates (owner_user_id, sport, name) values ('a0000000-0000-0000-0000-000000000002', 'Basketball', 'T3')$$,
  'Pro allows a 3rd personal template'
);
reset role;
update public.entitlement_plan_state set plan_bundle_key = 'free' where user_id = 'a0000000-0000-0000-0000-000000000002';
select set_config('request.jwt.claim.sub', '', true);

-- ── Browsable history: 11 completed runs on Free shows 10 ─────────────
insert into public.practices (id, team_id, status, name)
select ('e0000000-0000-0000-0000-0000000001' || lpad(g::text, 2, '0'))::uuid,
       'b0000000-0000-0000-0000-000000000002', 'completed', 'Run ' || g
from generate_series(1, 11) g;
insert into public.practice_live_sessions (id, practice_id, status, created_at, ended_at)
select ('d0000000-0000-0000-0000-0000000001' || lpad(g::text, 2, '0'))::uuid,
       ('e0000000-0000-0000-0000-0000000001' || lpad(g::text, 2, '0'))::uuid,
       'completed', now() - (12 - g) * interval '1 day' - interval '1 hour', now() - (12 - g) * interval '1 day'
from generate_series(1, 11) g;
insert into public.notes (practice_id, text, created_by) values
  ('e0000000-0000-0000-0000-000000000101', 'oldest run note', 'a0000000-0000-0000-0000-000000000002'),
  ('e0000000-0000-0000-0000-000000000111', 'newest run note', 'a0000000-0000-0000-0000-000000000002');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-000000000002', true);
select is(jsonb_array_length(public.get_team_session_history('b0000000-0000-0000-0000-000000000002')), 10, 'Free history lists the 10 most recent');
select is(public.get_team_history_hidden_count('b0000000-0000-0000-0000-000000000002'), 1, 'and reports 1 hidden');
select ok(not public.can_view_session('d0000000-0000-0000-0000-000000000101'), 'the oldest run is not viewable');
select ok(public.can_view_session('d0000000-0000-0000-0000-000000000111'), 'the newest run is viewable');
select is((select count(*)::int from public.notes where practice_id in ('e0000000-0000-0000-0000-000000000101', 'e0000000-0000-0000-0000-000000000111')), 1, 'notes on the hidden practice are not readable (never deleted)');
reset role;
update public.entitlement_plan_state set plan_bundle_key = 'pro' where user_id = 'a0000000-0000-0000-0000-000000000002';
set local role authenticated;
select is(jsonb_array_length(public.get_team_session_history('b0000000-0000-0000-0000-000000000002')), 11, 'Pro history lists all 11');
select is((select count(*)::int from public.notes where practice_id in ('e0000000-0000-0000-0000-000000000101', 'e0000000-0000-0000-0000-000000000111')), 2, 'and the hidden note is back');
reset role;
update public.entitlement_plan_state set plan_bundle_key = 'free' where user_id = 'a0000000-0000-0000-0000-000000000002';

-- ── Pro-only RPCs ──────────────────────────────────────────────────────
set local role authenticated;
select throws_like($$select public.get_team_goal_trends('b0000000-0000-0000-0000-000000000002')$$, 'ENTITLEMENT_LOCKED:goals.trends', 'trends RPC refuses on Free (preview is not full)');
select throws_like($$select public.get_session_execution_scorecard('d0000000-0000-0000-0000-000000000111')$$, 'ENTITLEMENT_LOCKED:goals.execution_scorecard', 'scorecard RPC refuses on Free');
select throws_like(
  $$select public.create_benchmark(null, 'Basketball', 'Free throws', 'individual', '{}'::jsonb)$$,
  'ENTITLEMENT_LOCKED:benchmarks.access', 'creating a benchmark refuses on Free'
);
reset role;
update public.entitlement_plan_state set plan_bundle_key = 'pro' where user_id = 'a0000000-0000-0000-0000-000000000002';
set local role authenticated;
select lives_ok($$select public.get_team_goal_trends('b0000000-0000-0000-0000-000000000002')$$, 'trends RPC works on Pro');
select lives_ok($$select public.get_session_execution_scorecard('d0000000-0000-0000-0000-000000000111')$$, 'scorecard RPC works on Pro');
reset role;
update public.entitlement_plan_state set plan_bundle_key = 'free' where user_id = 'a0000000-0000-0000-0000-000000000002';

-- ── Inactive team: Pro coach with 2 teams downgrades to Free ───────────
select set_config('request.jwt.claim.sub', '', true);
update public.teams set archived_at = null where id = 'b0000000-0000-0000-0000-0000000000b2';
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-000000000002', true);
set local role authenticated;
select lives_ok($$select public.set_active_personal_team('b0000000-0000-0000-0000-0000000000b2')$$, 'the coach picks Second Team as active');
select throws_like(
  $$select public.set_active_personal_team('b0000000-0000-0000-0000-000000000002')$$,
  'ENTITLEMENT_LIMIT:teams.personal_count', 'switching again inside 30 days is refused'
);
select throws_like(
  $$insert into public.practices (team_id, status, name) values ('b0000000-0000-0000-0000-000000000002', 'draft', 'Plan on paused team')$$,
  'ENTITLEMENT_LIMIT:teams.personal_count', 'planning on the paused team is refused'
);
select lives_ok(
  $$insert into public.practices (team_id, status, name) values ('b0000000-0000-0000-0000-0000000000b2', 'draft', 'Plan on active team')$$,
  'planning on the active team is never gated'
);
select throws_like(
  $$select public.create_practice_series('b0000000-0000-0000-0000-000000000002', array[1], '17:00', 60, current_date, current_date + 7)$$,
  'ENTITLEMENT_LIMIT:teams.personal_count', 'scheduling a series on the paused team is refused'
);
reset role;
-- Assistant view of the owner's team: an assistant with full access on
-- their own account still sees the team owner's (Free) plan on that team.
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-000000000001', true);
delete from public.entitlement_cohort_assignments where user_id = 'a0000000-0000-0000-0000-000000000001';
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-000000000003', true);
set local role authenticated;
select is(
  public.get_team_entitlements('b0000000-0000-0000-0000-000000000001') -> 'benchmarks.access' ->> 'state',
  'locked', 'an assistant sees the owner''s Free plan on that team, not their own Founding access'
);
reset role;
select set_config('request.jwt.claim.sub', '', true);

select * from finish();
rollback;
