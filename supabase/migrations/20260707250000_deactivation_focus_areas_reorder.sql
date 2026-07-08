-- Account deactivation: soft, reversible. A coach can "close" their
-- account without losing anything -- app-level logic clears this
-- automatically the next time they sign back in (no separate reactivation
-- flow). Uses the existing profiles_update_own policy, no RLS change
-- needed since that policy has no column restriction.
alter table public.profiles add column deactivated_at timestamptz;

-- Structured focus areas, replacing the old freeform players.focus_areas
-- text[]. Reuses the skill_tags taxonomy already built for drill tagging
-- (global tags for cross-team reporting, coach-scope tags for a coach's
-- own detail under a category) instead of inventing a second tagging
-- system. created_by is nullable + SET NULL from the start (not an
-- afterthought this time -- see rop_actor_deletion_fk_gotcha memory).
create table public.player_focus_areas (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete cascade,
  skill_tag_id uuid not null references public.skill_tags(id) on delete cascade,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (player_id, skill_tag_id)
);

alter table public.player_focus_areas enable row level security;

create policy "player_focus_areas_select_access" on public.player_focus_areas
  for select using (public.can_access_team((select team_id from public.players where id = player_id)));

create policy "player_focus_areas_insert_manage" on public.player_focus_areas
  for insert with check (
    public.can_manage_team((select team_id from public.players where id = player_id))
    and created_by = auth.uid()
  );

create policy "player_focus_areas_delete_manage" on public.player_focus_areas
  for delete using (public.can_manage_team((select team_id from public.players where id = player_id)));

grant select, insert, delete on public.player_focus_areas to authenticated;

-- Manual drill reordering within a coach's own library -- dropped in stage
-- 3 as "no position column", restored now since it turned out to matter
-- for real coaches. Scoped per-owner at the application layer (no DB
-- constraint), same as everywhere else position is just an ORDER BY hint.
alter table public.activity_library add column position int not null default 0;
