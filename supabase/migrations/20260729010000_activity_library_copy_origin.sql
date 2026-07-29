-- copyDrillToMyLibrary (and the public-catalog copy path that reuses it)
-- has always done a bare INSERT with no trace of where the drill came
-- from -- once copied, "added from another coach's shared drill",
-- "copied from an org library", and "pulled from the public catalog" all
-- collapse into an indistinguishable personally-owned row. Jax wants to
-- filter "My Library" by publisher/source, which needs that lineage to
-- actually survive the copy. Three nullable "copied from" columns, set
-- once at copy time and never touched again -- lineage only, same
-- convention as template_activities.library_activity_id (not a live
-- binding; the original can be renamed/deleted/re-shared afterward
-- without affecting the copy or this pointer other than via the FKs'
-- own on-delete-set-null).
alter table public.activity_library add column copied_from_owner_user_id uuid references public.profiles(id) on delete set null;
alter table public.activity_library add column copied_from_organization_id uuid references public.organizations(id) on delete set null;
alter table public.activity_library add column copied_from_catalog_id uuid references public.content_catalogs(id) on delete set null;

comment on column public.activity_library.copied_from_owner_user_id is
  'Set once, at copy time, to the source drill''s owner_user_id when this row was created via "Copy to My Library" from another coach''s shared drill. Null for self-authored drills and catalog copies. Lineage only -- never updated afterward.';
comment on column public.activity_library.copied_from_organization_id is
  'Set once, at copy time, to the source drill''s organization_id when copied from an org-owned library drill. Lineage only.';
comment on column public.activity_library.copied_from_catalog_id is
  'Set once, at copy time, to the source drill''s source_catalog_id when copied from a public/curated catalog. Lineage only.';
