-- Permissions feature: a head coach and their rostered assistant/helper
-- (linked via team_staff on a PERSONAL team -- org-owned teams already have
-- their own complete, opt-in library-sharing mechanism via
-- activity_library_org_shares, untouched here) each get a reciprocal
-- toggle controlling drill-library visibility, plus a separate,
-- head-coach-only toggle delegating practice-building to one assistant.
--
-- Both toggles live on team_staff (the row that already represents "this
-- specific person is on this specific team") rather than a new table --
-- matches the existing convention of storing per-relationship state
-- directly on team_staff (see welcomed_at/added_by/show_on_home).
alter table public.team_staff add column head_coach_shares_library boolean not null default true;
alter table public.team_staff add column assistant_shares_library boolean not null default true;
alter table public.team_staff add column can_build_practices boolean not null default false;

comment on column public.team_staff.head_coach_shares_library is
  'Set only by whoever can manage the team. Whether this row''s owner (an assistant/helper) can see the head coach''s own non-private drills in Explore and the practice builder.';
comment on column public.team_staff.assistant_shares_library is
  'Set only by this row''s own owner (the assistant/helper). Whether the team''s head coach can see this coach''s own non-private drills in Explore and the practice builder.';
comment on column public.team_staff.can_build_practices is
  'Set only by whoever can manage the team. Delegates building/editing this team''s scheduled practices to this assistant/helper. Defaults false, unlike the library-sharing columns above -- this is a materially bigger grant (write access, not just visibility) and existing relationships should not silently gain it.';

-- "One assistant coach per team can be granted the ability to help build
-- practices" -- enforced at the database level, not just in the UI.
create unique index team_staff_one_delegate_per_team
  on public.team_staff (team_id)
  where can_build_practices and archived_at is null;

-- Per-drill privacy: suppresses the new peer-sharing visibility below
-- (does not affect the existing, separately opt-in org-sharing mechanism,
-- which a coach already has to take an explicit action to enable).
alter table public.activity_library add column is_private boolean not null default false;

comment on column public.activity_library.is_private is
  'When true, this drill is excluded from the default team_staff-peer sharing (head_coach_shares_library/assistant_shares_library on team_staff). Does not affect organization sharing, which already requires an explicit per-drill opt-in via activity_library_org_shares.';
