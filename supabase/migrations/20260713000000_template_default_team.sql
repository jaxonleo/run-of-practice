-- The Builder's "Default Team" field on a template was never persisted --
-- pure client-side state recomputed (auto-matched by sport) on every mount,
-- so a coach's explicit "None" choice silently reverted the next time they
-- reopened the template. Templates aren't team-scoped (reusable across every
-- team a coach coaches), so this is nullable and `on delete set null` --
-- deleting a team must not delete a coach's templates.
alter table public.templates add column default_team_id uuid references public.teams(id) on delete set null;

create index templates_default_team_id_idx on public.templates (default_team_id);
