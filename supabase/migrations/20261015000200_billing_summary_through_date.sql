-- Fix (found in browser QA, 2026-10-15): get_my_billing showed a partner
-- "Pro through" the end of the quarter running now, even when the next
-- quarter was already approved. Grants always stack end to end (renewals
-- and goodwill time start where the last one ends), so the honest date is
-- the latest end among grants still running or queued. Otherwise the body
-- matches 20261015000100.
create or replace function public.get_my_billing()
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_ps record;
  v_grant public.pro_grants;
  v_through timestamptz;
  v_cohort text;
  v_partner text;
begin
  if auth.uid() is null then
    raise exception 'not authorized';
  end if;
  select * into v_ps from public.entitlement_plan_state where subject_type = 'user' and user_id = auth.uid();
  v_grant := public.active_pro_grant(auth.uid());
  select max(ends_at) into v_through from public.pro_grants
    where user_id = auth.uid() and revoked_at is null and ends_at > now();
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
    'grant', case when v_grant.id is null then null else jsonb_build_object('source', v_grant.source, 'ends_at', v_through) end,
    'partner_status', v_partner
  );
end;
$$;
