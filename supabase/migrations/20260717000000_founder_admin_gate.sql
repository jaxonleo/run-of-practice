-- Founder-only metrics gate (ROP-Founder-Metrics-Handoff.md §1.1). No
-- founder/platform-admin concept exists anywhere in this schema yet --
-- is_org_admin() is scoped to a single organization and doesn't generalize.
-- Same discipline as every other client-invisible table here (user_events,
-- admin_users itself): RLS enabled, zero policies, no grants -- reachable
-- only through the SECURITY DEFINER function below.
create table public.admin_users (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.admin_users enable row level security;

create function public.is_admin()
returns boolean
language sql security definer stable set search_path = public
as $$
  select exists (select 1 from public.admin_users where user_id = auth.uid());
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

-- Seed the founder account directly by email rather than a placeholder
-- UUID -- avoids a manual follow-up step after this migration runs.
insert into public.admin_users (user_id)
select id from public.profiles where email = 'jaxonleo@gmail.com'
on conflict do nothing;
