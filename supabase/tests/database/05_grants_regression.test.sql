-- Regression test for the grants divergence found 2026-09-12 (BUILD-STATUS.md
-- Known Gaps / Gotchas): staging's `anon` role was found to have full
-- SELECT/INSERT/UPDATE/DELETE on every table checked, while production
-- (and a from-scratch local replay, which this test runs against) hand-
-- scopes every grant per table via the migration folder. `anon` should
-- never have direct data-level access to any of these tables -- RLS
-- happening to also block it is not a substitute for the grant itself
-- being absent, per the `session_attendance` missing-DELETE-grant gap this
-- same investigation traced to a real historical bug. Checked directly
-- against `information_schema.role_table_grants`, not RLS -- this is
-- specifically testing the PostgREST-grant layer, a different mechanism
-- from every other test in this suite.
begin;
select plan(8);

select ok(
  not exists (
    select 1 from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'session_attendance'
      and grantee = 'anon' and privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
  ),
  'anon has no data-level grant on session_attendance'
);
select ok(
  not exists (
    select 1 from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'session_attendance'
      and grantee in ('anon', 'service_role') and privilege_type = 'DELETE'
  ),
  'neither anon nor service_role has a DELETE grant on session_attendance (the documented, still-open gap -- this pins the current state, not a claim it''s fixed)'
);

select ok(
  not exists (
    select 1 from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'feedback'
      and grantee = 'anon' and privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
  ),
  'anon has no data-level grant on feedback'
);

select ok(
  not exists (
    select 1 from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'profiles'
      and grantee = 'anon' and privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
  ),
  'anon has no data-level grant on profiles'
);

select ok(
  not exists (
    select 1 from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'teams'
      and grantee = 'anon' and privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
  ),
  'anon has no data-level grant on teams'
);

select ok(
  not exists (
    select 1 from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'players'
      and grantee = 'anon' and privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
  ),
  'anon has no data-level grant on players'
);

select ok(
  not exists (
    select 1 from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'planned_absences'
      and grantee = 'anon' and privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
  ),
  'anon has no data-level grant on planned_absences'
);

-- The positive case, so this file isn't just asserting absence everywhere:
-- authenticated genuinely does need INSERT+SELECT on session_attendance for
-- the app to function at all.
select ok(
  exists (
    select 1 from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'session_attendance'
      and grantee = 'authenticated' and privilege_type in ('SELECT', 'INSERT')
    having count(*) = 2
  ),
  'authenticated has both SELECT and INSERT on session_attendance (the app''s real, needed access)'
);

select * from finish();
rollback;
