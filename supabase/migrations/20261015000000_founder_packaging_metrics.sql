-- Free / Pro / Organization packaging: the Founder Metrics panel over
-- entitlement_events (handoff "Display rules, components, and
-- analytics"). Same house style as get_founder_metrics_summary/detail
-- (20260717020000): one plpgsql report, is_admin() as the first statement,
-- one jsonb return. entitlement_events is insert-only and unreadable to
-- authenticated, so this SECURITY DEFINER read is the only way in.
--
-- Returns, over the last p_weeks weeks:
--   limit_hits_by_feature: [{feature_key, hits, coaches}] from limit_hit
--   catalog_ctr: [{catalog_id, impressions, clicks, dismisses, ctr}], where
--     impressions = limit_hit + preview_view + moment_shown and
--     ctr = clicks / impressions (null when there are no impressions)
--   free_cap_share: {free_coaches, capped_coaches, share}. Free coaches are
--     profiles with no cohort on the free plan who signed up in the window
--     and were active (any user_events row); capped = those with a
--     limit_hit within 30 days of signup. Founding coaches never count.

create function public.get_founder_packaging_metrics(p_weeks int default 12)
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_since timestamptz;
  v_result jsonb;
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;
  v_since := now() - (greatest(1, least(coalesce(p_weeks, 12), 104)) || ' weeks')::interval;

  with
  ev as (
    select * from public.entitlement_events where created_at >= v_since
  ),
  hits as (
    select feature_key, count(*)::int as hits, count(distinct user_id)::int as coaches
    from ev where event = 'limit_hit' and feature_key is not null
    group by feature_key
  ),
  ctr as (
    select catalog_id,
      count(*) filter (where event in ('limit_hit', 'preview_view', 'moment_shown'))::int as impressions,
      count(*) filter (where event = 'cta_click')::int as clicks,
      count(*) filter (where event = 'dismiss')::int as dismisses
    from ev where catalog_id is not null
    group by catalog_id
  ),
  free_coaches as (
    select p.id, p.created_at
    from public.profiles p
    join public.entitlement_plan_state ps on ps.subject_type = 'user' and ps.user_id = p.id and ps.plan_bundle_key = 'free'
    where p.created_at >= v_since
      and not exists (select 1 from public.entitlement_cohort_assignments ca where ca.subject_type = 'user' and ca.user_id = p.id)
      and exists (select 1 from public.user_events ue where ue.user_id = p.id)
  ),
  capped as (
    select distinct fc.id
    from free_coaches fc
    join public.entitlement_events e on e.user_id = fc.id and e.event = 'limit_hit'
      and e.created_at < fc.created_at + interval '30 days'
  )
  select jsonb_build_object(
    'weeks', greatest(1, least(coalesce(p_weeks, 12), 104)),
    'limit_hits_by_feature', coalesce((select jsonb_agg(to_jsonb(h) order by h.hits desc, h.feature_key) from hits h), '[]'::jsonb),
    'catalog_ctr', coalesce((select jsonb_agg(jsonb_build_object(
        'catalog_id', c.catalog_id, 'impressions', c.impressions, 'clicks', c.clicks, 'dismisses', c.dismisses,
        'ctr', case when c.impressions > 0 then round(c.clicks::numeric / c.impressions, 4) end
      ) order by c.impressions desc, c.catalog_id) from ctr c), '[]'::jsonb),
    'free_cap_share', jsonb_build_object(
      'free_coaches', (select count(*) from free_coaches)::int,
      'capped_coaches', (select count(*) from capped)::int,
      'share', case when (select count(*) from free_coaches) > 0
        then round((select count(*) from capped)::numeric / (select count(*) from free_coaches), 4) end
    )
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.get_founder_packaging_metrics(int) from public;
grant execute on function public.get_founder_packaging_metrics(int) to authenticated;
