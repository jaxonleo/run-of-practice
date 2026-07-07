-- Same dual-ownership pattern as activity_library: a coach's own reusable
-- practice plan, usable across every team they coach, OR an org's shared
-- plan (org-admin managed, same as everything else org-scoped).
create table public.templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  owner_user_id uuid references public.profiles(id) on delete cascade,
  sport text not null,
  name text not null,
  description text,
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint template_has_owner check (organization_id is not null or owner_user_id is not null)
);

create index templates_organization_id_idx on public.templates (organization_id);
create index templates_owner_user_id_idx on public.templates (owner_user_id);
