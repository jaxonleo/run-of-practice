# Run of Practice — Database Architecture & Permissions Snapshot

**Generated:** 2026-07-21, by direct introspection of the **live** Supabase project (`bepoojcbizxhqadrytjq`, "run of practice web app", Postgres 17.6, `us-west-2`) via the linked Supabase CLI — not just a read of migration files. Migration files describe intent at write-time; this document describes what's actually deployed and what data actually exists right now. Where the two disagree, this doc follows the live database.

Purpose: reference material for planning the **org model** build-out. The short version: **the org schema and RLS already exist and are fully wired, but zero real usage exists in production today** — every real team, drill, asset, and template in the database is owned by an individual coach, not an organization. Building "the org model" today is much closer to *turning on and finishing* a mostly-built subsystem than starting from scratch.

> **2026-07-21, later same day — org model implemented.** Everything below this point describes the state *before* implementing `ROP-Org-Experience-Handoff.md`. That handoff has since been built: `organization_members` was replaced outright by `org_staff` (director-only role), `org_invites` + accept/decline RPCs were added, drill sharing moved from `activity_library.shared_with_organization_id` (a single org) to a many-to-many `activity_library_org_shares` join table, org-scoped team/staff/player RPCs (`org_create_team`, `org_assign_team_staff`, `org_assign_player`) were added, an org-library fork RPC (`promote_drill_to_org_library`) was added, and an Org Home page now exists in the client. See §7 at the end of this file for the actual as-built state — read this historical snapshot for *why* things were designed the way they were, but treat §7 as the current source of truth for anything it contradicts here (particularly finding 5 below, which the fix predates).

---

## 1. Stack

- **Frontend:** React 18 + Vite, hand-rolled CSS-in-JS, no component library. `src/supabase.js` is the *only* place that talks to Supabase — no component calls `supabase.from(...)` directly.
- **Backend:** Supabase — Postgres with RLS on every table, Auth (email OTP only, no magic links), Realtime (live sessions), one Edge Function (`notify-team-staff-added`).
- **Deploy:** Vercel, auto-deploy on push to `main`.
- **Migrations:** 145 files in `supabase/migrations/`, applied via `supabase db push` (some early ones were applied via raw Management API and later reconciled with `migration repair`).

---

## 2. Schema inventory (45 tables, all RLS-enabled)

Grouped by domain. "Ownership" shows how each row's visibility/edit rights are anchored.

### Identity & organization
| Table | Rows (live) | Ownership anchor | Notes |
|---|---|---|---|
| `profiles` | 17 | 1:1 with `auth.users` | auto-created on signup via `handle_new_user()` trigger |
| `organizations` | 4 | `created_by` | **all 4 are stale test orgs, see §5** |
| `organization_members` | **0** | `(organization_id, user_id)` | role: `owner`/`admin`/`coach`/`viewer` — **never populated in real usage** |
| `admin_users` | 1 | `user_id` | platform-level founder/superadmin gate, unrelated to org roles — see §4.4 |

### Teams & staff
| Table | Rows | Ownership anchor |
|---|---|---|
| `teams` | 8 | `owner_user_id` (personal) **or** `organization_id` (org-owned) |
| `team_staff` | 4 | `team_id` + own `user_id`; role: `head_coach`/`assistant_coach`/`helper` |
| `players` | 24 | via `team_id` |
| `planned_absences`, `player_focus_areas`, `notes` | — | via `team_id`/`player_id` |

### Library (drills, equipment, templates, taxonomy) — the "coach-or-org" pattern
| Table | Ownership anchor |
|---|---|
| `activity_library` (drills) | `owner_user_id` **or** `organization_id`; separate `shared_with_organization_id` for a personal drill shared *into* an org |
| `activity_library_equipment`, `drill_tags` | join tables, follow the parent drill |
| `assets` (equipment/gear) | `owner_user_id` **or** `organization_id` (never a team) |
| `locations`, `sublocations` | `owner_user_id` **or** `organization_id` |
| `templates` (reusable practice plans) | `owner_user_id` **or** `organization_id`, + `shared_with_organization_id` |
| `template_activities`, `template_stations`, `template_station_blocks`, `template_activity_equipment`, `template_station_equipment`, `template_activity_checklist_items` | follow parent template |
| `skill_categories` | global, curated, no INSERT policy — service-role/SQL-editor only |
| `skill_tags` | hybrid scope: `global` (curated) / `org` (org-admin managed) / `coach` (private) |
| `content_catalogs` | public-library content attribution (separate from org sharing — see §4.4) |

### Practice execution
| Table | Ownership anchor |
|---|---|
| `practices`, `practice_series` | via `team_id` |
| `practice_activities`, `stations`, `station_blocks`, `station_equipment`, `practice_activity_equipment`, `practice_activity_checklist_items` | via `practice_id` |
| `practice_live_sessions` | via `practice_id`; realtime state machine (controller handoff, pause/resume) |
| `session_operations`, `session_activity_log`, `session_attendance`, `session_groups`, `session_group_members` | via `practice_live_sessions` |
| `preview_sessions` | pre-practice anonymous helper view |
| `session_access_tokens` | anonymous access grant — see §4.3 |

### Other
| Table | Purpose |
|---|---|
| `team_goals` | coach-set skill-tag focus targets per team |
| `feedback` | in-app feedback (authenticated) |
| `user_events` | analytics/telemetry |
| `app_data`, `coaches`, `live_sessions` | **legacy proof-of-concept tables, unused by the current app** — flagged in §5 |

---

## 3. Live data snapshot (2026-07-21)

```
auth.users:            17   (mostly disposable test accounts, see BUILD-STATUS.md)
profiles:              17
organizations:          4   ← all stale test data, 0 real orgs
organization_members:   0   ← never populated
teams:                  8   ← all personal (owner_user_id), none org-owned
team_staff:             4   (3 head_coach, 1 assistant_coach)
players:               24
practices:             81
admin_users:            1   (the founder/Jax)
app_data / coaches / live_sessions (legacy POC): 5 / 2 / 76 rows, orphaned
```

**This is a single-solo-coach production system.** The org tables exist, are fully RLS-wired, and have never been exercised by a real user.

---

## 4. Permission model

There are **four independent authorization layers**, stacked, not overlapping:

### 4.1 Platform admin (`admin_users` / `is_admin()`)
A flat superadmin gate, separate from everything else. `is_admin()` checks membership in `admin_users`. Used only for:
- Founder metrics RPCs (`get_founder_metrics_summary`, `get_founder_metrics_detail`)
- Content-catalog curation rights (`founder_admin_catalog_rights` migration) — i.e. managing the public drill library (Baseball/Basketball/Football/Soccer/Volleyball/Lacrosse JSON libraries), not org data
- `grant_admin(email)` / `revoke_admin(user_id)` — callable only by an existing admin (checks `is_admin()` internally, raises otherwise)

This has **nothing to do with organization roles** — it's "founder can see business metrics and curate the public library," not "org owner manages their org."

### 4.2 Organization roles (`organization_members.role`, schema-only today)
```
CHECK (role IN ('owner', 'admin', 'coach', 'viewer'))
```
- `is_org_member(org_id)` → any non-archived row for that org + caller
- `is_org_admin(org_id)` → role is `owner` or `admin`
- Org creation: `handle_new_organization()` trigger auto-inserts the creator as `owner` — **but only if `created_by` is not null**. All 4 existing orgs have `created_by = null`, which is *why* `organization_members` has zero rows (see §5).
- No distinction is currently enforced anywhere between `coach` and `viewer` — nothing in the codebase queries for that specific role value. That distinction exists in the CHECK constraint and nowhere else yet.
- RLS on `organizations`/`organization_members`: select if member, insert self as creator, update/insert-member only if admin. **No DELETE policy on either** (archive-only, via `archived_at`).

### 4.3 Team roles (ownership + `team_staff.role`)
Two things compose to determine team access, via SECURITY DEFINER helper functions used everywhere downstream:

**`can_access_team(team_id)`** (read/use) — true if:
- caller is `teams.owner_user_id`, OR
- `teams.organization_id` is set and caller `is_org_member` of it, OR
- caller has a non-archived `team_staff` row for that team (any role: head_coach, assistant_coach, helper)

**`can_manage_team(team_id)`** (edit settings/staff/roster) — true if:
- caller is `teams.owner_user_id`, OR
- `teams.organization_id` is set and caller `is_org_admin` of it, OR
- caller has a non-archived `team_staff` row with `role = 'head_coach'` specifically

```
CHECK (team_staff.role IN ('head_coach', 'assistant_coach', 'helper'))
```
- Team creation auto-adds the creator as `head_coach` via `handle_new_team_head_coach()` trigger, but **only when `owner_user_id IS NOT NULL`** (i.e. personal teams; an org-created team doesn't auto-add a head_coach row this way).
- `add_team_staff()` RPC silently links to an existing account by email, or leaves a pending invite that `claim_pending_team_staff()` resolves on signup.
- `leave_team()` RPC is intentionally narrow: archives only the caller's own row, refuses if they're the team owner.
- Every downstream table (practices, library-owned-by-team-context, live sessions, etc.) checks access by walking back to `can_access_team`/`can_manage_team` through chained helper functions (`can_access_practice`, `can_manage_practice`, `can_access_station`, etc. — ~50 such functions total, all `SECURITY DEFINER`, all in `public`).

**Coach-or-org ownership pattern** (drills, assets, locations, templates, skill tags):
- `can_access_owned(org_id, owner_user_id)` = caller owns it OR is a member of the owning org
- `can_manage_owned(org_id, owner_user_id)` = caller owns it OR is an *admin* of the owning org (plain org members can't edit org-owned library items — keeps shared libraries curated)
- `can_access_owned_or_shared(...)` extends read access to items a personal owner has explicitly shared into an org via `shared_with_organization_id`
- Linking join tables (equipment↔drill, tag↔drill) go through compatibility-check functions (`can_link_asset_to_activity`, etc.) so an org-owned drill can only link assets/tags from that *same* org or global ones — never a stranger's personal asset.

### 4.4 Anonymous / token-based tier (helpers, parents — no login)
A `session_access_tokens` row (`scope`, `expires_at`, `revoked_at`) grants narrow, time-boxed, unauthenticated access:
- `/preview/:token` → `get_preview_view(token)` — equipment, roster, countdown
- `/live/:token` → `get_live_session_view(token)` — current drill/station, roster, optional attendance-marking
- `submit_helper_attendance(token, player_id, status)`, `log_helper_join_event(token)` — the only two anon *writes* in the real schema
- `validate_token()` checks scope match + not expired + not revoked, `SECURITY DEFINER`
- Player data is deliberately minimized in these views (first name + last-initial + jersey only)
- `anon` role has table-level grants of only `REFERENCES/TRIGGER/TRUNCATE` (no real access) on every real table — **all anonymous access goes through the SECURITY DEFINER RPCs above, never direct table access.** Clean design.

### 4.5 RLS enforcement conventions
- RLS enabled on all 45 tables (`FORCE ROW SECURITY` is off everywhere, which is normal — only matters for table owners/superuser connections, not `anon`/`authenticated`).
- **No DELETE policy on almost any table** — archive via `archived_at`, never hard-delete. Exceptions: join tables where removing an association isn't destroying history (`drill_tags`, `activity_library_equipment`), and one explicit `session_activity_log` delete policy added later for audit-adjustment correction.
- Actor-identity columns (`created_by`, `marked_by`, `noted_by`) are enforced via `WITH CHECK (col = auth.uid())`, not app-layer trust.
- `service_role` bypasses RLS entirely (used by the Edge Function and import scripts) — never exposed to the client.

---

## 5. Flagged findings (things to know before building on top of this)

1. **Organizations are schema-complete but production-empty.** All 4 `organizations` rows are named things like "Test Org 1783442005443" / "Isolate Org" / "C Org 1783442006292" / "Test Coaching Org" — leftover from the 2026-07-07 sharing-model test session (per `BUILD-STATUS.md`), all with `created_by = null`, which is *why* they never got an `organization_members` row (the auto-owner trigger only fires when `created_by` is set). **No org has ever been created through a real signup flow.** Worth deciding whether to delete these 4 before building on top, since they're indistinguishable from real orgs at the schema level (nothing marks them as test data other than the name and the null `created_by`).

2. **No client code exists for org creation, invitation, or role management.** `src/supabase.js` only *reads* `organization_members` (to populate `myOrgs` for the drill "share to org" picker) and lets a coach set `shared_with_organization_id` on a drill. There is no "create an org," "invite someone to my org," "change someone's org role," or "leave an org" function anywhere in the client. The org side of the schema is read/share-only from the app's perspective today.

3. **The `coach` vs `viewer` org role distinction is unused.** The CHECK constraint allows it, `is_org_admin`/`is_org_member` don't distinguish between them (member is member), and no query anywhere branches on `role = 'viewer'` vs `role = 'coach'`. If the org model build-out wants read-only org members, that logic needs to be written from scratch — the column supports it, nothing enforces it yet.

4. **Three legacy POC tables (`app_data`, `coaches`, `live_sessions`) have wide-open anon policies**: `USING (true) WITH CHECK (true)` for the `anon` role, meaning any unauthenticated caller can currently `SELECT`/`INSERT`/`UPDATE` these tables directly via the PostgREST API with no filtering at all. They hold 5/2/76 orphaned rows respectively from a pre-rewrite prototype and are not referenced anywhere in current `src/` code, so nothing in the live app is at risk — but the open grant is real and live on the production database today. `supabase/migrations/README.md` flags these as "untouched, a deliberate separate decision for you to make" about whether to drop them; that decision is still pending. Worth cleaning up (either drop the tables or at minimum revoke the `anon full access` policy) before or alongside the org work, so it isn't sitting there indefinitely.

5. ~~**Personal teams with multiple staff have no shared equipment pool**~~ **Correction: already fixed, this finding was stale even at the time this doc was first written.** `assets` gained a `team_id` column (migration `20260707160000_equipment_join_asset_cascade.sql`) after the chunk-2 README docs (which this finding was based on) were written, and `can_access_asset_owned`/`can_manage_asset_owned` already check it (`p_team_id is not null and can_access_team(p_team_id)`). A multi-coach personal team already shares equipment correctly via team membership, independent of the org model.

6. **11+ disposable test accounts** sit in `auth.users` with no associated data (per `BUILD-STATUS.md`, not yet cleaned up) — inflates the `auth.users`/`profiles` counts above; only a handful of the 17 profiles represent anything real.

---

## 6. What "building out the org model" actually means from here

Given the above, the realistic scope is **not** "design an org schema" — that schema, its RLS, and its helper functions already exist and look reasonable (owner/admin/coach/viewer roles, org-vs-personal ownership on every library table, org-shared team creation, curated-vs-open write rules for org-owned library content). The real remaining work looks like:

- Decide what `coach` vs `viewer` org roles should actually gate, then implement that check (today they're equivalent).
- Build the actual UI/RPC flows: create an org, invite a member (accept/decline — the existing `team_staff` invite pattern, described in `BUILD-STATUS.md` as "deliberately informal," is the closest precedent but was explicitly called out there as *not* meant to scale to org-level stranger-inviting-stranger), change a member's role, remove a member, leave an org.
- Decide how `teams.organization_id` gets set in practice — today only `is_org_admin` can insert an org-owned team (`teams_insert_own_or_org` policy); there's no "convert my personal team into an org team" migration path.
- Decide whether/how a multi-coach personal team (no org) should share equipment, given `assets` never binds to a team directly (see finding 5) — this might be the actual forcing function for wanting orgs at all.
- Clean up the 4 stale test orgs and decide the fate of the 3 legacy POC tables (finding 1 and 4) so they don't get confused with real state while iterating.

---

---

## 7. As-built: the org model implementation (2026-07-21)

Migrations `20260721000000` through `20260721040000`. All applied directly to the live project via `supabase db query` (dry-run tested first with `BEGIN;...;ROLLBACK;`), same reconciliation-gap pattern as the 2026-07-18/19 migrations noted in §1 — none of these five are yet recorded in the CLI's own migration-history table (`migration repair` was blocked by this session's permission classifier), so a future `supabase db push --dry-run` will list them as pending even though they're live. Repair before the next `db push`.

**Role model.** `organization_members` (owner/admin/coach/viewer) is gone. `org_staff` replaces it: one role, `director`, enforced by a plain CHECK (not a hard enum) so adding `admin` later is a one-line constraint change. `is_org_member`/`is_org_admin` were redefined in place (`CREATE OR REPLACE`, same signatures) to read `org_staff` — every existing call site (`can_access_team`, `can_manage_team`, `can_access_owned`, `can_manage_owned`, `can_access_asset_owned`, etc.) picked up the change with no further edits needed. `org_staff` has **no direct INSERT/UPDATE/DELETE policy at all** — every membership change goes through a SECURITY DEFINER path (`handle_new_organization` trigger, `org_assign_team_staff`, `accept_org_invite`), never a client insert/update. The 4 stale test orgs from finding 1 were archived (`archived_at`, not deleted) in the same migration.

**Org-scoped team/staff/player writes.** Three new RPCs — `org_create_team(org_id, name, sport, ...)`, `org_assign_team_staff(team_id, user_id, role)`, `org_assign_player(team_id, first_name, last_name, ...)` — each an explicit, auditable entry point gated on `is_org_admin`/`can_manage_team`. Note: RLS itself didn't need to change for these (an org admin could already write directly via the pre-existing `is_org_admin` branch in `teams_insert_own_or_org`/`players_insert_manage`); the RPCs are an API-surface convention per the handoff's design principle 0, not a new security boundary. That existing direct-write path was deliberately left open, not narrowed — narrowing it wasn't asked for.

**Multi-org drill sharing.** `activity_library.shared_with_organization_id` (single org) is gone for drills specifically — replaced by `activity_library_org_shares`, a many-to-many join table, because a coach can be `director` of one org while coaching a team in another (§1's scoped-role-matrix), so a single-org column couldn't represent "share with every org I actually have a relationship to." Gated by a new `can_share_drill_to_org()` helper (must have a `team_staff` seat on a team in that org, or be `org_staff` there already). Write-only via a batch RPC, `set_drill_org_shares(drill_ids[], org_ids[])` — all-or-nothing on both the drill-ownership check and the target-org-relationship check, full-replace semantics (pass `[]` to unpublish everywhere). **`templates.shared_with_organization_id` was deliberately left untouched** — same single-org limitation, but out of scope (not what was asked); if templates ever need multi-org sharing, this is the pattern to repeat for them.

**Org-library forking.** `promote_drill_to_org_library(drill_id, org_id)` — director-only, full copy (not a reference) into an org-owned row, matching the existing `practice_activities`-copies-`activity_library` convention. Equipment/skill-tags only carry over where they'd remain link-compatible with an org-owned drill (org-owned assets, global or that org's own tags) — a personal drill's own gear usually won't qualify, so forks commonly land equipment-empty for the director to redo, rather than silently creating a row referencing incompatible items.

**Coach invite flow.** New `org_invites` table (`status`: pending/accepted/declined). Deliberately **not** the `team_staff`/`add_team_staff` pattern (which auto-links on insert, no consent step) — joining an org is a bigger commitment, so nothing is granted until `accept_org_invite(invite_id)` runs, and that RPC matches the caller's email against `auth.jwt() ->> 'email'` server-side, never a client-supplied value. Supports both invite-time team pre-assignment and post-acceptance assignment (`org_invites.team_id`/`team_role`, nullable). No signup-time claim trigger needed (unlike `team_staff`) — an invite is plain-text email, already visible to its recipient the moment they're signed in, via the `org_invites_select` RLS policy matching their own JWT email.

**Org Home page rollup.** `get_org_weekly_practice_rollup(org_id, weeks)` — weekly count of completed live practices across every team in one org, gated by `is_org_member` (not `is_admin` — this has nothing to do with the founder-metrics gate in §4.1). Much smaller than `get_founder_metrics_summary`, same `generate_series`-of-weeks shape.

**Equipment picker.** No schema change needed — `assets.team_id` (finding 5, corrected above) already made this work. Only the drill-editor's picker in `ModalLayer.jsx` was touched: own equipment now sorts first, ahead of org/team-shared, per the handoff's ask.

**Client wiring.** `src/supabase.js` gained: `fetchPendingOrgInvites`, `fetchOrgSentInvites`, `orgInviteCoach`, `acceptOrgInvite`, `declineOrgInvite`, `orgCreateTeam`, `orgAssignTeamStaff`, `orgAssignPlayer`, `setDrillOrgShares` (replacing `setDrillShare`), `promoteDrillToOrgLibrary`, `fetchOrgWeeklyPracticeRollup`. `fetchMyTeams`'s per-team mapping gained `organizationId` (previously omitted entirely — the Org Home page couldn't have filtered "teams in this org" without it). A new `OrgHomeScreen.jsx` is routed at `/org/:orgId`, reached from Settings (mirrors the existing Founder Metrics entry point) when `data.myOrgs` is non-empty. A pending-org-invite accept/decline card was added to `HomeScreen.jsx`, next to the existing team-welcome card.

**Verified, not yet click-tested.** Every RLS/RPC boundary was verified with a 9-case test suite run inside `BEGIN;...;ROLLBACK;` against the live database (simulated `auth.uid()`/`auth.jwt()` via `SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claims = ...` against real existing profile ids — no fabricated auth sessions, no service-role key used, nothing persisted) — covers §7 of the handoff's testing checklist: stranger blocked from org RPCs, director allowed, private drill invisible to a non-org stranger, org-shared drill visible to org members, batch share is all-or-nothing (and atomic — no partial apply), org-library fork is independently editable in both directions, invite-accept email match is server-side (mismatched email rejected, matching email succeeds and grants `org_staff`), and per-org scoping doesn't bleed across two orgs for the same director. **Not yet verified**: an actual signed-in click-through of the invite/create-team/Org-Home UI — this session had no access to the real coach's credentials or a service-role key to create a disposable test account (per the same limitation `BUILD-STATUS.md` already notes for prior sessions), so only build-compiles-cleanly / no-console-errors was confirmed for the UI layer. Do a real click-through before calling this fully shipped.

---

*Sources: live introspection via `npx supabase db query --linked` against `information_schema`, `pg_policies`, `pg_proc`, `pg_constraint`, `pg_class`, `information_schema.triggers`, and role-table-grants; cross-checked against `BUILD-STATUS.md` and `supabase/migrations/README.md` for narrative history.*
