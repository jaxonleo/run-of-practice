-- Benchmarks: define a repeatable test once, measure it an unlimited number of
-- future times, compare equivalent measurements fairly.
-- Spec: ROP-Benchmarks-Claude-Code-Handoff.md, sections 2, 3, 5, 6, 9.
--
-- This migration is the persistence and authorization layer only: tables,
-- constraints, indexes, RLS, grants and the can_* helper functions. The
-- lifecycle RPCs (create / version / adopt / resolve occurrence / join /
-- save attempt / finalize / reopen / archive / target / baseline / grants,
-- plus the token-scoped helper RPCs) land in 20260908000100. Reporting RPCs
-- come later, with the reporting UI.
--
-- Ownership and RLS follow this schema's existing patterns exactly:
--   * a definition is coach-or-org "owned" (owner_user_id XOR organization_id),
--     checked with can_access_owned / can_manage_owned, same as activity_library
--   * everything measured is team-scoped, checked with can_access_team /
--     can_coach_team / can_manage_team
--   * historical analytics access is can_view_goals_for_team, reused verbatim
--   * the anonymous helper tier gets a distinct hashed bearer token and never
--     any direct table grant; every read/write goes through a SECURITY DEFINER
--     RPC that validates the grant inside itself

-- ─────────────────────────────────────────────────────────────────────────────
-- benchmarks: reusable identity and Library item (handoff 9.1)
-- ─────────────────────────────────────────────────────────────────────────────
create table public.benchmarks (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid references public.profiles(id) on delete set null,
  organization_id uuid references public.organizations(id) on delete cascade,
  sport text not null,
  title text not null,
  -- Individual-player vs whole-team is fixed for the life of the benchmark
  -- identity (handoff 2.1: "immutable within the protocol version"); there is
  -- deliberately no RPC to change it.
  subject_mode text not null check (subject_mode in ('individual', 'team')),
  -- Provenance only, never a live dependency (handoff 3.1 "Create Benchmark
  -- from Drill", 3.4 copies). Both null for a from-scratch benchmark.
  source_drill_id uuid references public.activity_library(id) on delete set null,
  source_benchmark_id uuid references public.benchmarks(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint benchmarks_owner_xor_org check ((owner_user_id is null) <> (organization_id is null))
);
create index benchmarks_owner_idx on public.benchmarks (owner_user_id) where owner_user_id is not null;
create index benchmarks_org_idx on public.benchmarks (organization_id) where organization_id is not null;
create index benchmarks_sport_idx on public.benchmarks (sport);
create trigger touch_benchmarks_updated_at before update on public.benchmarks
  for each row execute function public.touch_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- benchmark_versions: immutable protocol definition (handoff 2, 3.3, 3.4)
-- ─────────────────────────────────────────────────────────────────────────────
create table public.benchmark_versions (
  id uuid primary key default gen_random_uuid(),
  benchmark_id uuid not null references public.benchmarks(id) on delete cascade,
  version_number integer not null,
  metric_type text not null check (metric_type in ('time', 'count', 'distance', 'speed', 'success_rate', 'score_numeric', 'score_rubric')),
  direction text not null check (direction in ('higher', 'lower', 'track')),
  result_rule text not null check (result_rule in ('single', 'best', 'average', 'total', 'pooled')),
  scored_attempts integer not null check (scored_attempts >= 1 and scored_attempts <= 20),
  opportunities_per_set integer check (opportunities_per_set is null or opportunities_per_set > 0),
  -- [{ id, order, label, description }], ascending order, >= 2 entries.
  rubric_levels jsonb,
  score_min numeric,
  score_max numeric,
  score_increment numeric check (score_increment is null or score_increment > 0),
  display_unit text,
  instructions text not null,
  -- { distance, timedWindowSeconds, surfaceSetup, scoringCriteria }
  protocol_conditions jsonb,
  invalid_guidance text,
  planned_minutes integer,
  -- Durable snapshots so a historical assessment still renders after the
  -- source drill / tags / equipment are edited or archived (handoff 3.4, 9.1).
  equipment_snapshot jsonb not null default '[]'::jsonb,
  skill_tag_ids uuid[] not null default '{}',
  tag_snapshot text[] not null default '{}',
  title_snapshot text not null,
  -- Append-only record of audited wording corrections after first use
  -- (handoff 3.4: "Clarify wording" never changes structured scoring fields).
  metadata_corrections jsonb not null default '[]'::jsonb,
  -- Once an assessment has used this version its structural fields are frozen;
  -- a structural change is a new version (enforced by trigger below).
  first_used_at timestamptz,
  superseded_by uuid references public.benchmark_versions(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (benchmark_id, version_number),
  constraint benchmark_versions_success_rate_shape check (
    metric_type <> 'success_rate' or (opportunities_per_set is not null and result_rule in ('single', 'pooled'))
  ),
  constraint benchmark_versions_rubric_shape check (
    metric_type <> 'score_rubric' or (jsonb_typeof(rubric_levels) = 'array' and jsonb_array_length(rubric_levels) >= 2 and result_rule = 'single')
  ),
  constraint benchmark_versions_score_numeric_shape check (
    metric_type <> 'score_numeric' or (score_min is not null and score_max is not null and score_increment is not null and score_max > score_min)
  ),
  constraint benchmark_versions_track_shape check (
    direction <> 'track' or result_rule in ('single', 'average', 'total')
  )
);
create index benchmark_versions_benchmark_idx on public.benchmark_versions (benchmark_id, version_number desc);

create function public.benchmark_version_lock() returns trigger
language plpgsql set search_path to 'public' as $$
begin
  if OLD.first_used_at is not null and (
    NEW.metric_type is distinct from OLD.metric_type
    or NEW.direction is distinct from OLD.direction
    or NEW.result_rule is distinct from OLD.result_rule
    or NEW.scored_attempts is distinct from OLD.scored_attempts
    or NEW.opportunities_per_set is distinct from OLD.opportunities_per_set
    or NEW.rubric_levels is distinct from OLD.rubric_levels
    or NEW.score_min is distinct from OLD.score_min
    or NEW.score_max is distinct from OLD.score_max
    or NEW.score_increment is distinct from OLD.score_increment
    or NEW.protocol_conditions is distinct from OLD.protocol_conditions
    or NEW.benchmark_id is distinct from OLD.benchmark_id
  ) then
    raise exception 'benchmark_version % is immutable after first use; create a new version for a structural change', OLD.id
      using errcode = 'check_violation';
  end if;
  return NEW;
end;
$$;
create trigger benchmark_versions_lock_structural before update on public.benchmark_versions
  for each row execute function public.benchmark_version_lock();

-- ─────────────────────────────────────────────────────────────────────────────
-- team_benchmarks: a team's durable adoption of a benchmark version (9.1)
-- Adding a definition to a team's plan establishes lasting team access to that
-- version so it can be measured again if the author later leaves (handoff 3.4).
-- ─────────────────────────────────────────────────────────────────────────────
create table public.team_benchmarks (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  benchmark_id uuid not null references public.benchmarks(id) on delete cascade,
  adopted_version_id uuid not null references public.benchmark_versions(id),
  baseline_assessment_id uuid,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (team_id, benchmark_id)
);
create index team_benchmarks_team_idx on public.team_benchmarks (team_id) where archived_at is null;
create trigger touch_team_benchmarks_updated_at before update on public.team_benchmarks
  for each row execute function public.touch_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- benchmark_target_revisions: team/version threshold + attainment (7.7, 9.1)
-- ─────────────────────────────────────────────────────────────────────────────
create table public.benchmark_target_revisions (
  id uuid primary key default gen_random_uuid(),
  team_benchmark_id uuid not null references public.team_benchmarks(id) on delete cascade,
  protocol_version_id uuid not null references public.benchmark_versions(id),
  threshold_value numeric,
  threshold_proportion numeric check (threshold_proportion is null or (threshold_proportion >= 0 and threshold_proportion <= 1)),
  threshold_level_order integer,
  -- whole-number percentage of MEASURED players expected to meet the threshold
  attainment_percent integer check (attainment_percent is null or (attainment_percent >= 0 and attainment_percent <= 100)),
  season_label text,
  effective_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index benchmark_target_revisions_lookup_idx
  on public.benchmark_target_revisions (team_benchmark_id, protocol_version_id, effective_at desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- benchmark_assessments: one occasion of measuring one version for one team
-- ─────────────────────────────────────────────────────────────────────────────
create table public.benchmark_assessments (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  benchmark_id uuid not null references public.benchmarks(id),
  protocol_version_id uuid not null references public.benchmark_versions(id),
  live_session_id uuid references public.practice_live_sessions(id) on delete set null,
  practice_id uuid references public.practices(id) on delete set null,
  label text,
  -- The measurement moment in the team's timezone semantics; entry/backdate
  -- allowed, actual created_at/updated_at retained separately (handoff 4.3).
  measured_at timestamptz not null,
  measured_local_date date not null,
  timezone text not null,
  state text not null default 'recording' check (state in ('recording', 'finalized', 'archived')),
  -- A reopened finalized assessment: temporarily out of official aggregates,
  -- shown as "Under correction" rather than vanishing (handoff 5.1).
  under_correction boolean not null default false,
  prior_state text,
  conditions_note text,
  excluded_from_comparisons boolean not null default false,
  excluded_reason text,
  -- Frozen expected/participating roster at finalization (handoff 5.2).
  participant_roster_snapshot jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finalized_at timestamptz,
  finalized_by uuid references public.profiles(id) on delete set null,
  reopened_at timestamptz,
  reopened_by uuid references public.profiles(id) on delete set null
);
create index benchmark_assessments_team_version_idx
  on public.benchmark_assessments (team_id, protocol_version_id, measured_at desc);
create index benchmark_assessments_benchmark_idx on public.benchmark_assessments (benchmark_id);
create index benchmark_assessments_live_session_idx
  on public.benchmark_assessments (live_session_id) where live_session_id is not null;
create trigger touch_benchmark_assessments_updated_at before update on public.benchmark_assessments
  for each row execute function public.touch_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- benchmark_assessment_sources: the planned occurrence(s) an assessment covers
-- One assessment per occurrence key; two stations that deliberately share a
-- test attach a second source row to the same assessment (handoff 4.2, 9.1).
-- ─────────────────────────────────────────────────────────────────────────────
create table public.benchmark_assessment_sources (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references public.benchmark_assessments(id) on delete cascade,
  -- Deterministic identity for a planned occurrence, resolved by the client:
  -- 'pa:<practice_activity_id>', 'st:<station_id>', 'manual:<uuid>'. Never
  -- inferred from date / name / activity order (handoff 4.2).
  occurrence_key text not null,
  practice_id uuid references public.practices(id) on delete set null,
  practice_activity_id uuid references public.practice_activities(id) on delete set null,
  station_id uuid references public.stations(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (occurrence_key)
);
create index benchmark_assessment_sources_assessment_idx
  on public.benchmark_assessment_sources (assessment_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- benchmark_participants: an individual being measured, or the one collective
-- team subject (handoff 2, 5.2, 5.3, 9.1)
-- ─────────────────────────────────────────────────────────────────────────────
create table public.benchmark_participants (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references public.benchmark_assessments(id) on delete cascade,
  player_id uuid references public.players(id) on delete set null,
  is_team_subject boolean not null default false,
  player_name_snapshot text,
  jersey_snapshot text,
  status text not null default 'not_measured'
    check (status in ('not_measured', 'partial', 'complete', 'unable', 'skipped')),
  conditions_note text,
  -- collective subject only
  participating_player_ids uuid[],
  player_count integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint benchmark_participants_subject_shape check (is_team_subject or player_id is not null)
);
-- Exactly one collective subject per assessment; at most one row per player.
-- Partial unique indexes, not a nullable composite unique (handoff 9.1).
create unique index benchmark_participants_one_team_subject
  on public.benchmark_participants (assessment_id) where is_team_subject;
create unique index benchmark_participants_one_row_per_player
  on public.benchmark_participants (assessment_id, player_id) where player_id is not null;
create trigger touch_benchmark_participants_updated_at before update on public.benchmark_participants
  for each row execute function public.touch_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- benchmark_attempts: one raw scored observation, with author and validity
-- Replacing an invalid attempt refills the SAME slot; the invalid observation
-- stays as a superseded revision, never an extra scored opportunity (5.1).
-- ─────────────────────────────────────────────────────────────────────────────
create table public.benchmark_attempts (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references public.benchmark_participants(id) on delete cascade,
  slot_index integer not null check (slot_index >= 0 and slot_index < 20),
  value_numeric numeric,
  successes integer,
  opportunities integer,
  rubric_level_id text,
  valid boolean not null default true,
  invalid_reason text,
  author_user_id uuid references public.profiles(id) on delete set null,
  recording_grant_id uuid,
  -- Idempotency: a retried save with the same client operation id returns the
  -- prior success, never a second attempt or a second audit event (5.4).
  client_operation_id uuid not null,
  row_version integer not null default 1,
  superseded_at timestamptz,
  superseded_by uuid references public.benchmark_attempts(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_operation_id)
);
-- At most one live (non-superseded) attempt per participant slot.
create unique index benchmark_attempts_one_live_per_slot
  on public.benchmark_attempts (participant_id, slot_index) where superseded_at is null;
create index benchmark_attempts_participant_idx on public.benchmark_attempts (participant_id, slot_index);
create trigger touch_benchmark_attempts_updated_at before update on public.benchmark_attempts
  for each row execute function public.touch_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- benchmark_audit: append-only before/after for every consequential change
-- ─────────────────────────────────────────────────────────────────────────────
create table public.benchmark_audit (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid references public.benchmark_assessments(id) on delete cascade,
  benchmark_id uuid references public.benchmarks(id) on delete cascade,
  entity_type text not null,
  entity_id uuid,
  action text not null,
  actor_user_id uuid references public.profiles(id) on delete set null,
  recording_grant_id uuid,
  before jsonb,
  after jsonb,
  created_at timestamptz not null default now()
);
create index benchmark_audit_assessment_idx on public.benchmark_audit (assessment_id, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- benchmark_recording_grants: scoped, opt-in helper recording capability (6.2)
-- The bearer token is high-entropy and never stored; only its sha256 hash is.
-- ─────────────────────────────────────────────────────────────────────────────
create table public.benchmark_recording_grants (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references public.benchmark_assessments(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  token_hash text not null unique,
  subject_scope text not null check (subject_scope in ('players', 'team')),
  -- explicit permitted participant player ids; ignored for a 'team' scope
  permitted_player_ids uuid[] not null default '{}',
  attribution_label text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '12 hours'),
  revoked_at timestamptz,
  revoked_by uuid references public.profiles(id) on delete set null
);
create index benchmark_recording_grants_assessment_idx
  on public.benchmark_recording_grants (assessment_id) where revoked_at is null;

-- team_benchmarks.baseline_assessment_id -> benchmark_assessments, added now
-- that both tables exist.
alter table public.team_benchmarks
  add constraint team_benchmarks_baseline_fk
  foreign key (baseline_assessment_id) references public.benchmark_assessments(id) on delete set null;

-- ─────────────────────────────────────────────────────────────────────────────
-- Authorization helpers
-- ─────────────────────────────────────────────────────────────────────────────

-- Definition visibility: the owner / a fellow org member, OR any team that has
-- adopted this benchmark and that the caller can access. Definition access
-- alone never implies results access (handoff 3.1, 6).
create function public.can_access_benchmark(p_benchmark_id uuid) returns boolean
language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1 from public.benchmarks b
    where b.id = p_benchmark_id
      and (
        public.can_access_owned(b.organization_id, b.owner_user_id)
        or exists (
          select 1 from public.team_benchmarks tb
          where tb.benchmark_id = b.id and tb.archived_at is null
            and public.can_access_team(tb.team_id)
        )
      )
  );
$$;

create function public.can_manage_benchmark(p_benchmark_id uuid) returns boolean
language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1 from public.benchmarks b
    where b.id = p_benchmark_id
      and public.can_manage_owned(b.organization_id, b.owner_user_id)
  );
$$;

-- Historical benchmark results follow the exact same gate as team development
-- history everywhere (Library, Goals & Insights, PlayerProfile, RPCs).
create function public.can_view_benchmark_history_for_team(p_team_id uuid) returns boolean
language sql stable security definer set search_path to 'public' as $$
  select public.can_view_goals_for_team(p_team_id);
$$;

create function public.benchmark_assessment_team(p_assessment_id uuid) returns uuid
language sql stable security definer set search_path to 'public' as $$
  select team_id from public.benchmark_assessments where id = p_assessment_id;
$$;

-- Any accepted team staff member may enter current recording results.
create function public.can_record_benchmark_assessment(p_assessment_id uuid) returns boolean
language sql stable security definer set search_path to 'public' as $$
  select public.can_coach_team(public.benchmark_assessment_team(p_assessment_id));
$$;

-- Finalize, and creating a standalone / backdated assessment: a team manager
-- or a build delegate (handoff 6.1 matrix).
create function public.can_finalize_benchmark_assessment(p_assessment_id uuid) returns boolean
language sql stable security definer set search_path to 'public' as $$
  select public.can_manage_team(t) or public.can_build_practice_for_team(t)
  from (select public.benchmark_assessment_team(p_assessment_id) as t) s;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Row-level security
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.benchmarks enable row level security;
alter table public.benchmark_versions enable row level security;
alter table public.team_benchmarks enable row level security;
alter table public.benchmark_target_revisions enable row level security;
alter table public.benchmark_assessments enable row level security;
alter table public.benchmark_assessment_sources enable row level security;
alter table public.benchmark_participants enable row level security;
alter table public.benchmark_attempts enable row level security;
alter table public.benchmark_audit enable row level security;
alter table public.benchmark_recording_grants enable row level security;

-- benchmarks
create policy benchmarks_select on public.benchmarks for select to authenticated
  using (public.can_access_benchmark(id));
create policy benchmarks_insert on public.benchmarks for insert to authenticated
  with check (public.can_manage_owned(organization_id, owner_user_id) and coalesce(created_by, auth.uid()) = auth.uid());
create policy benchmarks_update on public.benchmarks for update to authenticated
  using (public.can_manage_benchmark(id)) with check (public.can_manage_benchmark(id));

-- benchmark_versions: readable with the definition, insert-only by a manager of
-- the definition, never updated/deleted through the client (RPC + trigger own
-- the immutability rules).
create policy benchmark_versions_select on public.benchmark_versions for select to authenticated
  using (public.can_access_benchmark(benchmark_id));
create policy benchmark_versions_insert on public.benchmark_versions for insert to authenticated
  with check (public.can_manage_benchmark(benchmark_id) and coalesce(created_by, auth.uid()) = auth.uid());

-- team_benchmarks: visible to anyone on the team; a manager or a build delegate
-- can adopt / update; archival is manager-only (enforced in the RPC).
create policy team_benchmarks_select on public.team_benchmarks for select to authenticated
  using (public.can_access_team(team_id));
create policy team_benchmarks_insert on public.team_benchmarks for insert to authenticated
  with check ((public.can_manage_team(team_id) or public.can_build_practice_for_team(team_id))
    and coalesce(created_by, auth.uid()) = auth.uid());
create policy team_benchmarks_update on public.team_benchmarks for update to authenticated
  using (public.can_manage_team(team_id) or public.can_build_practice_for_team(team_id))
  with check (public.can_manage_team(team_id) or public.can_build_practice_for_team(team_id));

-- targets / baselines: history-access to read, manager-only to write.
create policy benchmark_target_revisions_select on public.benchmark_target_revisions for select to authenticated
  using (exists (
    select 1 from public.team_benchmarks tb
    where tb.id = team_benchmark_id and public.can_view_benchmark_history_for_team(tb.team_id)
  ));
create policy benchmark_target_revisions_insert on public.benchmark_target_revisions for insert to authenticated
  with check (exists (
    select 1 from public.team_benchmarks tb
    where tb.id = team_benchmark_id and public.can_manage_team(tb.team_id)
  ) and coalesce(created_by, auth.uid()) = auth.uid());

-- assessments: readable by any team coach (a non-delegate assistant reaches the
-- active assessment through live practice); every mutation goes through a
-- SECURITY DEFINER RPC, so there is no UPDATE/DELETE policy.
create policy benchmark_assessments_select on public.benchmark_assessments for select to authenticated
  using (public.can_coach_team(team_id));
create policy benchmark_assessments_insert on public.benchmark_assessments for insert to authenticated
  with check (public.can_coach_team(team_id) and coalesce(created_by, auth.uid()) = auth.uid());

create policy benchmark_assessment_sources_select on public.benchmark_assessment_sources for select to authenticated
  using (public.can_coach_team(public.benchmark_assessment_team(assessment_id)));

create policy benchmark_participants_select on public.benchmark_participants for select to authenticated
  using (public.can_coach_team(public.benchmark_assessment_team(assessment_id)));

create policy benchmark_attempts_select on public.benchmark_attempts for select to authenticated
  using (exists (
    select 1 from public.benchmark_participants bp
    where bp.id = participant_id
      and public.can_coach_team(public.benchmark_assessment_team(bp.assessment_id))
  ));

-- Raw audit records are manager-only and must never reach a helper (handoff 6.2).
create policy benchmark_audit_select on public.benchmark_audit for select to authenticated
  using (
    (assessment_id is not null and public.can_manage_team(public.benchmark_assessment_team(assessment_id)))
    or (benchmark_id is not null and public.can_manage_benchmark(benchmark_id))
  );

-- Grants are visible to whoever can create them; validated inside the token RPCs
-- for the anonymous tier, which has no table grant at all.
create policy benchmark_recording_grants_select on public.benchmark_recording_grants for select to authenticated
  using (public.can_manage_team(team_id) or public.can_build_practice_for_team(team_id));

-- ─────────────────────────────────────────────────────────────────────────────
-- Table grants. authenticated reads through RLS; every write is via an RPC that
-- runs as the definer, so only SELECT (and INSERT where a plain client insert
-- is genuinely used) is granted here. anon gets nothing.
-- ─────────────────────────────────────────────────────────────────────────────
grant select, insert, update on public.benchmarks to authenticated;
grant select, insert on public.benchmark_versions to authenticated;
grant select, insert, update on public.team_benchmarks to authenticated;
grant select, insert on public.benchmark_target_revisions to authenticated;
grant select, insert on public.benchmark_assessments to authenticated;
grant select on public.benchmark_assessment_sources to authenticated;
grant select on public.benchmark_participants to authenticated;
grant select on public.benchmark_attempts to authenticated;
grant select on public.benchmark_audit to authenticated;
grant select on public.benchmark_recording_grants to authenticated;

comment on table public.benchmarks is 'Benchmark identity and Library item. Owner XOR org. subject_mode is fixed for the identity. Spec: ROP-Benchmarks handoff 9.1.';
comment on table public.benchmark_versions is 'Immutable protocol/scoring definition. Structural fields frozen after first_used_at (trigger benchmark_versions_lock_structural). A structural change is a new version.';
comment on table public.benchmark_assessments is 'One occasion of measuring one version for one team. state recording|finalized|archived; under_correction while a finalized assessment is reopened.';
comment on table public.benchmark_recording_grants is 'Scoped anonymous recording capability. token_hash = sha256(bearer). 12h default expiry. Finalize/archive revoke in the same transaction.';
