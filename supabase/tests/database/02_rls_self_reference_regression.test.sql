-- Regression test for a real, previously-shipped bug (BUILD-STATUS.md
-- Gotchas, fifty-fifth session): `locations_select_access` used to
-- re-query `locations` by id from inside `can_access_location`, a
-- self-referential lookup against the very table its own policy protects.
-- RETURNING (what `.insert().select()` sends) needs the SELECT policy to
-- pass for the just-inserted row, and it failed even though the row was
-- genuinely creatable and genuinely visible a moment later. The fix
-- (20260821000000_locations_self_reference_fix.sql) gave the policy a
-- direct, lookup-free branch instead. This test encodes the exact failure
-- shape so it can never silently come back: insert-then-immediately-select
-- in one statement, not a plain insert followed by a separate query.
begin;
select plan(3);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-000000000001', true);

with ins as (
  insert into public.locations (owner_user_id, name)
  values ('a0000000-0000-0000-0000-000000000001', 'Regression Test Gym')
  returning name
)
select is(
  name,
  'Regression Test Gym',
  'INSERT ... RETURNING succeeds for a location the same user just created (the exact self-reference bug shape)'
) from ins;

select is(
  (select count(*)::int from public.locations where name = 'Regression Test Gym' and owner_user_id = 'a0000000-0000-0000-0000-000000000001'),
  1, 'the newly-inserted location is visible to its own owner on a follow-up select'
);

reset role;
select set_config('request.jwt.claim.sub', '', true);
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-000000000002', true);

select is(
  (select count(*)::int from public.locations where name = 'Regression Test Gym'),
  0, 'an unrelated coach still cannot see the new location'
);

select * from finish();
rollback;
