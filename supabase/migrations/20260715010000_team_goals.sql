-- Goals feature (ROP-Goals-TeamNav-Handoff.md §2.2). A head coach's target
-- time-allocation percentage per skill tag per team. Sum <= 100 is
-- app-level validation (Goals editor), not a DB constraint -- cross-row
-- constraints via triggers are not a pattern this schema uses anywhere, and
-- targets need not sum to exactly 100 (a coach may set goals for only a
-- few of their skill tags). Archive-only, same as every other table here:
-- edits are UPDATEs, removing a goal sets archived_at, no DELETE policy.
create table public.team_goals (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  skill_tag_id uuid not null references public.skill_tags(id) on delete cascade,
  target_pct numeric(5,2) not null
    constraint team_goals_target_pct_range check (target_pct > 0 and target_pct <= 100),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  archived_at timestamptz
);

-- One active target per (team, tag) -- re-setting a goal is an UPDATE on the
-- existing active row, not a new row alongside it.
create unique index team_goals_active_unique
  on public.team_goals (team_id, skill_tag_id) where archived_at is null;
create index team_goals_team_id_idx on public.team_goals (team_id);

alter table public.team_goals enable row level security;

-- Select: anyone who can see the team (assistants/helpers included, matching
-- the rest of this schema's broad-read/narrow-write pattern). Manage: same
-- can_manage_team gate as practices/templates -- head coach, org admin, or
-- personal owner.
create policy team_goals_select_access on public.team_goals
  for select to authenticated using (public.can_access_team(team_id));
create policy team_goals_insert_manage on public.team_goals
  for insert to authenticated
  with check (public.can_manage_team(team_id) and created_by = auth.uid());
create policy team_goals_update_manage on public.team_goals
  for update to authenticated
  using (public.can_manage_team(team_id))
  with check (public.can_manage_team(team_id));

grant select, insert, update on public.team_goals to authenticated;
