-- Third schema gap found starting stage 4: the POC's Intro/Closer checklist
-- activities (a distinct third activity type, with checkable list items)
-- have no representation at all -- type only allowed 'activity' or
-- 'station_block'. Confirmed with Jax this is a real feature to preserve,
-- not a POC affordance to drop.
--
-- Checked/done state deliberately NOT modeled here -- that's live-run state
-- (stage 5, practice_live_sessions/session_activity_log territory), not
-- planning data. These tables hold only the item text and order.
alter table public.practice_activities drop constraint practice_activities_type_check;
alter table public.practice_activities add constraint practice_activities_type_check
  check (type in ('activity', 'station_block', 'checklist'));

alter table public.template_activities drop constraint template_activities_type_check;
alter table public.template_activities add constraint template_activities_type_check
  check (type in ('activity', 'station_block', 'checklist'));

create table public.practice_activity_checklist_items (
  id uuid primary key default gen_random_uuid(),
  practice_activity_id uuid not null references public.practice_activities(id) on delete cascade,
  position int not null,
  text text not null,
  created_at timestamptz not null default now()
);

create table public.template_activity_checklist_items (
  id uuid primary key default gen_random_uuid(),
  template_activity_id uuid not null references public.template_activities(id) on delete cascade,
  position int not null,
  text text not null,
  created_at timestamptz not null default now()
);

create index practice_activity_checklist_items_activity_id_idx on public.practice_activity_checklist_items (practice_activity_id);
create index template_activity_checklist_items_activity_id_idx on public.template_activity_checklist_items (template_activity_id);
