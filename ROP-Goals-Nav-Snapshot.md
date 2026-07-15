# ROP — Goals Feature & Team-First Nav: Codebase/Schema Snapshot

**Read-only snapshot. No code, schema, or config was modified to produce this document.**
Generated 2026-07-15 against the `rop/` working tree (not a git repo root itself — `git` is
initialized inside `rop/`) and the linked Supabase project `bepoojcbizxhqadrytjq`
("run of practice web app"). 100 migration files, `supabase/migrations/20260704000100_extensions.sql`
through `20260714000000_notes_table.sql`.

---

## 1. SCHEMA

### 1.1 `teams` + membership/staff

`supabase/migrations/20260704000500_teams.sql` (base) + `20260709000000_scheduling_addendum.sql` (color columns):

```sql
create table public.teams (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  owner_user_id uuid references public.profiles(id) on delete cascade,
  name text not null,
  sport text not null,
  season_label text,
  start_date date,
  end_date date,
  timezone text,
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint team_has_owner check (organization_id is not null or owner_user_id is not null)
);
-- added later, 20260709000000_scheduling_addendum.sql:
alter table public.teams
  add column color_primary text,
  add column color_secondary text;
```

No index beyond the PK; `organization_id`/`owner_user_id` are FK-only, not indexed.

`team_staff` (`20260704000600_team_staff.sql`, + `added_by` from `20260710010000`, + `welcomed_at` from `20260710040000`):

```sql
create table public.team_staff (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade,
  invite_email text,
  first_name text not null,
  last_name text not null,
  role text not null check (role in ('head_coach', 'assistant_coach', 'helper')),
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint staff_identifiable check (user_id is not null or invite_email is not null)
);
-- later additions:
alter table public.team_staff add column added_by uuid references public.profiles(id) on delete set null;
alter table public.team_staff add column welcomed_at timestamptz;
```

`organizations` / `organization_members` (`20260704000300`/`000400`, optional org layer; most teams have `organization_id is null`):

```sql
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  archived_at timestamptz
);
create table public.organization_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'coach', 'viewer')),
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (organization_id, user_id)
);
```

RLS (`20260704000900_rls_policies.sql`): `teams_select_access` uses `can_access_team(id)`; `teams_update_manage` uses `can_manage_team(id)`. No DELETE policy on `teams` or `team_staff` anywhere — archive-only (`archived_at`). `can_access_team`/`can_manage_team` (`20260704000800_rls_functions.sql`):

```sql
create function public.can_access_team(p_team_id uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.teams t
    where t.id = p_team_id
      and (t.owner_user_id = auth.uid()
        or (t.organization_id is not null and public.is_org_member(t.organization_id))
        or exists (select 1 from public.team_staff ts where ts.team_id = t.id and ts.user_id = auth.uid() and ts.archived_at is null))
  );
$$;
-- can_manage_team: same shape, narrowed to owner_user_id / org admin / team_staff.role = 'head_coach'
```

This is the key fact for the nav restructure: **access scoping is per-team, keyed off `teams.id`, never off a screen/route.** Any team-scoped screen (a per-team workspace) can reuse `can_access_team`/`can_manage_team` unchanged.

### 1.2 `skill_tags` + every junction to drills/activities/templates

`skill_categories` (`20260704001100`) — curated, no owner, no INSERT policy (service-role only):

```sql
create table public.skill_categories (
  id uuid primary key default gen_random_uuid(),
  sport text not null,
  name text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
```

`skill_tags` (`20260704001200`) — hybrid scope, **no `team_id` column at all**:

```sql
create table public.skill_tags (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.skill_categories(id) on delete cascade,
  scope text not null check (scope in ('global', 'org', 'coach')),
  organization_id uuid references public.organizations(id) on delete cascade,
  owner_user_id uuid references public.profiles(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint skill_tag_scope_matches_owner check (
    (scope = 'global' and organization_id is null and owner_user_id is null)
    or (scope = 'org' and organization_id is not null and owner_user_id is null)
    or (scope = 'coach' and organization_id is null and owner_user_id is not null)
  )
);
```

Junction tables that link a tag to something else — **`drill_tags` is the only one that exists**:

```sql
-- 20260704001500_drill_tags.sql — links a library drill to a skill_tag. This is
-- the ONLY tag junction table in the schema.
create table public.drill_tags (
  id uuid primary key default gen_random_uuid(),
  activity_library_id uuid not null references public.activity_library(id) on delete cascade,
  skill_tag_id uuid not null references public.skill_tags(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (activity_library_id, skill_tag_id)
);
```

`player_focus_areas` (`20260707250000`) reuses the same `skill_tags` table for a *different* purpose (a player's individual focus areas, not drill tagging) — same taxonomy, unrelated to Goals.

**There is no tag junction table for `templates`, `template_activities`, `practice_activities`, or `stations`.** A drill's tags live only on `activity_library` via `drill_tags`. Once a drill is copied into `template_activities` or `practice_activities`, only `library_activity_id` (a nullable lineage pointer) survives — the tag relationship is not copied or denormalized anywhere else. This is the central gap discussed in §2.

RLS (`20260704001700_rls_policies_chunk2.sql`): `drill_tags` gets real SELECT/INSERT/DELETE policies (join-shaped, not archive-only), gated by `can_access_activity`/`can_manage_activity` plus a compatibility check `can_link_tag_to_activity` (an org-owned drill can only link org/global tags; a personal drill can link the coach's own tags or an org they belong to).

### 1.3 Drills/activities table(s) — where planned duration lives

`activity_library` (`20260704001300`, + `updated_at` from `20260704003300`, + `shared_with_organization_id` from `20260707050000`, + `position` from `20260707250000`):

```sql
create table public.activity_library (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  owner_user_id uuid references public.profiles(id) on delete cascade,
  sport text not null,
  name text not null,
  duration_minutes int,          -- nullable: the drill's *default* duration, not binding
  description text,
  coaching_points text,
  grouping text check (grouping in ('whole', 'partners', 'groups')),
  num_groups int,
  source_catalog_id uuid,        -- unused lineage hook, chunk 6
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint activity_has_owner check (organization_id is not null or owner_user_id is not null)
);
-- alter table public.activity_library add column updated_at timestamptz not null default now();
-- alter table public.activity_library add column shared_with_organization_id uuid references public.organizations(id);
-- alter table public.activity_library add column position int not null default 0;
```

`activity_library_equipment` (join to `assets`, unrelated to tags):

```sql
create table public.activity_library_equipment (
  id uuid primary key default gen_random_uuid(),
  activity_library_id uuid not null references public.activity_library(id) on delete cascade,
  asset_id uuid not null references public.assets(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (activity_library_id, asset_id)
);
```

**The duration that actually matters for planned/actual math does not live on `activity_library`.** It lives on the copy: `template_activities.duration_minutes` / `practice_activities.duration_minutes` (both nullable ints, §1.4/§1.5) — the library row's `duration_minutes` is only a seed value copied in at build time (`BuilderScreen.addAct` in `src/App.jsx:874` sets `duration: lib.duration`), never referenced again afterward.

### 1.4 `practices`, practice sections/agenda items, practice-to-template relationship

```sql
-- 20260704002400_practices.sql (base) + later ALTERs
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
create index practices_team_id_idx on public.practices (team_id);

-- 20260707100000_practice_location_and_staff_assignment.sql
alter table public.practices add column location_id uuid references public.locations(id);

-- 20260709000000_scheduling_addendum.sql
alter table public.practices
  add column sublocation_id uuid references public.sublocations(id),
  add column scheduled_duration_minutes int;
alter table public.practices drop constraint practices_status_check;
alter table public.practices add constraint practices_status_check
  check (status in ('draft', 'scheduled', 'completed', 'cancelled'));  -- 'cancelled' added here
alter table public.practices add column series_id uuid references public.practice_series(id);
```

`practices.template_id` is the practice-to-template relationship: **lineage only** ("what this was built from"), not a live binding — editing a template later never touches practices already built from it.

`practice_activities` — this is the "section/agenda item" table (`20260704002500`, + `team_staff_id`/`sublocation_id` from `20260707100000`, + `'checklist'` type from `20260707130000`):

```sql
create table public.practice_activities (
  id uuid primary key default gen_random_uuid(),
  practice_id uuid not null references public.practices(id) on delete cascade,
  position int not null,
  type text not null check (type in ('activity', 'station_block', 'checklist')),
  name text,
  duration_minutes int,
  description text,
  coaching_points text,
  grouping text check (grouping in ('whole', 'partners', 'groups')),
  num_groups int,
  library_activity_id uuid references public.activity_library(id),   -- lineage, NULLABLE
  template_activity_id uuid references public.template_activities(id),
  created_at timestamptz not null default now(),
  archived_at timestamptz
);
-- later: team_staff_id uuid references public.team_staff(id), sublocation_id uuid references public.sublocations(id)
create index practice_activities_practice_id_idx on public.practice_activities (practice_id);
```

`practice_activities` is a **full field copy** at the moment a drill/template-activity is added — not a live reference (comment in the migration is explicit about this). `library_activity_id` is the only path back to `drill_tags`/`skill_tags`, and it is nullable — an activity typed freeform in Builder (no library drill picked) has no `library_activity_id` and therefore no reachable skill tag.

Station blocks (`type = 'station_block'`) fan out into `station_blocks` → `stations`, each `stations` row *also* carries its own nullable `library_activity_id` (`20260704002600_stations.sql`):

```sql
create table public.station_blocks (
  id uuid primary key default gen_random_uuid(),
  practice_activity_id uuid not null unique references public.practice_activities(id) on delete cascade,
  rotate boolean not null default true,
  station_duration_seconds int,
  transition_duration_seconds int,
  created_at timestamptz not null default now()
);
create table public.stations (
  id uuid primary key default gen_random_uuid(),
  station_block_id uuid not null references public.station_blocks(id) on delete cascade,
  position int not null,
  name text, description text, coaching_points text,
  team_staff_id uuid references public.team_staff(id),
  sublocation_id uuid references public.sublocations(id),
  library_activity_id uuid references public.activity_library(id),
  created_at timestamptz not null default now(),
  archived_at timestamptz
);
```

`'checklist'`-type activities (Intro/Closer) have no duration semantics beyond `duration_minutes` and no drill/tag linkage at all (`practice_activity_checklist_items`, `20260707130000_checklist_activity_type.sql`) — they're plan structure, not drills.

RLS: `practices_select_access`/`update_manage` on `can_access_team`/`can_manage_team`; `practice_activities`, `station_blocks`, `stations` all chain through `can_access_practice_activity`/`can_access_station_block` (defined in `20260704002700_rls_functions_chunk3.sql`, not pasted here — same team-scoped-chain pattern, ultimately resolving back to `can_access_team`).

### 1.5 Templates table(s) — sport/team columns

```sql
-- 20260704002100_templates.sql (base)
create table public.templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  owner_user_id uuid references public.profiles(id) on delete cascade,
  sport text not null,
  name text not null,
  description text,
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint template_has_owner check (organization_id is not null or owner_user_id is not null)
);
-- 20260707050000_library_sharing_schema.sql
alter table public.templates add column shared_with_organization_id uuid references public.organizations(id);
-- 20260707100000_practice_location_and_staff_assignment.sql
alter table public.templates add column location_id uuid references public.locations(id);
-- 20260712000000_template_updated_at.sql
alter table public.templates add column updated_at timestamptz not null default now();
-- 20260713000000_template_default_team.sql
alter table public.templates add column default_team_id uuid references public.teams(id) on delete set null;
```

So `templates` has **`sport` (not null, from day 1)** and, as of 2026-07-13, **`default_team_id`** (nullable, `on delete set null`, used only to prefill Builder's team picker when starting a practice from a template — `BuilderScreen`, `src/App.jsx:836`). It is not a hard ownership/scoping column; a template is still owned by `organization_id`/`owner_user_id`, usable across any of that owner's teams of the matching sport.

`template_activities` (`20260704002200`, + `library_activity_synced_at` from `20260704003300`, + `sublocation_id` from `20260707100000`, + `'checklist'` type from `20260707130000`):

```sql
create table public.template_activities (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.templates(id) on delete cascade,
  position int not null,
  type text not null check (type in ('activity', 'station_block', 'checklist')),
  name text,
  duration_minutes int,
  description text,
  coaching_points text,
  grouping text check (grouping in ('whole', 'partners', 'groups')),
  num_groups int,
  library_activity_id uuid references public.activity_library(id),
  created_at timestamptz not null default now(),
  archived_at timestamptz
);
```

Same shape as `practice_activities`: `library_activity_id` nullable, no direct tag linkage — a template activity's tags are only reachable if it has a `library_activity_id`, through `drill_tags`.

### 1.6 `session_activity_log` — full definition

```sql
-- 20260704004400_session_activity_log.sql (base)
create table public.session_activity_log (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.practice_live_sessions(id) on delete cascade,
  practice_activity_id uuid references public.practice_activities(id),
  station_id uuid references public.stations(id),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  present_player_ids uuid[] not null default '{}',
  constraint session_activity_log_exactly_one_target check (
    (practice_activity_id is not null and station_id is null)
    or (practice_activity_id is null and station_id is not null)
  )
);
create index session_activity_log_session_id_idx on public.session_activity_log (session_id);

-- 20260704005000_session_groups_activity_log_actor_columns.sql
alter table public.session_activity_log add column logged_by uuid not null references public.profiles(id);

-- 20260707190000_live_session_actor_set_null.sql
alter table public.session_activity_log alter column logged_by drop not null;
alter table public.session_activity_log drop constraint session_activity_log_logged_by_fkey;
alter table public.session_activity_log
  add constraint session_activity_log_logged_by_fkey
  foreign key (logged_by) references public.profiles(id) on delete set null;
```

Exact answer to "what timing data is captured": **`started_at` (not null, defaults to `now()`) and `ended_at` (nullable, set only when the coach ends that activity/station).** There is **no computed/stored duration column** — duration is always `ended_at - started_at`, and is `null`/undefined for any row that was never explicitly ended (abandoned session, or the last activity when a coach just taps "End Practice" without advancing through it — confirmed no code path force-closes a dangling `ended_at`; see §2).

`present_player_ids uuid[]` is a point-in-time attendance snapshot captured directly on the row (not derived later by joining `session_attendance`), per the migration's own comment ("can't backfill, capture from day 1").

**No skill-tag denormalization of any kind on this table** — `session_id`/`practice_activity_id`/`station_id` are the only foreign keys. To get from a log row to a skill tag requires: `session_activity_log.practice_activity_id → practice_activities.library_activity_id → drill_tags.skill_tag_id` (or the `station_id → stations.library_activity_id → drill_tags` path for station-block rows).

RLS (`20260704004700_rls_policies_chunk4a.sql`): SELECT via `can_access_session(session_id)` (broad — any team member including helpers); INSERT/UPDATE via `can_coach_session(session_id) and is_session_active(session_id)` — so a completed session's log rows become immutable (no active session ⇒ no UPDATE passes), which is what actually freezes historical timing once a session ends.

Frontend usage (`src/supabase.js:1085-1108`): only ever inserted (activity start) and updated (`ended_at`) by the live-run screen (`CommandScreen.jsx`). **No code anywhere in the frontend reads `session_activity_log` back for history, reporting, or the History view** — confirmed by grep; `HistoryViewer` (§4) renders only the planned `practice_activities.duration_minutes`, never actual elapsed time.

### 1.7 Scheduling tables — series, materialized occurrences, status enum

`practice_series` (`20260709000000_scheduling_addendum.sql`) — **metadata only**, remembering the recurrence pattern for bulk edits/display:

```sql
create table public.practice_series (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  days_of_week int[] not null,
  start_time time not null,
  duration_minutes int not null,
  location_id uuid references public.locations(id),
  sublocation_id uuid references public.sublocations(id),
  range_start date not null,
  range_end date not null,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  archived_at timestamptz
);
create index practice_series_team_id_idx on public.practice_series (team_id);
```

RLS: `practice_series_select_access` → `can_access_team`; insert/update → `can_manage_team` (+ `created_by = auth.uid()` on insert). Grants: `select, insert, update` to `authenticated` (no delete — archive only).

Occurrences are **materialized up front, never dynamically expanded** — `create_practice_series()` (security-invoker RPC, same file) computes every matching date via `generate_series`, hard-caps at 400-day range / 150 occurrences, and bulk-inserts one `practices` row per date with `series_id` set and `status = 'scheduled'`. `practices` is therefore the single source of truth for "does this occurrence exist" — there is no separate expansion/materialization job.

**The status enum that distinguishes planned vs. unplanned vs. completed is `practices.status`**, but it does not by itself distinguish "planned" (has activities) from "unplanned" (empty plan) — that's a derived, not stored, distinction:

```sql
status text not null default 'draft' check (status in ('draft', 'scheduled', 'completed', 'cancelled'))
```

- `'draft'` / `'scheduled'` — both mean "hasn't run yet"; whether it has a plan is computed client-side as `(practice.activities || []).length > 0` (`isPlanned()`, repeated ad hoc in `HomeScreen.jsx`, `ScheduleScreen.jsx`, `ManageScreen`), not a column.
- `'completed'` is **never actually set on `practices.status`** by any code path found — completion is tracked entirely on `practice_live_sessions.status = 'completed'` (a separate row, since one practice can have multiple live-session attempts: test runs, abandoned runs, "Run Again"). The frontend derives "did this practice run" via `fetchPracticeRunStatus()` (`src/supabase.js:232`), which queries `practice_live_sessions` keyed by `practice_id`, not `practices.status`. `practices.status = 'completed'` appears in the CHECK constraint and is presumably intended, but nothing in the current code path writes it.
- `'cancelled'` is set explicitly by the cancel action.

`planned_absences` (same migration) — coach's advance-notice table, not attendance history:

```sql
create table public.planned_absences (
  id uuid primary key default gen_random_uuid(),
  practice_id uuid not null references public.practices(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  noted_by uuid not null references public.profiles(id),
  note text,
  created_at timestamptz not null default now(),
  unique (practice_id, player_id)
);
```

### 1.8 Settings/preferences tables

**None exist.** `grep -in "settings\|preferences\|config"` across all 100 migrations returns no table definitions — only unrelated comment text (e.g. "rotation/timing config" describing a column, "misconfigured" in a code comment). There is no team-level or coach-level key/value config table anywhere in the schema today. A per-team value like "goals window weeks" (default 4) has nowhere to live without either (a) a new dedicated column on `teams` (closest existing precedent: `teams.timezone`, `teams.color_primary` — bare columns added directly to `teams`, no settings-table pattern has ever been used in this schema) or (b) a new table.

---

## 2. DATA REALITY CHECK

**Database reachability**: no local Supabase/Docker (`docker` isn't installed; `npx supabase db dump --linked` fails with `LegacyDockerRunError`), and no `psql`/DB password available in this environment — only the project's anon publishable key (`src/supabase.js`). I ran the two join queries below directly against the linked production project via its PostgREST endpoint (`https://bepoojcbizxhqadrytjq.supabase.co/rest/v1/...`) with the anon key. Both came back with a real, informative error rather than data:

```
$ curl ".../rest/v1/session_activity_log?select=id,started_at,ended_at,practice_activities(duration_minutes,library_activity_id)&limit=3" -H "apikey: <anon>" -H "Authorization: Bearer <anon>"
{"code":"42501","details":null,"hint":"Grant the required privileges to the current role with: GRANT SELECT ON public.session_activity_log TO anon;","message":"permission denied for table session_activity_log"}

$ curl ".../rest/v1/practice_activities?select=duration_minutes,library_activity_id,activity_library(drill_tags(skill_tag_id))&limit=3" -H "apikey: <anon>" -H "Authorization: Bearer <anon>"
{"code":"42501","details":null,"hint":"Grant the required privileges to the current role with: GRANT SELECT ON public.practice_activities TO anon;","message":"permission denied for table practice_activities"}
```

This is expected and correct, not a bug: `20260704003400_grants_authenticated.sql` explicitly grants these tables only to `authenticated`, never `anon` ("nothing here is meant to be publicly accessible yet"), and there's no service-role key or real user session available in this environment to authenticate as. I could not obtain a live sample row. The queries below are what I'd run with an authenticated session (e.g. via `supabase db query --linked` per `BUILD-STATUS.md`'s documented workflow, or the Supabase JS client signed in as a real coach).

### 2.1 Minutes per skill tag for a completed practice — gap, not a clean join

**There is a real gap, not just a longer join.** The chain is:

```sql
select
  st.name as skill_tag_name,
  sum(extract(epoch from (sal.ended_at - sal.started_at)) / 60.0) as actual_minutes
from session_activity_log sal
join practice_live_sessions pls on pls.id = sal.session_id
left join practice_activities pa on pa.id = sal.practice_activity_id
left join stations sta on sta.id = sal.station_id
left join drill_tags dt on dt.activity_library_id = coalesce(pa.library_activity_id, sta.library_activity_id)
left join skill_tags st on st.id = dt.skill_tag_id
where pls.practice_id = $1
  and sal.ended_at is not null              -- gap #1: rows never ended are silently excluded or need coalesce(ended_at, now())
group by st.name;
```

Three concrete gaps this query has to route around, none solvable by SQL alone:

1. **`ended_at` can be null.** A log row for an activity that was never explicitly advanced past (e.g. the coach hit "End Practice" mid-activity, or the session was abandoned) has `started_at` but no `ended_at`. There's no trigger or app code that back-fills `ended_at` on session completion — confirmed by reading every `session_activity_log` write site in `src/supabase.js`/`CommandScreen.jsx` (only explicit "advance to next activity" writes `ended_at`). A naive `sum(ended_at - started_at)` either throws (interval math against null) or silently drops that activity's minutes if you filter it out, understating actual time.
2. **`library_activity_id` can be null on both `practice_activities` and `stations`.** Any activity typed freeform in Builder without picking a library drill (very common for one-off items, per `BuilderScreen`'s `addAct`/checklist/blank-activity paths) has no way to reach `drill_tags` at all — it contributes zero rows to the tag breakdown, correctly for tag-attribution purposes but silently for a coach trying to reconcile "why don't my minutes add up." Same gap for `'checklist'`-type activities (Intro/Closer), which have no `library_activity_id` column usage at all.
3. **Multi-tag drills produce one row per tag** (`drill_tags` is many-to-many, no weighting — see §2.3), so a naive `sum()` without first deduplicating per-activity-per-tag will double count minutes across tags if a single log row's activity carries 2+ tags on the *same* category. This is a "spread evenly / count in full for each / assign a primary" product decision, not something the schema resolves for you.

I could not execute this against real data (see reachability above), but I did confirm via `session_activity_log`'s actual row shape (§1.6) and the frontend's insert/update call sites that gap #1 is real: nothing writes `ended_at` except the "advance" action, and nothing runs on session completion to close out a dangling open row.

### 2.2 Planned minutes per skill tag for an upcoming practice — same join, cleaner data, same tag gap

```sql
select
  st.name as skill_tag_name,
  sum(pa.duration_minutes) as planned_minutes
from practice_activities pa
left join drill_tags dt on dt.activity_library_id = pa.library_activity_id
left join skill_tags st on st.id = dt.skill_tag_id
where pa.practice_id = $1
  and pa.archived_at is null
group by st.name;

-- station-block activities need a second leg (each station can carry its own drill/tags):
select
  st.name as skill_tag_name,
  sum(coalesce(sb.station_duration_seconds,0)/60.0) as planned_minutes
from practice_activities pa
join station_blocks sb on sb.practice_activity_id = pa.id
join stations stn on stn.station_block_id = sb.id
left join drill_tags dt on dt.activity_library_id = stn.library_activity_id
left join skill_tags st on st.id = dt.skill_tag_id
where pa.practice_id = $1
group by st.name;
```

This one is cleaner than the actuals side — `practice_activities.duration_minutes` is always populated at save time by `saveActivityTree()` (`src/supabase.js:636`, `duration_minutes: act.duration || null`) whenever the Builder UI has a value, so there's no analogous "null interval" problem. The same two gaps as §2.1 still apply: freeform/no-library-drill activities and checklist-type activities contribute planned minutes to the practice total but are untaggable; and multi-tag drills still need an explicit double-count-or-split decision. Station-block rotation math also needs its own duration computation (`stationDuration × count + transitions`, mirrored client-side in `sumMinsLocal`, `src/supabase.js:609`) — there's no single `duration_minutes` for a whole station block, only per-station-block config (`station_duration_seconds`, `transition_duration_seconds`) and per-station rows.

### 2.3 Multi-tag activities — no primary tag, all equal

Confirmed from the schema (§1.2): `drill_tags` is a plain many-to-many join (`activity_library_id`, `skill_tag_id`, unique pair) with no `is_primary`, `weight`, or ordering column. Every tag on a drill is equal. The `ModalLayer.jsx` drill editor's `SkillTagPicker` is a multi-select toggle grid, confirming the product UI treats them as an unordered set too — there's no existing concept anywhere (schema or UI) of a primary/dominant tag to build a "assign 100% to one tag" Goals behavior on top of. A weighted/split allocation across a drill's tags would be new.

### 2.4 Non-drill time (water breaks, team talks) — not modeled, not identifiable except by absence of a link

There is **no dedicated activity type or flag** for non-drill time. `practice_activities.type` (and `template_activities.type`) only allows `'activity' | 'station_block' | 'checklist'` (§1.4/§1.5). A water break or team talk would be built as a plain `type = 'activity'` row with a freeform `name` ("Water Break") and a `duration_minutes`, exactly like a real drill — the only distinguishing signal is that it has **no `library_activity_id`** (never picked from the drill library), which is the same signature as any other ad-hoc/freeform activity (§2.1 gap #2). There is no way to query "give me only non-drill time" except by `library_activity_id is null`, which also catches every other freeform activity a coach types without linking a library drill — you cannot distinguish "this is deliberately a break" from "this coach just didn't bother picking the library entry for a real drill." Same gap in the live log: `session_activity_log` rows for a break look identical in shape to rows for a tagged drill, distinguishable only by chasing back through the same nullable `library_activity_id`.

---

## 3. NAVIGATION

**No router.** `src/App.jsx` (default export `App()`) holds one piece of state, `view` (`useState("today")`), and renders one of five screens by string equality — confirmed by reading the whole file, no `react-router` or equivalent dependency in `package.json`.

```jsx
// src/App.jsx:719-724
const TABS=[
  {id:"today",label:"Home",I:Ic.Home},
  {id:"schedule",label:"Schedule",I:Ic.Cal},
  {id:"library",label:"Library",I:Ic.Lib},
  {id:"manage",label:"Manage",I:Ic.Admin},
];
```

```jsx
// src/App.jsx:756-763 — the entire render tree
{view==="today"&&<HomeScreen .../>}
{view==="schedule"&&<ScheduleScreen .../>}
{view==="manage"&&<ManageScreen .../>}
{view==="library"&&<NewLibraryScreen .../>}
{view==="builder"&&<BuilderScreen .../>}
{view==="command"&&<CommandScreen .../>}   // live-run screen, tab bar hidden
```

`builder` and `command` are reachable states but not tab-bar entries — `activeTabId = view==="builder"?priorView:view` keeps the tab bar showing whichever real tab you came from (`src/App.jsx:727`; this is the "priorView" mechanism added in the 2026-07-12 nav audit per `BUILD-STATUS.md`). Two hard-coded path checks sit above all of this and bypass the tab app entirely: `/live/:token` → `HelperView`, `/preview/:token` → `PreviewView`, `/terms`/`/privacy` → static legal pages, all matched via `window.location.pathname` regex, not a router (`src/App.jsx:732-738`).

**Team scoping today, by tab:**

| Tab | Team-scoped? | How |
|---|---|---|
| Home (`today`) | **No** — cross-team | `HomeScreen` aggregates every team's practices into one "Next 14 Days" agenda (§3 below); no team selector |
| Schedule | **No** — cross-team, with an optional filter | `ScheduleScreen` shows all teams' practices (agenda + month), with team-color filter chips (`teamFilter` local `Set` state) that narrow the same list, not a different query |
| Library | **No** — global | Coach's entire drill/template/skill-tag library regardless of team; sub-tabs `drills`/`templates`/`skills` (`NewLibraryScreen.jsx:263,327`) |
| Manage | **Partially** — the only real per-team drill-down that exists today | Top-level `Manage` is a flat list (My Teams / My Locations / Team Equipment / Player Gear / Account Settings, all global); tapping **My Teams → a specific team** enters the one place in the app that's genuinely a per-team workspace, with its own three-tab bar: `practices` / `roster` / `history` (`ManageScreen`, `src/App.jsx:357`, `TTABS=["practices","roster","history"]`) |
| Builder / Command | N/A | Entered from any tab for a specific practice; not a nav destination itself |

The existing `ManageScreen`'s per-team `practices`/`roster`/`history` tab bar (`src/App.jsx:351-404`) is the closest existing precedent for the planned team-workspace tabs (Schedule/Plan/Goals+Insights/Team) — it's already a nested tab bar keyed to one `selectedTeam`, just reached through Manage rather than being the primary navigation shape.

### Schedule tab's data-fetching logic — no server-side "next 14 days" query exists today

**Important finding: neither tab queries a 14-day window server-side.** `fetchPracticesFull()` (`src/supabase.js:570`) fetches **every non-archived practice for the coach, unbounded** — no date filter in the Supabase query at all:

```js
export async function fetchPracticesFull() {
  const [practicesRes, actsRes, equipRes, itemsRes, blocksRes, stationsRes, stationEquipRes, teamsRes] = await Promise.all([
    supabase.from('practices').select('*').is('archived_at', null),
    supabase.from('practice_activities').select('*').is('archived_at', null),
    // ...
  ])
  // ...
}
```

This result is fetched once into `App.jsx`'s `planning` state (`refreshPlanning`, `src/App.jsx:708-713`) and handed to every screen as `data.practices`. **The "next 14 days" behavior is entirely client-side, and it's on the Home tab, not the Schedule tab**:

```js
// src/components/HomeScreen.jsx:95,118-119
const in14Str = localDateStr(new Date(Date.now() + 14 * 864e5));
const active = data.practices.filter(p => !isCancelled(p));
const agendaWindow = active.filter(p => p.date >= todayStr && p.date <= in14Str).sort(...);
```

The Schedule tab (`ScheduleScreen.jsx`) has no day-window cap at all — its "agenda" mode buckets the full unbounded `data.practices` into `upcoming` (`date >= todayStr`) vs. `past`, and its "month" mode renders a full calendar grid, also against the unbounded set (`src/components/ScheduleScreen.jsx:127-129`).

**How completed practices are (or aren't) filtered**, in both places:

- Neither Home's `agendaWindow` nor Schedule's `upcoming` list excludes a completed practice by date alone — a practice that ran earlier *today* would otherwise still look "upcoming" until midnight. Both screens instead call `fetchPracticeRunStatus(ids)` (`src/supabase.js:232`, queries `practice_live_sessions` by `practice_id`, **not** `practices.status` — see §1.7 on why) and define `ran(p) = runStatus[p.id] === 'completed'`.
- **Home**: does *not* remove completed practices from the visible "Next 14 Days" list — it just tags them `· Completed` inline (`src/components/HomeScreen.jsx:257,263`). It does use `!ran(p)` to pick `nextPractice` (the hero card) and to filter `needsPlanning`.
- **Schedule**: actively moves a completed practice out of `upcoming` and into `past` the moment it's run, regardless of calendar date (`upcoming = filtered.filter(p => p.date >= todayStr && !ran(p))`, `src/components/ScheduleScreen.jsx:127-128`) — `past` is collapsed behind a "Show Completed / History" toggle, default hidden.

---

## 4. HISTORY

A completed/past-practice view exists, but it is **not a route** — it's a component rendered inline by local state on two different tabs, with no distinct URL:

- **Component**: `HistoryViewer`, defined in `src/components/CommandScreen.jsx:110`, exported and reused (not a duplicate) from both `ScheduleScreen.jsx` and `App.jsx`'s `ManageScreen`.
- **Reached from**: Schedule tab (`historyPractice` state, `ScheduleScreen.jsx:68,119`) and Manage → a team → History sub-tab (`selectedPractice`, `App.jsx:345-348`) — both gate on the same rule: `isHistorical = practice.date < todayStr || ran(practice)`, and only route to `HistoryViewer` if the practice was actually planned (`activities.length > 0`); an unplanned past practice falls through to `PracticeDetail` instead (missed-plan messaging + Restore).
- **Query behind it**: none of its own — `HistoryViewer` takes the already-fetched `practice` object as a prop (from the same unbounded `fetchPracticesFull()` result, §3) and, separately, fetches notes on mount: `fetchNotesForPractice(practice.id)` (`CommandScreen.jsx:126`, backed by the new `notes` table, `20260714000000_notes_table.sql`).

**What it actually shows is the planned practice, not the actual run.** `HistoryViewer` renders `practice.activities` — the `practice_activities` rows, i.e. what was planned/copied at build time — with each activity's static `duration` field. It never queries `session_activity_log`, never shows real `started_at`/`ended_at` timing, and never shows `present_player_ids` per activity. The only "actual" signal surfaced anywhere is the run/not-run badge (`Completed` / `Started, not finished` / `Missed`) computed from `practice_live_sessions.status`, plus attendance notes. This confirms the §1.6/§2.1 gap concretely: today's only history view has no code path that reads the one table (`session_activity_log`) that would contain real actual-vs-planned timing.

---

## 5. HANDOFF ALIGNMENT

**Neither of the two named documents exists in this repository.** I searched the working tree, full git history (`git log --all --diff-filter=A --name-only`), and the sibling `run-of-practice.zip` (an old pre-rewire POC snapshot, unrelated). Result:

- **"Scheduling handoff doc"**: no `ROP-Scheduling-Addendum.md` (or similar) file ever existed in this repo. It's referenced only by filename in a code comment — `supabase/migrations/20260709000000_scheduling_addendum.sql:1`: `"-- ROP-Scheduling-Addendum.md: recurring schedules, team colors, planned absences."` — implying it was an external planning doc handed to whoever wrote that migration, never committed.
- **"Frontend Rewire Handoff"**: same situation — never a file in this repo. It's referenced once, by name, in `ROP-Sharing-Addendum.md:3` ("*extends the main Frontend Rewire Handoff*"), which **does** exist and I read in full.

What follows is reconstructed from what **does** exist — `BUILD-STATUS.md` (the maintained running log, read in full), the `scheduling_addendum` migration itself, `ROP-Sharing-Addendum.md`, and `supabase/migrations/README.md` — not a summary of the named source documents, which I don't have access to.

**Frontend Rewire (reconstructed from `BUILD-STATUS.md` + migration history), implemented status:**

- 7-stage rewire off an old JSON-blob POC (`app_data`/`live_sessions`/`coaches` tables) onto the current ~35-table relational Supabase schema: auth, teams/roster, library (with org-sharing), templates/builder, live sessions, helper/preview anonymous pages, offline resilience/PWA. **Implemented and cut over** — production cutover was 2026-07-07 (`main` now serves `runofpractice.com`; old POC retired from the frontend, but its tables were never dropped — see §6).
- Library org-sharing model (Private / Shared-with-one-org / Public-deferred) — **implemented** per `ROP-Sharing-Addendum.md`, including the `shared_with_organization_id` columns and copy-not-reference semantics on both `activity_library` and `templates`.
- Anonymous helper/preview links (`/live/:token`, `/preview/:token`) — **implemented**, deliberately minimized player data (first name + last initial + jersey only).
- Public-catalog/public-drill-sharing — **explicitly deferred** ("chunk 6"), not built, not scheduled.
- A large "known gaps, do not build without checking first" list is maintained directly in `BUILD-STATUS.md`: hard account/data deletion, week-view/drag-reschedule/games-events/parent-facing anything (explicitly out of scope — "this is a coach tool, not TeamSnap"), push notifications, org-tier accept/decline staff flows, automated test suite. **None of these conflict with the team-first nav restructure** — they're feature scope, not navigation shape.
- **Conflict risk for the nav restructure**: none of the rewire's remaining/deferred items touch navigation structure itself. The one nav-shaped item — the 2026-07-12 "nav-flow audit" session (Builder unsaved-changes guard, `priorView` tracking, tab iconography) — hardened the *current* flat 4-tab shape (added `guardedSetView`, `priorView`, the live-resume bar). A team-first restructure would need to re-verify or rebuild all of that guard/priorView machinery against whatever new state shape replaces `view`, since it's currently threaded through `App.jsx`'s single `view` string, not componentized.

**Scheduling addendum (the migration + its own inline comments are the closest thing to source), implemented status:**

- Recurring series (days-of-week × time × date-range → materialized `practices` rows via `create_practice_series` RPC, hard-capped, DST-safe) — **implemented**.
- Team colors (`color_primary`/`color_secondary`) — **implemented**, used for dot/stripe coding across Home/Schedule/Manage.
- Planned absences (advance notice, distinct from `session_attendance`'s real-time record) — **implemented**, feeds Builder's default group assignment and live-session attendance defaults.
- Home screen replacing a prior "Today" screen, Schedule tab (agenda/month) — **implemented**, per `BUILD-STATUS.md`'s 2026-07-09 log entries.
- Planning-depth indicators ("35/60 min", partial/overplanned/complete) — **implemented**, purely derived (`planningState()`/`sumMins()` in `constants.js`), not stored.
- Explicitly out of scope per the addendum's own stated "positioning boundary" (per `BUILD-STATUS.md`'s Known Gaps section, attributed to the scheduling addendum): week view, drag-to-reschedule, games/events, series-level default templates, moving a plan between practices, availability polling, any parent/player-facing surface.
- **Conflict risk for the nav restructure**: the addendum's Home/Schedule split is exactly the pair of screens a team-first restructure would fold into a cross-team "My week" home + per-team Schedule tab. `HomeScreen`'s existing cross-team "Next 14 Days" agenda (§3) is *already* conceptually the "My week" home screen the restructure is aiming for — it just isn't currently the entry point into a per-team workspace, it's a flat list. The restructure is more "extract what Home already does into the new home screen and make each row route into a team workspace" than a from-scratch build.

---

## 6. RISKS

- **`skill_tags` has no `team_id` — Goals is a per-team concept sitting on a per-coach/per-org/per-global taxonomy.** `skill_tags.scope` is `'global' | 'org' | 'coach'` (§1.2); there is no `'team'` scope and no column tying a tag to a specific team. A team with more than one coach (assistant coaches, common per `team_staff.role`) has no guarantee they share the same `'coach'`-scoped tags — each coach's private tags are only visible to that coach (RLS: `skill_tags_select_access`, `scope='global' or can_access_owned(...)`, where `can_access_owned` for a `'coach'`-scoped row resolves to `owner_user_id = auth.uid()`, not team membership). Defining "target % per skill tag per team" requires deciding *whose* tag set a team's goals are defined against — this is an unresolved data-model question, not an implementation detail.
- **No settings/preferences table exists (§1.8).** The "goals window weeks, default 4, stored per team" requirement has no home. The lightest-touch option matching this schema's existing convention is a bare column on `teams` (precedent: `timezone`, `color_primary` were both added as plain `teams` columns, not a side table) — but that precedent has never held more than 2-3 loosely related fields; a `goals_window_weeks int not null default 4` column would be consistent with style, though a coach/team-settings table would be a bigger but cleaner change if more per-team config is coming.
- **`practices.status` never actually reaches `'completed'`** in any code path found (§1.7) — completion lives entirely on `practice_live_sessions.status`, a separate table, joined by `practice_id` (not unique — a practice can have multiple live-session rows). Any Goals/actuals query that filters `practices` by `status = 'completed'` will silently return nothing; it must instead join through `practice_live_sessions` the same way `fetchPracticeRunStatus` already does. This is a real trap for whoever writes the actuals query without reading the frontend's existing status-derivation logic first.
- **`session_activity_log.ended_at` can be permanently null** (§2.1) with no cleanup trigger. An abandoned or force-ended live session leaves its last-active row open forever. Any actuals aggregation needs an explicit decision (exclude the row? clamp to `practice_live_sessions.ended_at`? clamp to `now()` and only for still-active sessions?) — there's no existing convention to follow, since nothing today reads this column for aggregation.
- **Tag reachability depends on `library_activity_id`, which is optional everywhere it appears** (`practice_activities`, `template_activities`, `stations`) — freeform/no-library activities and all `'checklist'`-type activities are structurally untaggable (§2.1/§2.4). Any trailing-window actuals-vs-target computation will have an unattributed remainder every practice that included a break, team talk, or quickly-typed activity; the Goals UI needs to represent that remainder (as "untagged" or "other") rather than silently under-reporting against target %s, or targets will never appear to add up even when execution matched intent.
- **Old POC tables (`app_data`, `live_sessions`, `coaches`) are still present in the database and still granted to `authenticated`** (`20260707020000_authenticated_grants_poc_tables.sql` — never revoked or dropped in any later migration; confirmed via `grep -rn "app_data\|drop table" supabase/migrations/*.sql`, only hits are the grant file and a comment in `20260714000000_notes_table.sql` noting notes were "the one piece of data never migrated off the legacy `app_data` JSONB blob"). They're dead weight for the Goals feature specifically (nothing there is tag/duration-relevant), but any generic schema-introspection tooling built for the nav/goals work (e.g. an admin schema browser) needs to know to ignore them, and a hard-delete/cleanup pass has apparently never happened.
- **RLS itself is not a nav-restructure risk** — `can_access_team`/`can_manage_team` (§1.1) key strictly off `teams.id` and `auth.uid()`, with no assumption baked in about which screen or tab is asking. A team-first workspace can reuse every existing team-scoped RLS function unchanged; this is a genuine low-risk area, called out because the prompt asked to flag RLS assumptions specifically and the honest answer here is "none found."
- **No day-window query exists to build "Plan" (upcoming) vs. "Goals" (trailing X weeks) against** (§3) — `fetchPracticesFull()` fetches every practice unbounded and all date-window logic (14-day, or any future "trailing 4 weeks") is client-side JS over the full result set. This works today at solo-coach data volumes but is a real scaling question for a Goals feature that needs to run a trailing-window aggregation server-side (ideally via SQL/RPC, not by shipping every historical practice's full activity tree to the client to filter in JS) — there is no existing precedent in this codebase for a bounded/paginated practices query to build on.
- **`activity_library.duration_minutes` is a *seed* value, not authoritative** (§1.3) — it's copied into `practice_activities.duration_minutes` at build time and never referenced again. Editing a drill's default duration in the Library never updates any practice that already used it (by design — full-copy semantics). This is consistent and not itself a bug, but worth remembering: Goals math must always read duration from `practice_activities`/`template_activities`, never from `activity_library`, or planned-minutes numbers will silently drift from what a coach actually sees in Builder/History.
