-- Self-serve billing groundwork (2026-10-15): time-limited Pro grants in
-- resolve_entitlement, the partner program (apply, approve, renew one
-- quarter at a time, end, approve-before-signup), admin-only access, and
-- the coach's own billing summary. Coach B (a...0002) is a Free coach with
-- no cohort here; a...0005 is the platform admin. Everything rolls back.
begin;
select plan(22);

delete from public.entitlement_cohort_assignments where user_id = 'a0000000-0000-0000-0000-000000000002';

-- Grants.
select is(public.resolve_entitlement('user', 'a0000000-0000-0000-0000-000000000002', null, 'library.personal_templates') ->> 'limit_value', '2', 'Free coach starts with the Free template cap');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-000000000002', true);
select throws_like($$select public.admin_grant_pro_time('a0000000-0000-0000-0000-000000000002', 30, 'self-serve')$$, 'not authorized', 'a coach cannot grant themselves Pro time');
select throws_like(
  $$insert into public.pro_grants (user_id, source, ends_at, reason) values ('a0000000-0000-0000-0000-000000000002', 'admin', now() + interval '1 day', 'x')$$,
  '%permission denied%', 'pro_grants is not directly writable'
);
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-000000000005', true);
select lives_ok($$select public.admin_grant_pro_time('a0000000-0000-0000-0000-000000000002', 30, 'Live timer froze during practice')$$, 'the admin grants 30 days of goodwill Pro');
reset role;
select is(public.resolve_entitlement('user', 'a0000000-0000-0000-0000-000000000002', null, 'library.personal_templates') ->> 'source', 'grant', 'an active grant resolves from the Pro bundle');
select is(public.resolve_entitlement('user', 'a0000000-0000-0000-0000-000000000002', null, 'library.personal_templates') ->> 'limit_value', null, 'with Pro limits');
select is((select count(*)::int from public.billing_adjustments where user_id = 'a0000000-0000-0000-0000-000000000002' and kind = 'pro_time'), 1, 'the grant is recorded in the audit log');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-000000000005', true);
select public.admin_grant_pro_time('a0000000-0000-0000-0000-000000000002', 10, 'Second problem');
reset role;
select ok(
  (select max(ends_at) from public.pro_grants where user_id = 'a0000000-0000-0000-0000-000000000002') > now() + interval '39 days',
  'a second grant stacks after the first instead of overlapping it'
);
update public.pro_grants set revoked_at = now() where user_id = 'a0000000-0000-0000-0000-000000000002';
select is(public.resolve_entitlement('user', 'a0000000-0000-0000-0000-000000000002', null, 'library.personal_templates') ->> 'limit_value', '2', 'revoked grants stop counting');

-- Partner applications: public submission.
select set_config('request.jwt.claim.sub', '', true);
-- A signed-in coach applying under someone else's email is not linked to
-- that application (it is matched by email at approval instead).
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","email":"test-coach-a@example.com"}', true);
select public.submit_partner_application('Not Me', 'someone-else@example.com');
reset role;
select is((select user_id from public.partner_applications where email = 'someone-else@example.com'), null, 'applying under another email does not link it to the applicant''s account');
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '', true);
set local role anon;
select lives_ok($$select public.submit_partner_application('Coach Bee', 'test-coach-b@example.com', 'Basketball', '12U', 'Happy to give feedback')$$, 'anyone can apply, signed in or not');
select throws_like($$select public.submit_partner_application('No Email', 'not-an-email')$$, 'A name and a valid email are required.', 'a valid email is required');
select lives_ok($$select public.submit_partner_application('Coach Bee', 'TEST-COACH-B@example.com', 'Basketball', '14U', null)$$, 'a repeat application updates the open one');
reset role;
select is((select count(*)::int from public.partner_applications where lower(email) = 'test-coach-b@example.com'), 1, 'still one open application per email');

-- Approve, renew, end. The id is read as postgres: table RLS rightly
-- hides other people's applications from a signed-in account.
select set_config('test.app_id', (select id::text from public.partner_applications where lower(email) = 'test-coach-b@example.com'), true);
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-000000000005', true);
select public.admin_decide_partner(current_setting('test.app_id')::uuid, 'approve');
reset role;
select is((select count(*)::int from public.pro_grants where user_id = 'a0000000-0000-0000-0000-000000000002' and source = 'partner' and revoked_at is null), 1, 'approval grants the first free quarter');
select is(public.resolve_entitlement('user', 'a0000000-0000-0000-0000-000000000002', null, 'benchmarks.access') ->> 'state', 'full', 'so the partner has Pro');

-- Pretend the quarter is nearly over: the renewal shows as due.
update public.pro_grants set ends_at = now() + interval '5 days' where user_id = 'a0000000-0000-0000-0000-000000000002' and source = 'partner';
set local role authenticated;
select is(public.admin_partner_renewals_due(), 1, 'a partner whose quarter ends within 14 days is due for renewal');
select public.admin_decide_partner(current_setting('test.app_id')::uuid, 'renew', 'Great feedback in Q1');
reset role;
select ok(
  (select max(ends_at) from public.pro_grants where user_id = 'a0000000-0000-0000-0000-000000000002' and source = 'partner') > now() + interval '90 days',
  'renewing adds the next quarter after the current one ends'
);
set local role authenticated;
select is(public.admin_partner_renewals_due(), 0, 'and it is no longer due');
reset role;

-- Approved before having an account: the quarter starts at signup.
insert into public.partner_applications (email, name, status, decided_at, decided_by)
values ('future-partner@example.com', 'Future Partner', 'approved', now(), 'a0000000-0000-0000-0000-000000000005');
insert into auth.users (id, email) values ('a0000000-0000-0000-0000-0000000000f9', 'future-partner@example.com');
select is((select count(*)::int from public.pro_grants where user_id = 'a0000000-0000-0000-0000-0000000000f9' and source = 'partner'), 1, 'an approved partner gets their quarter when they sign up');

-- The coach's own summary.
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-000000000002', true);
select is(public.get_my_billing() -> 'grant' ->> 'source', 'partner', 'get_my_billing reports the active partner quarter');
select ok((public.get_my_billing() -> 'grant' ->> 'ends_at')::timestamptz > now() + interval '90 days', 'and shows Pro through the end of the already-approved next quarter');
reset role;
select set_config('request.jwt.claim.sub', '', true);

select * from finish();
rollback;
