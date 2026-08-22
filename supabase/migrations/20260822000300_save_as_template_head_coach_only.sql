-- Delegated Planning spec, Section 6: Save as Template is head-coach-only.
--
-- Today templates_insert_manage only checks "you own the row you're
-- creating" (can_manage_owned, satisfied by any signed-in coach inserting
-- with their own owner_user_id) -- there is no team-role check at all, so
-- any rostered team_staff member (including a plain helper) can already
-- save a personal template from a practice they can merely view. Rather
-- than rewrite saveTemplateTree/saveActivityTree's whole client-side
-- insert path into a new SQL RPC (a much larger, riskier change than this
-- spec needs), this adds one lineage-pointer column -- the same "copy, not
-- reference" convention already used for copied_from_owner_user_id and
-- every library_activity_id pointer -- and threads one extra RLS branch
-- through the existing policy.
--
-- Library's own from-scratch Create Template flow (NewLibraryScreen.jsx)
-- never sets this column, so it stays exactly as unrestricted as it is
-- today -- this only restricts the specific "save a historical team
-- practice as a template" action the spec means by "Save as Template".
alter table public.templates
  add column source_practice_id uuid references public.practices(id) on delete set null;

drop policy if exists "templates_insert_manage" on public.templates;
create policy "templates_insert_manage" on public.templates
  for insert with check (
    public.can_manage_owned(organization_id, owner_user_id)
    and (location_id is null or public.can_access_location(location_id))
    and (source_practice_id is null or public.can_manage_team(
      (select p.team_id from public.practices p where p.id = source_practice_id)
    ))
  );
