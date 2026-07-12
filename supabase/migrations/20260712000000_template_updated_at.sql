-- Templates only had created_at, no updated_at -- the Library's template
-- cards want to show "last modified" so a coach can tell a stale-looking
-- template apart from one they just touched. Reuses touch_updated_at(),
-- the same trigger function activity_library already uses (see
-- 20260704003300_template_staleness.sql), instead of inventing a new one.
alter table public.templates add column updated_at timestamptz not null default now();

create trigger touch_templates_updated_at
  before update on public.templates
  for each row execute function public.touch_updated_at();
