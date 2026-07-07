-- Leaf tags, each tied to one global skill_category so cross-coach reporting
-- still rolls up meaningfully. Hybrid scope:
--   'global' -- curated by Jax, shared by everyone, no owner set
--   'org'    -- an org's shared vocabulary, org_admin-managed
--   'coach'  -- a coach's own private language, never shared even within an org
create table public.skill_tags (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.skill_categories(id) on delete cascade,
  scope text not null check (scope in ('global', 'org', 'coach')),
  organization_id uuid references public.organizations(id) on delete cascade,
  owner_user_id uuid references public.profiles(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint skill_tag_scope_matches_owner check (
    (scope = 'global' and organization_id is null and owner_user_id is null)
    or (scope = 'org' and organization_id is not null and owner_user_id is null)
    or (scope = 'coach' and organization_id is null and owner_user_id is not null)
  )
);

comment on table public.skill_tags is
  'A coach can always use global tags as-is, or add their own private subtags under the same category. Coach-scoped tags are never visible to other coaches, even within the same org -- an org-shared tag is a deliberate org_admin action, not something that leaks automatically from one coach''s shorthand.';

create index skill_tags_category_id_idx on public.skill_tags (category_id);
create index skill_tags_organization_id_idx on public.skill_tags (organization_id);
create index skill_tags_owner_user_id_idx on public.skill_tags (owner_user_id);
