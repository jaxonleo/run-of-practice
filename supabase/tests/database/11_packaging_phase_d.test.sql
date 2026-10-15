-- Free / Pro / Organization packaging, Phase D (2026-10-14): the goal
-- report's fixed 4-week window on a plan without goals.window_config (the
-- stored window is kept), the completed-run counter, and the narrow
-- update_upsell_state write path. Coach B (a...0002, Test Team B) on Free
-- with no cohort. Everything rolls back.
begin;
select plan(14);

delete from public.entitlement_cohort_assignments where user_id = 'a0000000-0000-0000-0000-000000000002';
update public.teams set goals_window_weeks = 8 where id = 'b0000000-0000-0000-0000-000000000002';

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-000000000002', true);
select is((public.get_team_goal_report('b0000000-0000-0000-0000-000000000002') ->> 'window_weeks')::int, 4, 'Free measures a fixed 4-week window');
reset role;
select is((select goals_window_weeks from public.teams where id = 'b0000000-0000-0000-0000-000000000002'), 8, 'the stored window is untouched');
update public.entitlement_plan_state set plan_bundle_key = 'pro' where user_id = 'a0000000-0000-0000-0000-000000000002';
set local role authenticated;
select is((public.get_team_goal_report('b0000000-0000-0000-0000-000000000002') ->> 'window_weeks')::int, 8, 'Pro gets the stored 8-week window back');
reset role;
update public.entitlement_plan_state set plan_bundle_key = 'free' where user_id = 'a0000000-0000-0000-0000-000000000002';

-- Completed-run counter.
insert into public.practices (id, team_id, status, name) values ('e0000000-0000-0000-0000-0000000002d1', 'b0000000-0000-0000-0000-000000000002', 'completed', 'D run');
insert into public.practice_live_sessions (practice_id, status, ended_at) values ('e0000000-0000-0000-0000-0000000002d1', 'completed', now());
set local role authenticated;
select is(public.get_team_completed_session_count('b0000000-0000-0000-0000-000000000002'), 1, 'completed-run counter counts the team''s runs');
select is(public.get_team_completed_session_count('b0000000-0000-0000-0000-000000000001'), null, 'and returns nothing for a team the caller cannot access');

-- update_upsell_state.
select is(public.update_upsell_state('moment_shown', 'V1') -> 'moments' -> 'V1' ->> 'active', 'true', 'moment_shown marks the moment active');
select is(jsonb_array_length(public.update_upsell_state('moment_shown', 'V2') -> 'impressions'), 2, 'each new impression is recorded');
select is(public.update_upsell_state('moment_dismiss', 'V1') -> 'moments' -> 'V1' ->> 'dismissals', '1', 'first dismissal counts once');
select ok((public.update_upsell_state('moment_dismiss', 'V1') -> 'moments' -> 'V1' ->> 'snoozed_until')::timestamptz > now() + interval '29 days', 'a dismissal snoozes 30 days');
select is(jsonb_array_length(public.update_upsell_state('track', 'npg_expand') -> 'counters' -> 'npg_expand'), 1, 'track appends to a counter');
select is(public.update_upsell_state('set_marker', 'v6_team', 'Pro Team') -> 'markers' ->> 'v6_team', 'Pro Team', 'set_marker stores a short value');
select throws_like($$select public.update_upsell_state('track', 'bad key!')$$, 'invalid key', 'keys are validated');
select throws_like($$select public.update_upsell_state('drop_table', 'V1')$$, 'invalid action', 'unknown actions are refused');
select throws_like(
  $$update public.profiles set upsell_state = '{}' where id = 'a0000000-0000-0000-0000-000000000002'$$,
  '%written through its RPC only%', 'a direct write is still refused'
);
reset role;
select set_config('request.jwt.claim.sub', '', true);

select * from finish();
rollback;
