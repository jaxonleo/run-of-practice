-- Entitlement architecture, Phase 3, gate 3 of 3: personal drill library
-- size (library.personal_drills, ported from PLAN_LIMITS.personalDrills).
--
-- Unlike the other two gates, this one is purely per-user -- a personal
-- drill (organization_id is null) always belongs to its owner alone, no
-- team/org ambiguity to resolve, so this reads directly off auth.uid()
-- rather than going through team_entitlement_subject. Org-owned drills
-- (organization_id is not null) are a completely separate branch of the
-- same policy and are untouched -- org membership was never limited by a
-- personal drill count, and still isn't.
--
-- Enforced on the RLS policy itself, not inside create_drill_with_equipment
-- (20260901000100_atomic_drill_write.sql): that RPC is explicitly SECURITY
-- INVOKER specifically so its own inserts still pass through this exact
-- policy -- putting the check here means it's live for that RPC and any
-- direct .insert() call alike, one choke point instead of two copies.
create function public.can_create_personal_drill()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select public.can_use_counted_feature(
    'library.personal_drills',
    (select count(*)::integer from public.activity_library
      where owner_user_id = auth.uid() and organization_id is null and archived_at is null),
    'user', auth.uid(), null
  );
$$;

revoke all on function public.can_create_personal_drill() from public;
grant execute on function public.can_create_personal_drill() to authenticated;

drop policy if exists "activity_library_insert_manage" on public.activity_library;
create policy "activity_library_insert_manage" on public.activity_library
  for insert with check (
    (
      public.can_manage_owned(organization_id, owner_user_id)
      and (organization_id is not null or public.can_create_personal_drill())
    )
    or (source_catalog_id is not null and public.is_admin())
  );
