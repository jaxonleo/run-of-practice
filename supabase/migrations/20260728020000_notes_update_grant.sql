-- 20260728010000 added a notes_update_archive RLS policy but forgot the
-- underlying GRANT UPDATE -- RLS policies are meaningless without the
-- base table privilege they're layered on. Caught by testing the archive
-- path directly rather than assuming the policy alone was enough.
grant update on public.notes to authenticated;
