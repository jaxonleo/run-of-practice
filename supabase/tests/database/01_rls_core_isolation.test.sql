-- Cross-tenant RLS isolation: two unrelated coaches/teams (seeded in
-- supabase/seed.sql) must never see each other's teams, players, or
-- locations, and each must see their own. This is the baseline every other
-- RLS test in this suite builds on -- if this fails, nothing else here
-- means anything.
begin;
select plan(10);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-000000000001', true);

select is(
  (select count(*)::int from public.teams where id = 'b0000000-0000-0000-0000-000000000001'),
  1, 'coach A can see their own team'
);
select is(
  (select count(*)::int from public.teams where id = 'b0000000-0000-0000-0000-000000000002'),
  0, 'coach A cannot see coach B''s team'
);
select is(
  (select count(*)::int from public.players where team_id = 'b0000000-0000-0000-0000-000000000001'),
  1, 'coach A can see their own team''s players'
);
select is(
  (select count(*)::int from public.players where team_id = 'b0000000-0000-0000-0000-000000000002'),
  0, 'coach A cannot see coach B''s team''s players'
);
select is(
  (select count(*)::int from public.locations where id = 'd0000000-0000-0000-0000-000000000001'),
  1, 'coach A can see their own location'
);
select is(
  (select count(*)::int from public.locations where id = 'd0000000-0000-0000-0000-000000000002'),
  0, 'coach A cannot see coach B''s location'
);

reset role;
select set_config('request.jwt.claim.sub', '', true);
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-000000000002', true);

select is(
  (select count(*)::int from public.teams where id = 'b0000000-0000-0000-0000-000000000002'),
  1, 'coach B can see their own team'
);
select is(
  (select count(*)::int from public.teams where id = 'b0000000-0000-0000-0000-000000000001'),
  0, 'coach B cannot see coach A''s team'
);
select is(
  (select count(*)::int from public.players where team_id = 'b0000000-0000-0000-0000-000000000001'),
  0, 'coach B cannot see coach A''s team''s players'
);
select is(
  (select count(*)::int from public.locations where id = 'd0000000-0000-0000-0000-000000000001'),
  0, 'coach B cannot see coach A''s location'
);

select * from finish();
rollback;
