-- Regression (2026-10-14): get_team_session_history's attendance_count
-- read 1 for a run with no attendance rows (count(*) over a left join's
-- all-null row). Coach B owns Test Team B and is a
-- Founding Coach in the seed, so history is uncapped here.
begin;
select plan(2);

insert into public.practices (id, team_id, status, name) values ('e0000000-0000-0000-0000-0000000003a1', 'b0000000-0000-0000-0000-000000000002', 'completed', 'Attendance run');
insert into public.practice_live_sessions (id, practice_id, status, ended_at) values ('d0000000-0000-0000-0000-0000000003a1', 'e0000000-0000-0000-0000-0000000003a1', 'completed', now());

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-000000000002', true);
select is(
  (select (e ->> 'attendance_count')::int from jsonb_array_elements(public.get_team_session_history('b0000000-0000-0000-0000-000000000002')) e
   where e ->> 'session_id' = 'd0000000-0000-0000-0000-0000000003a1'),
  0, 'a run with no attendance rows reports 0 attended'
);
reset role;

insert into public.session_attendance (session_id, player_id, status, marked_by)
values ('d0000000-0000-0000-0000-0000000003a1', 'c0000000-0000-0000-0000-000000000002', 'present', 'a0000000-0000-0000-0000-000000000002');

set local role authenticated;
select is(
  (select (e ->> 'attendance_count')::int from jsonb_array_elements(public.get_team_session_history('b0000000-0000-0000-0000-000000000002')) e
   where e ->> 'session_id' = 'd0000000-0000-0000-0000-0000000003a1'),
  1, 'one present player reports 1 attended'
);
reset role;
select set_config('request.jwt.claim.sub', '', true);

select * from finish();
rollback;
