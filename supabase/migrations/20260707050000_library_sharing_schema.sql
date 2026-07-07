-- Library sharing addendum (decided 2026-07-06): coach-owned drills and
-- templates can be shared with ONE org the coach belongs to. Deliberately
-- separate from `organization_id` (org-OWNED, admin-curated) -- conflating
-- the two would destroy the "Org Library" vs "From Our Coaches" shelf
-- distinction. Multi-org sharing is deferred; a join table is a mechanical
-- migration later if demand appears.
alter table public.activity_library add column shared_with_organization_id uuid references public.organizations(id);
alter table public.templates add column shared_with_organization_id uuid references public.organizations(id);

-- Only coach-owned rows may be shared -- an org-owned row sharing itself
-- with an org is meaningless and must be impossible.
alter table public.activity_library add constraint activity_library_share_owner_only check (
  shared_with_organization_id is null or owner_user_id is not null
);
alter table public.templates add constraint templates_share_owner_only check (
  shared_with_organization_id is null or owner_user_id is not null
);

create index activity_library_shared_with_organization_id_idx on public.activity_library (shared_with_organization_id);
create index templates_shared_with_organization_id_idx on public.templates (shared_with_organization_id);
