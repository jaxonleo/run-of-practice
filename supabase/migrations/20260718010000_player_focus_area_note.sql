-- Freeform per-tag coaching note, e.g. "getting long to the ball" under
-- Bat Path. player_focus_areas previously only recorded *that* a tag was
-- picked as a focus area; the row now doubles as the note's home so a
-- coach can see it at a glance from the roster and from a live station
-- without a second table. Nullable/empty is normal -- most tags on most
-- players will never get a note.
alter table public.player_focus_areas add column note text;

-- The roster's per-tag note field edits an existing row in place (not just
-- insert-then-delete) via upsert on (player_id, skill_tag_id) -- upsert's
-- ON CONFLICT DO UPDATE path is governed by UPDATE policy, not INSERT, and
-- there was never one since the original add/remove UI only ever inserted
-- or deleted whole rows. Same authorization as insert/delete.
create policy "player_focus_areas_update_manage" on public.player_focus_areas
  for update using (
    public.can_manage_team((select team_id from public.players where id = player_id))
  ) with check (
    public.can_manage_team((select team_id from public.players where id = player_id))
  );

grant update on public.player_focus_areas to authenticated;
