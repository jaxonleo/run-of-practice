-- Founder Metrics packaging panel (2026-10-15): admin-only, and the
-- aggregates over entitlement_events are right. A fresh Free coach (no
-- cohort) signs up, is active, and hits a cap; Founding coach A also logs
-- events but never counts toward the Free-coach share. Everything rolls
-- back.
begin;
select plan(9);

-- Non-admin refused.
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-000000000001', true);
select throws_like($$select public.get_founder_packaging_metrics(12)$$, 'not authorized', 'a non-admin coach cannot read packaging metrics');
reset role;
select set_config('request.jwt.claim.sub', '', true);

-- Fixture: one active Free coach who hit a cap, one active Free coach who
-- did not, and Founding coach A's events.
insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-0000000000e1', 'pm-capped@example.com'),
  ('a0000000-0000-0000-0000-0000000000e2', 'pm-uncapped@example.com');
delete from public.entitlement_cohort_assignments where user_id in ('a0000000-0000-0000-0000-0000000000e1', 'a0000000-0000-0000-0000-0000000000e2');
insert into public.user_events (user_id, event_type) values
  ('a0000000-0000-0000-0000-0000000000e1', 'test_activity'),
  ('a0000000-0000-0000-0000-0000000000e2', 'test_activity');
delete from public.entitlement_events;
insert into public.entitlement_events (user_id, event, catalog_id, feature_key) values
  ('a0000000-0000-0000-0000-0000000000e1', 'limit_hit', 'T1', 'teams.personal_count'),
  ('a0000000-0000-0000-0000-0000000000e1', 'limit_hit', 'T1', 'teams.personal_count'),
  ('a0000000-0000-0000-0000-0000000000e1', 'cta_click', 'T1', 'teams.personal_count'),
  ('a0000000-0000-0000-0000-0000000000e2', 'preview_view', 'G4', 'goals.trends'),
  ('a0000000-0000-0000-0000-000000000001', 'limit_hit', 'L2', 'library.personal_drills'),
  ('a0000000-0000-0000-0000-000000000001', 'dismiss', 'V2', 'history.practice_history');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-000000000005', true);
select is(
  (select (e ->> 'hits')::int from jsonb_array_elements(public.get_founder_packaging_metrics(12) -> 'limit_hits_by_feature') e where e ->> 'feature_key' = 'teams.personal_count'),
  2, 'limit hits are counted per feature'
);
select is(
  (select (e ->> 'coaches')::int from jsonb_array_elements(public.get_founder_packaging_metrics(12) -> 'limit_hits_by_feature') e where e ->> 'feature_key' = 'teams.personal_count'),
  1, 'and distinct coaches per feature'
);
select is(
  (select (e ->> 'impressions')::int from jsonb_array_elements(public.get_founder_packaging_metrics(12) -> 'catalog_ctr') e where e ->> 'catalog_id' = 'T1'),
  2, 'impressions count limit hits, previews, and moments'
);
select is(
  (select (e ->> 'ctr')::numeric from jsonb_array_elements(public.get_founder_packaging_metrics(12) -> 'catalog_ctr') e where e ->> 'catalog_id' = 'T1'),
  0.5, 'click-through is clicks over impressions'
);
select is(
  (select e ->> 'ctr' from jsonb_array_elements(public.get_founder_packaging_metrics(12) -> 'catalog_ctr') e where e ->> 'catalog_id' = 'V2'),
  null, 'a catalog ID with no impressions has no click-through rate'
);
select is((public.get_founder_packaging_metrics(12) -> 'free_cap_share' ->> 'free_coaches')::int, 2, 'only active, cohort-free Free coaches count');
select is((public.get_founder_packaging_metrics(12) -> 'free_cap_share' ->> 'capped_coaches')::int, 1, 'one of them hit a cap within 30 days of signup');
select is((public.get_founder_packaging_metrics(12) -> 'free_cap_share' ->> 'share')::numeric, 0.5, 'share is capped over Free coaches');
reset role;
select set_config('request.jwt.claim.sub', '', true);

select * from finish();
rollback;
