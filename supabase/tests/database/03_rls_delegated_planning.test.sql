-- Delegated planning authorization (practices_insert_manage's WITH CHECK:
-- can_manage_team(team_id) OR can_build_practice_for_team(team_id)). Fixture
-- has one assistant coach delegated build rights on Team A and one without,
-- per supabase/seed.sql. This is the same authorization shape the
-- Multi-Coach Builder feature (forty-eighth session) and its own
-- can_build_practices gate depend on -- a real permission boundary, not a
-- cosmetic one.
begin;
select plan(4);

-- head coach (owner): always allowed to plan for their own team.
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-000000000001', true);
select lives_ok(
  $$ insert into public.practices (team_id, status, name) values ('b0000000-0000-0000-0000-000000000001', 'draft', 'Head Coach Practice') $$,
  'head coach can insert a practice for their own team'
);

-- delegated assistant (can_build_practices = true): allowed.
reset role;
select set_config('request.jwt.claim.sub', '', true);
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-000000000003', true);
select lives_ok(
  $$ insert into public.practices (team_id, status, name) values ('b0000000-0000-0000-0000-000000000001', 'draft', 'Delegated Assistant Practice') $$,
  'an assistant with can_build_practices=true can insert a practice for that team'
);

-- non-delegated assistant (can_build_practices = false): rejected.
reset role;
select set_config('request.jwt.claim.sub', '', true);
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-000000000004', true);
select throws_like(
  $$ insert into public.practices (team_id, status, name) values ('b0000000-0000-0000-0000-000000000001', 'draft', 'Should Fail') $$,
  '%row-level security%',
  'an assistant without can_build_practices cannot insert a practice for that team'
);

-- unrelated head coach: rejected, not just "not delegated" but genuinely
-- not on the team at all.
reset role;
select set_config('request.jwt.claim.sub', '', true);
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-000000000002', true);
select throws_like(
  $$ insert into public.practices (team_id, status, name) values ('b0000000-0000-0000-0000-000000000001', 'draft', 'Should Also Fail') $$,
  '%row-level security%',
  'an unrelated coach cannot insert a practice for a team they have no relationship to'
);

select * from finish();
rollback;
