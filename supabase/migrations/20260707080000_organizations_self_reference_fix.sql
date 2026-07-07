-- Same self-referential-RETURNING bug class as teams_self_reference_fix and
-- org_members_self_reference_fix, discovered empirically while testing the
-- library-sharing addendum: INSERT INTO organizations ... RETURNING * fails
-- with "new row violates row-level security policy" even though the bare
-- INSERT (no RETURNING) succeeds and a separate follow-up SELECT sees the
-- row fine.
--
-- organizations_select_member relies on is_org_member(id), which in turn
-- depends on the organization_members row that handle_new_organization's
-- AFTER INSERT trigger creates for the creator. That trigger-inserted row
-- isn't reliably visible to the SAME statement's RETURNING policy
-- evaluation -- the same timing class as a literal self-join, just one hop
-- removed via the trigger side effect instead of a direct self-lookup.
--
-- Fix mirrors org_members_select's existing pattern exactly: give the
-- creator a direct, lookup-free "see my own row" branch instead of relying
-- on the trigger's row being visible in time.
drop policy if exists "organizations_select_member" on public.organizations;
create policy "organizations_select_member" on public.organizations
  for select using (
    created_by = auth.uid()
    or public.is_org_member(id)
  );
