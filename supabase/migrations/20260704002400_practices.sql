create table public.practices (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  template_id uuid references public.templates(id), -- lineage only, never a live binding
  status text not null default 'draft' check (status in ('draft', 'scheduled', 'completed')),
  name text,
  scheduled_at timestamptz,
  created_at timestamptz not null default now(),
  archived_at timestamptz
);

comment on table public.practices is
  'A real instance for one specific roster. No separate "in progress" status here -- that''s "has an active live_session pointing at it," tracked in chunk 4, not duplicated as a second source of truth on this row.';

create index practices_team_id_idx on public.practices (team_id);
