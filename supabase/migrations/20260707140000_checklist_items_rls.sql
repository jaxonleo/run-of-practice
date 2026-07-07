-- Same join-shaped pattern as activity_library_equipment/drill_tags: real
-- delete allowed (editing a checklist's items is a normal edit, not
-- historical data), no update policy -- edits happen via delete+reinsert.
alter table public.practice_activity_checklist_items enable row level security;
alter table public.template_activity_checklist_items enable row level security;

create policy "practice_activity_checklist_items_select_access" on public.practice_activity_checklist_items
  for select using (public.can_access_practice_activity(practice_activity_id));
create policy "practice_activity_checklist_items_insert_manage" on public.practice_activity_checklist_items
  for insert with check (public.can_manage_practice_activity(practice_activity_id));
create policy "practice_activity_checklist_items_delete_manage" on public.practice_activity_checklist_items
  for delete using (public.can_manage_practice_activity(practice_activity_id));

create policy "template_activity_checklist_items_select_access" on public.template_activity_checklist_items
  for select using (public.can_access_template_activity(template_activity_id));
create policy "template_activity_checklist_items_insert_manage" on public.template_activity_checklist_items
  for insert with check (public.can_manage_template_activity(template_activity_id));
create policy "template_activity_checklist_items_delete_manage" on public.template_activity_checklist_items
  for delete using (public.can_manage_template_activity(template_activity_id));

grant select, insert, delete on public.practice_activity_checklist_items to authenticated;
grant select, insert, delete on public.template_activity_checklist_items to authenticated;
