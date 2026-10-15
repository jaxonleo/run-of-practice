-- Self-serve billing, time-limited Pro grants, and the partner program
-- (2026-10-15). Schema and RPCs only; Stripe is reached exclusively from
-- Edge Functions (stripe-checkout, stripe-portal, stripe-webhook,
-- stripe-admin), never from the browser or from SQL.
--
-- 1. entitlement_plan_state gains the subscription details the Stripe
--    webhook maintains (cancel_at_period_end, the price lookup key, a
--    past_due status). The webhook is the only writer of Stripe fields.
-- 2. pro_grants: time-limited Pro, independent of Stripe, for partner
--    quarters, goodwill time after a problem that was our fault, and admin
--    grants. resolve_entitlement gains one step: override > cohort >
--    active grant (resolves the 'pro' bundle) > plan > registry default.
-- 3. Partner program: public applications, admin approval, and a free Pro
--    quarter per approval, renewed one quarter at a time by the admin.
-- 4. billing_adjustments: an audit row for every refund, credit, discount,
--    or Pro-time grant, written by the stripe-admin function or the grant RPC.
-- 5. stripe_webhook_events: processed event ids, so a redelivered webhook
--    is a no-op.

-- 1. Subscription details on the plan row.
alter table public.entitlement_plan_state
  add column cancel_at_period_end boolean not null default false,
  add column stripe_price_lookup_key text;
alter table public.entitlement_plan_state drop constraint entitlement_plan_state_billing_status_check;
alter table public.entitlement_plan_state add constraint entitlement_plan_state_billing_status_check
  check (billing_status in ('none', 'trialing', 'active', 'past_due', 'canceled'));

-- 2. Time-limited Pro grants.
create table public.pro_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  source text not null check (source in ('partner', 'goodwill', 'admin')),
  starts_at timestamptz not null default now(),
  ends_at timestamptz not null,
  reason text not null,
  partner_application_id uuid,
  granted_by uuid references public.profiles(id) on delete set null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint pro_grants_window check (ends_at > starts_at)
);
create index pro_grants_user_idx on public.pro_grants (user_id, ends_at);

comment on table public.pro_grants is
  'Time-limited Pro, independent of Stripe (partner quarters, goodwill time, admin grants). Active when starts_at <= now() < ends_at and not revoked. Written only by admin RPCs.';

alter table public.pro_grants enable row level security;
create policy "pro_grants_select_own" on public.pro_grants for select to authenticated using (user_id = auth.uid());
revoke all on public.pro_grants from anon, authenticated;
grant select on public.pro_grants to authenticated;
grant select, insert, update, delete on public.pro_grants to service_role;

create function public.active_pro_grant(p_user_id uuid)
returns public.pro_grants
language sql
security definer
stable
set search_path = public
as $$
  select g.* from public.pro_grants g
  where g.user_id = p_user_id and g.revoked_at is null
    and g.starts_at <= now() and g.ends_at > now()
  order by g.ends_at desc
  limit 1;
$$;

revoke all on function public.active_pro_grant(uuid) from public;

-- resolve_entitlement: the original body plus the grant step.
create or replace function public.resolve_entitlement(
  p_subject_type text,
  p_user_id uuid,
  p_organization_id uuid,
  p_feature_key text
)
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_state text;
  v_limit integer;
  v_default_state text;
begin
  select o.state, o.limit_value into v_state, v_limit
  from public.entitlement_overrides o
  where o.feature_key = p_feature_key
    and o.subject_type = p_subject_type
    and ((p_subject_type = 'user' and o.user_id = p_user_id)
      or (p_subject_type = 'organization' and o.organization_id = p_organization_id))
    and (o.expires_at is null or o.expires_at > now());
  if found then
    return jsonb_build_object('state', v_state, 'limit_value', v_limit, 'source', 'override');
  end if;

  select bf.state, bf.limit_value into v_state, v_limit
  from public.entitlement_cohort_assignments ca
  join public.bundle_features bf
    on bf.bundle_key = ca.cohort_bundle_key and bf.feature_key = p_feature_key
  where ca.subject_type = p_subject_type
    and ((p_subject_type = 'user' and ca.user_id = p_user_id)
      or (p_subject_type = 'organization' and ca.organization_id = p_organization_id));
  if found then
    return jsonb_build_object('state', v_state, 'limit_value', v_limit, 'source', 'cohort');
  end if;

  -- An active time-limited grant (partner quarter, goodwill, admin) gives
  -- the Pro bundle for its window, whatever the paid plan says.
  if p_subject_type = 'user' and exists (
    select 1 from public.pro_grants g
    where g.user_id = p_user_id and g.revoked_at is null
      and g.starts_at <= now() and g.ends_at > now()
  ) then
    select bf.state, bf.limit_value into v_state, v_limit
    from public.bundle_features bf
    where bf.bundle_key = 'pro' and bf.feature_key = p_feature_key;
    if found then
      return jsonb_build_object('state', v_state, 'limit_value', v_limit, 'source', 'grant');
    end if;
  end if;

  select bf.state, bf.limit_value into v_state, v_limit
  from public.entitlement_plan_state ps
  join public.bundle_features bf
    on bf.bundle_key = ps.plan_bundle_key and bf.feature_key = p_feature_key
  where ps.subject_type = p_subject_type
    and ((p_subject_type = 'user' and ps.user_id = p_user_id)
      or (p_subject_type = 'organization' and ps.organization_id = p_organization_id));
  if found then
    return jsonb_build_object('state', v_state, 'limit_value', v_limit, 'source', 'plan');
  end if;

  select f.default_state into v_default_state
  from public.features f where f.feature_key = p_feature_key;

  return jsonb_build_object('state', v_default_state, 'limit_value', null, 'source', 'default');
end;
$$;

-- 3. Partner program.
create table public.partner_applications (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  name text not null,
  user_id uuid references public.profiles(id) on delete set null,
  sport text,
  team_level text,
  message text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined', 'ended')),
  admin_note text,
  decided_by uuid references public.profiles(id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create index partner_applications_email_idx on public.partner_applications (lower(email));

alter table public.pro_grants
  add constraint pro_grants_partner_application_fk
  foreign key (partner_application_id) references public.partner_applications(id) on delete set null;

comment on table public.partner_applications is
  'Run of Practice partner program applications. Approval grants a free Pro quarter (pro_grants, source partner); the admin approves each further quarter. Written only through submit_partner_application and admin RPCs.';

alter table public.partner_applications enable row level security;
create policy "partner_applications_select_own" on public.partner_applications
  for select to authenticated using (user_id = auth.uid());
revoke all on public.partner_applications from anon, authenticated;
grant select on public.partner_applications to authenticated;
grant select, insert, update, delete on public.partner_applications to service_role;

-- Public submission (signed in or not). One open (pending or approved)
-- application per email; a repeat submission updates the details instead.
create function public.submit_partner_application(
  p_name text, p_email text, p_sport text default null, p_team_level text default null, p_message text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_id uuid;
  -- Link the application to the signed-in account only when that
  -- account's own email is the one entered. Otherwise anyone signed in
  -- could apply under someone else's email and collect the free quarter
  -- themselves; unlinked applications are matched by email at approval.
  v_self uuid := case when lower(coalesce(auth.jwt() ->> 'email', '')) = lower(trim(coalesce(p_email, ''))) then auth.uid() end;
begin
  if length(trim(coalesce(p_name, ''))) = 0 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'A name and a valid email are required.';
  end if;
  if length(coalesce(p_message, '')) > 4000 or length(p_name) > 200 then
    raise exception 'That is too long.';
  end if;

  select id into v_id from public.partner_applications
  where lower(email) = v_email and status in ('pending', 'approved')
  order by created_at desc limit 1;

  if v_id is not null then
    update public.partner_applications
      set name = trim(p_name), sport = p_sport, team_level = p_team_level,
          message = coalesce(p_message, message), user_id = coalesce(user_id, v_self)
      where id = v_id;
    return v_id;
  end if;

  insert into public.partner_applications (email, name, user_id, sport, team_level, message)
  values (v_email, trim(p_name), v_self, p_sport, p_team_level, p_message)
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.submit_partner_application(text, text, text, text, text) from public;
grant execute on function public.submit_partner_application(text, text, text, text, text) to anon, authenticated;

-- Email Jax about a new application. The functions URL comes from a
-- per-environment Vault entry (functions_base_url), not a hardcoded
-- project ref, so staging calls staging and production calls production.
create function public.notify_partner_application_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secret text;
  v_base text;
begin
  begin
    select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'team_staff_notify_webhook_secret';
    select decrypted_secret into v_base from vault.decrypted_secrets where name = 'functions_base_url';
    if v_base is null then
      raise warning 'functions_base_url is not set in Vault; partner application % not emailed', new.id;
      return new;
    end if;
    perform net.http_post(
      url := v_base || '/notify-partner-application',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', v_secret),
      body := jsonb_build_object('application_id', new.id)
    );
  exception when others then
    raise warning 'notify_partner_application_created failed to enqueue for %: %', new.id, sqlerrm;
  end;
  return new;
end;
$$;

create trigger on_partner_application_created_notify
  after insert on public.partner_applications
  for each row execute function public.notify_partner_application_created();

-- A coach approved before they had an account gets their first quarter
-- the moment they sign up with the same email.
create function public.grant_pending_partner_quarter()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_app record;
begin
  select * into v_app from public.partner_applications
  where lower(email) = lower(new.email) and status = 'approved'
    and not exists (select 1 from public.pro_grants g where g.partner_application_id = partner_applications.id)
  order by decided_at desc limit 1;
  if found then
    update public.partner_applications set user_id = new.id where id = v_app.id;
    insert into public.pro_grants (user_id, source, starts_at, ends_at, reason, partner_application_id, granted_by)
    values (new.id, 'partner', now(), now() + interval '3 months', 'Partner program: first quarter (granted at signup)', v_app.id, v_app.decided_by);
  end if;
  return new;
end;
$$;

create trigger on_profile_created_partner_quarter
  after insert on public.profiles
  for each row execute function public.grant_pending_partner_quarter();

-- 4. Audit of every billing make-good.
create table public.billing_adjustments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('refund', 'credit', 'discount', 'pro_time')),
  amount_cents integer,
  currency text default 'usd',
  stripe_object_id text,
  reason text not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index billing_adjustments_user_idx on public.billing_adjustments (user_id, created_at desc);
alter table public.billing_adjustments enable row level security;
revoke all on public.billing_adjustments from anon, authenticated;
grant select, insert, update, delete on public.billing_adjustments to service_role;

-- 5. Webhook idempotency.
create table public.stripe_webhook_events (
  id text primary key,
  type text not null,
  received_at timestamptz not null default now()
);
alter table public.stripe_webhook_events enable row level security;
revoke all on public.stripe_webhook_events from anon, authenticated;
grant select, insert, update, delete on public.stripe_webhook_events to service_role;

-- 6. The coach's own billing summary (Settings > Plan & billing).
create function public.get_my_billing()
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_ps record;
  v_grant public.pro_grants;
  v_cohort text;
  v_partner text;
begin
  if auth.uid() is null then
    raise exception 'not authorized';
  end if;
  select * into v_ps from public.entitlement_plan_state where subject_type = 'user' and user_id = auth.uid();
  v_grant := public.active_pro_grant(auth.uid());
  select cohort_bundle_key into v_cohort from public.entitlement_cohort_assignments where subject_type = 'user' and user_id = auth.uid();
  select status into v_partner from public.partner_applications where user_id = auth.uid() order by created_at desc limit 1;
  return jsonb_build_object(
    'plan', coalesce(v_ps.plan_bundle_key, 'free'),
    'billing_status', coalesce(v_ps.billing_status, 'none'),
    'cancel_at_period_end', coalesce(v_ps.cancel_at_period_end, false),
    'current_period_end', v_ps.current_period_end,
    'price_lookup_key', v_ps.stripe_price_lookup_key,
    'has_stripe_customer', v_ps.stripe_customer_id is not null,
    'cohort', v_cohort,
    'grant', case when v_grant.id is null then null else jsonb_build_object('source', v_grant.source, 'ends_at', v_grant.ends_at) end,
    'partner_status', v_partner
  );
end;
$$;

revoke all on function public.get_my_billing() from public;
grant execute on function public.get_my_billing() to authenticated;

-- 7. Admin RPCs (each re-checks is_admin(), same pattern as admin_set_plan).
create function public.admin_grant_pro_time(p_user_id uuid, p_days integer, p_reason text, p_source text default 'goodwill')
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_start timestamptz;
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  if p_days is null or p_days < 1 or p_days > 366 then raise exception 'days must be between 1 and 366'; end if;
  if length(trim(coalesce(p_reason, ''))) = 0 then raise exception 'a reason is required'; end if;
  if p_source not in ('goodwill', 'admin') then raise exception 'invalid source'; end if;
  -- Stack after any grant still running, so extra time is never swallowed.
  select greatest(now(), coalesce(max(ends_at), now())) into v_start
  from public.pro_grants where user_id = p_user_id and revoked_at is null and ends_at > now();
  insert into public.pro_grants (user_id, source, starts_at, ends_at, reason, granted_by)
  values (p_user_id, p_source, v_start, v_start + make_interval(days => p_days), trim(p_reason), auth.uid())
  returning id into v_id;
  insert into public.billing_adjustments (user_id, kind, reason, created_by)
  values (p_user_id, 'pro_time', p_days || ' days of Pro: ' || trim(p_reason), auth.uid());
  return v_id;
end;
$$;

create function public.admin_revoke_pro_grant(p_grant_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  update public.pro_grants set revoked_at = now() where id = p_grant_id and revoked_at is null;
end;
$$;

create function public.admin_get_billing(p_user_id uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_ps record;
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  select * into v_ps from public.entitlement_plan_state where subject_type = 'user' and user_id = p_user_id;
  return jsonb_build_object(
    'plan', v_ps.plan_bundle_key,
    'billing_status', v_ps.billing_status,
    'cancel_at_period_end', v_ps.cancel_at_period_end,
    'current_period_end', v_ps.current_period_end,
    'price_lookup_key', v_ps.stripe_price_lookup_key,
    'stripe_customer_id', v_ps.stripe_customer_id,
    'stripe_subscription_id', v_ps.stripe_subscription_id,
    'grants', coalesce((select jsonb_agg(jsonb_build_object(
        'id', g.id, 'source', g.source, 'starts_at', g.starts_at, 'ends_at', g.ends_at,
        'reason', g.reason, 'revoked_at', g.revoked_at,
        'active', g.revoked_at is null and g.starts_at <= now() and g.ends_at > now()
      ) order by g.ends_at desc) from public.pro_grants g where g.user_id = p_user_id), '[]'::jsonb),
    'adjustments', coalesce((select jsonb_agg(jsonb_build_object(
        'kind', a.kind, 'amount_cents', a.amount_cents, 'currency', a.currency, 'reason', a.reason,
        'stripe_object_id', a.stripe_object_id, 'created_at', a.created_at
      ) order by a.created_at desc) from public.billing_adjustments a where a.user_id = p_user_id), '[]'::jsonb)
  );
end;
$$;

-- Partner administration. "Due" means an approved partner whose latest
-- quarter ends within 14 days (or already ended) with no later quarter.
create function public.admin_list_partners()
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  return coalesce((
    select jsonb_agg(row_to_json(x) order by x.renewal_due desc, x.created_at desc)
    from (
      select a.id, a.email, a.name, a.sport, a.team_level, a.message, a.status, a.admin_note,
             a.created_at, a.decided_at,
             coalesce(a.user_id, p.id) as user_id,
             (coalesce(a.user_id, p.id) is not null) as has_account,
             q.latest_end, q.quarters,
             (a.status = 'approved' and q.latest_end is not null and q.latest_end < now() + interval '14 days') as renewal_due
      from public.partner_applications a
      left join public.profiles p on a.user_id is null and lower(p.email) = lower(a.email)
      left join lateral (
        select max(g.ends_at) as latest_end, count(*)::int as quarters
        from public.pro_grants g where g.partner_application_id = a.id and g.revoked_at is null
      ) q on true
    ) x
  ), '[]'::jsonb);
end;
$$;

create function public.admin_partner_renewals_due()
returns integer
language sql
security definer
stable
set search_path = public
as $$
  select case when public.is_admin() then (
    select count(*)::int from public.partner_applications a
    where a.status = 'approved'
      and (select max(g.ends_at) from public.pro_grants g where g.partner_application_id = a.id and g.revoked_at is null)
          < now() + interval '14 days'
  ) else 0 end;
$$;

-- Approve (first quarter, or held until they sign up), decline, renew one
-- more quarter, or end the partnership (the current quarter runs out).
create function public.admin_decide_partner(p_application_id uuid, p_action text, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_app record;
  v_user uuid;
  v_start timestamptz;
  v_quarters integer;
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  select * into v_app from public.partner_applications where id = p_application_id for update;
  if not found then raise exception 'application not found'; end if;
  v_user := coalesce(v_app.user_id, (select id from public.profiles where lower(email) = lower(v_app.email) limit 1));

  if p_action = 'decline' then
    update public.partner_applications set status = 'declined', admin_note = coalesce(p_note, admin_note), decided_by = auth.uid(), decided_at = now() where id = v_app.id;
  elsif p_action = 'end' then
    update public.partner_applications set status = 'ended', admin_note = coalesce(p_note, admin_note), decided_by = auth.uid(), decided_at = now() where id = v_app.id;
  elsif p_action in ('approve', 'renew') then
    if p_action = 'renew' and v_app.status <> 'approved' then raise exception 'only an approved partner can be renewed'; end if;
    update public.partner_applications
      set status = 'approved', user_id = coalesce(user_id, v_user), admin_note = coalesce(p_note, admin_note),
          decided_by = auth.uid(), decided_at = now()
      where id = v_app.id;
    if v_user is not null then
      select greatest(now(), coalesce(max(ends_at), now())), count(*) into v_start, v_quarters
      from public.pro_grants where partner_application_id = v_app.id and revoked_at is null;
      if p_action = 'approve' and v_quarters > 0 then
        return; -- already has a quarter; renewing is a separate, deliberate step
      end if;
      insert into public.pro_grants (user_id, source, starts_at, ends_at, reason, partner_application_id, granted_by)
      values (v_user, 'partner', v_start, v_start + interval '3 months',
              'Partner program: quarter ' || (v_quarters + 1) || coalesce(' (' || p_note || ')', ''), v_app.id, auth.uid());
      insert into public.billing_adjustments (user_id, kind, reason, created_by)
      values (v_user, 'pro_time', 'Partner program quarter ' || (v_quarters + 1), auth.uid());
    end if;
  else
    raise exception 'invalid action';
  end if;
end;
$$;

revoke all on function public.admin_grant_pro_time(uuid, integer, text, text) from public;
revoke all on function public.admin_revoke_pro_grant(uuid) from public;
revoke all on function public.admin_get_billing(uuid) from public;
revoke all on function public.admin_list_partners() from public;
revoke all on function public.admin_partner_renewals_due() from public;
revoke all on function public.admin_decide_partner(uuid, text, text) from public;
grant execute on function public.admin_grant_pro_time(uuid, integer, text, text) to authenticated;
grant execute on function public.admin_revoke_pro_grant(uuid) to authenticated;
grant execute on function public.admin_get_billing(uuid) to authenticated;
grant execute on function public.admin_list_partners() to authenticated;
grant execute on function public.admin_partner_renewals_due() to authenticated;
grant execute on function public.admin_decide_partner(uuid, text, text) to authenticated;
