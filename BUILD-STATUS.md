# Run of Practice — Build Status

**Last updated:** 2026-07-10
**Status:** Live in production at [runofpractice.com](https://www.runofpractice.com), single real user (solo coach), actively iterating ahead of August testing. **The 2026-07-10 session's frontend changes are in the working tree but not yet git-committed** (migrations/edge function are already applied/deployed to the live Supabase project regardless) — check `git status`, not just `git log`, before assuming the frontend has landed.

This file is maintained at the end of each working session so a fresh Claude conversation (or a human) can pick up context quickly. If you're an AI assistant reading this cold: read this whole file before touching code, then check `git log --oneline -20` for anything more recent than "Last updated" above.

---

## What this is

A live-practice-orchestration app for youth sports coaches: build a practice plan (drills, stations, timing), run it live with a timer/rotation system, share a read-only view with parent helpers, track attendance, and plan on a recurring schedule. React/Vite frontend, Supabase (Postgres + Auth + Realtime) backend, deployed on Vercel.

## Stack & repo layout

- **Frontend:** React 18, Vite, no CSS framework (hand-rolled CSS-in-JS injected via a `<style>` tag, Barlow Condensed/DM Mono fonts). No component library.
- **Backend:** Supabase — Postgres with row-level security on every table, Auth (email OTP), Realtime for live-session sync.
- **Deploy:** Vercel, auto-deploys `main` to production.
- `src/App.jsx` — still the largest file; holds `TeamsScreen`, `BuilderScreen`, `PlayerProfile`, `RostersTab`, `NotesTab`, `AuthScreen`, `NameScreen`, and the top-level `App()` router. Other major screens have been split into their own files under `src/components/`.
- `src/supabase.js` — the entire data-access layer. Every DB read/write goes through a named export here; nothing calls `supabase.from(...)` directly from a component.
- `src/constants.js` — pure helpers + shared constants (`uid()`, `TEAM_COLORS`, grouping math, `INIT` shape).
- `supabase/migrations/*.sql` — 93 migrations, applied directly via the Supabase Management API SQL endpoint (no local Supabase CLI in this environment). Each new feature gets one dated migration file with inline comments explaining *why*, not just *what*.
- `supabase/functions/*` — Edge Functions (Deno), deployed via the Management API's `/functions/deploy` multipart endpoint (also no local CLI). First one added 2026-07-10 (`notify-team-staff-added`). Secrets set via `POST /v1/projects/{ref}/secrets`, never committed to migrations.

## Feature inventory (what actually works today)

**Auth & account**
- Email OTP sign-in (code, not magic link — magic links broke for the installed-homescreen-PWA case). Branded email via Resend SMTP.
- One-time name capture on first sign-in (covers pre-existing accounts too).
- Soft account deactivation (reversible, auto-reactivates on next sign-in) and team deletion.

**Teams & roster**
- Teams with sport, timezone, season dates, and a color (auto-assigned from a curated palette on creation, editable, includes black/dark gray) — now shown as a left-edge stripe on the Teams list and team detail header.
- Players, staff (head coach/assistant/helper roles), structured focus areas (skill-tag taxonomy + coach freeform sub-tags).
- **Team creator is automatically head coach** (trigger on team insert, personal teams only) with a one-time backfill for pre-existing teams.
- **Staff invite linking**: adding a coach by email (`add_team_staff` RPC) silently links to an existing account if one exists, and a `claim_pending_team_staff` trigger auto-links any pending invite the moment the invited person signs up — covers both orderings. Re-adding someone who left revives their archived row instead of duplicating.
- **Invite notification email**: a `pg_net`-triggered Edge Function sends an informational (non-auth) email via Resend when staff are added — never Supabase's `admin.inviteUserByEmail` (that's a magic link, the exact mechanism already removed for PWA sign-in).
- **One-time welcome card + self-serve leave**: a newly-linked staff member sees "You've been added to X by Y" once, with a "Leave" link (`leave_team` RPC, narrow — archives only the caller's own row, refuses for team owners).
- **Staff-add suggestions**: adding a coach shows tap-to-fill chips for staff you've already added on your other teams (deduped by email; no account-existence search beyond that).
- **Role-aware UI**: assistants/helpers view everything and can run live sessions, but Builder/schedule-wizard/team-settings/staff-management entry points are hidden for teams they don't head-coach — checked per-team (`isHeadCoach` in `constants.js`), not globally, since a user can be head coach on one team and assistant on another.

**Library**
- Drills, equipment/assets, templates — coach-owned with an org-sharing model (share to org, browse "From Our Coaches").
- Manual drill reordering.

**Planning & scheduling**
- **Builder**: practice/template editor — drills, checklist activities (intro/closer), station blocks with rotation, grouping (whole/partners/N groups), equipment, coaching points, per-activity coach/sublocation assignment.
- **Recurring schedules**: a wizard (days of week → time/duration → date range defaulted from team season → location → preview with per-date deselect) backed by a `create_practice_series` RPC — atomic, server-capped (≤150 occurrences, ≤400 day range), timezone-correct (DST-safe via `AT TIME ZONE`).
- **Home screen**: adaptive hero card for the next practice (Plan/Review/Run depending on state), "N practices need a plan" nudge, 14-day agenda, quick actions.
- **Schedule tab**: Agenda (day-grouped, team-color-coded, team filter chips) and Month (calendar grid with per-day dots) views.
- **Planned absences**: capture from Practice Detail ("Who's out?"), Player Profile ("Mark out for..."), or Home quick action. Feeds Builder's default group assignment (absent players excluded from auto-splits) and the live session's attendance defaults.
- Cancel (this-occurrence or this-and-future for a series) / restore; a "missed" state for practices whose time passed with no run.
- All practice times display in the **team's** timezone, not the viewing device's.
- **Planning-depth indicators**: when a practice has both activities and a `scheduled_duration_minutes`, agenda rows/hero card/day sheet/Practice Detail show "35/60 min" — half-filled/amber for partial (short by >max(10min,15%)), warning-tinted for overplanned (over by >5min), filled+check when within tolerance. Purely derived, never stored. Month-view dots stay binary on purpose (a third fill state doesn't read at dot size). `planningState()`/`sumMins()` in `constants.js`.
- **Getting-started checklist**: a single "?" icon on Home (with a dot while incomplete), opening a 5-step checklist (team → roster → schedule → first plan → first live run) fully derived from existing data, no stored progress flags.
- Series wizard no longer exposes sublocation at the practice level (station/activity-level sublocation is unaffected) — that's drill/station detail, not "where do we meet."

**Live sessions**
- Real-time state machine (`practice_live_sessions`) with take-control/hand-off between coaches, pause/resume, ±1 min nudge, station rotation, append-only attendance (`session_attendance`) and per-activity dwell-time logging.
- Offline resilience: single-pending-write retry with backoff, distinguishes "network down" from "someone else moved the session" so a signal drop doesn't blank the screen.
- Mid-run plan editing (`LiveEditBuilder`).

**Helper/parent-facing (anonymous, token-based, no login)**
- `/preview/:token` — pre-practice setup view (equipment, roster, countdown to start).
- `/live/:token` — live view during a run (current drill/station, roster, optional attendance-marking scope).
- Player data is minimized (first name + last-initial + jersey), everything else (equipment, coaching points, location) is shown — a deliberate choice, not an oversight.

## Known gaps / deferred (do not build without checking with the user first)

- **Hard account/data deletion** (GDPR-style erase) — not built. Soft deactivation only. There's an unresolved multi-path FK cascade-ordering issue blocking this; see memory `rop_actor_deletion_fk_gotcha` (now also covering `practice_live_sessions.practice_id` and `preview_sessions.practice_id`, found 2026-07-10).
- **Week view, drag-to-reschedule, games/events, series-level default templates, moving a plan between practices, availability polling, parent/player-facing anything** — explicitly out of scope per the scheduling addendum's positioning boundary (this is a coach tool, not TeamSnap).
- **Notifications/reminders** — needs PWA push, not started (the 2026-07-10 invite-notification email is a one-off transactional send via a new Edge Function, not a general notifications system).
- **Org-tier staff provisioning / accept-decline flows** — the welcome-card+leave pattern (2026-07-10) is deliberately informal for personal teams; a real accept/decline flow is deferred to when orgs let strangers add strangers (Google Calendar's auto-add spam history is the cautionary tale for that scale, not this one).
- No automated test suite — every feature has been verified empirically in a live browser against the real Supabase project with disposable throwaway accounts, not via unit/integration tests.
- 11 disposable test accounts from **prior** sessions (2026-07-06/07, `rop-stage4/5/sharing-*@example.com`) are still sitting in `auth.users` with no associated data — found while cleaning up this session's own test accounts, not cleaned up yet (didn't want to bulk-delete auth users without checking first). Harmless but worth a cleanup pass.

## Conventions worth knowing before you touch this codebase

- **No client-side inserts loop for bulk operations** — anything that creates many rows (e.g. a recurring series) goes through a single atomic RPC with server-side caps, never a client `for` loop of inserts.
- **Archive, don't delete** — almost every table uses `archived_at`, not hard deletes. Matches the whole app's "your data is safe" posture.
- **RLS on everything** — new tables get policies following the existing `can_access_team`/`can_manage_team`/`can_access_practice` helper-function pattern (`supabase/migrations/20260704000800_rls_functions.sql` and friends), not ad hoc per-table logic.
- **Actor-identity columns** (`created_by`, `marked_by`, `noted_by`) are stamped via `WITH CHECK (col = auth.uid())` on insert, following the pattern in `20260704000900_rls_policies.sql`.
- **`.upsert()` needs UPDATE grant** even for `ON CONFLICT DO UPDATE` — if a table's RLS is deliberately insert/delete-only (no update policy), use `{onConflict, ignoreDuplicates: true}` instead, which only needs INSERT.
- **Migrations are dry-run before applying** — wrap in `BEGIN; ...; ROLLBACK;` via the Management API first, confirm no errors, then apply for real. See any recent migration-adding session in git history for the exact curl pattern.
- **Testing pattern**: create a disposable Supabase user via the Admin API (`generate_link` returns an `email_otp`/`hashed_token` without sending real email), sign in via `verifyEmailOtp` in the browser console, exercise the feature, verify via direct SQL against the project, then delete the disposable user/data. Never test destructive flows against the real coach's account. **Gotcha (2026-07-10):** calling `generate_link` and the app's own "Send Code" button share the same per-email Supabase Auth rate-limit bucket — doing both back-to-back trips it. Do one rate-limited action at a time: click Send Code first with no prior `generate_link` call, then call `generate_link` once afterward just to read the resulting code.
- **Timezone**: practice times must always be computed/displayed in the *team's* `timezone` column, not the browser's. Use `scheduledAtToTeamLocal`/`teamLocalToScheduledAt` in `supabase.js`, not raw `Date` methods.
- **`service_role` needs explicit table GRANTs too** — it bypasses RLS but NOT the base table grants; nothing before 2026-07-10 had ever queried app tables with the service_role key (everything else goes through `authenticated`/`anon` RLS, or the Postgres superuser via the Management API for migrations). Any new Edge Function that queries app tables needs `grant select/insert/... on public.<table> to service_role` — won't be caught by RLS testing, only by actually running the function.
- **Secrets never go in migration files** — migrations are committed to git. Vault (`vault.create_secret`, already installed on this project) or Edge Function secrets (`POST /v1/projects/{ref}/secrets`) hold the actual values; migrations only reference them by name. `pg_net`-triggered Edge Functions need `verify_jwt: false` at deploy time (no user JWT on a DB-trigger-originated call) and must gate themselves with a shared-secret header instead.

## Recent session log (most recent first)

- **2026-07-10**: Built the full testing-round-1 addendum (`ROP-Testing-Round-1-Addendum.md`, 8 sections, sequenced per its own §8): auto-head-coach trigger + backfill, `add_team_staff` RPC + claim-at-signup linking, an invite-notification Edge Function (Resend, `pg_net`-triggered), welcome card + `leave_team`, role-aware UI for assistants/helpers across Home/Schedule/Teams/PracticeDetail, planning-depth indicators (partial/overplanned/complete pills), team color stripes, staff-add suggestions, practice-level sublocation removal, and a getting-started checklist. Verified empirically at every phase with disposable two-coach test accounts (per the established pattern), including several full end-to-end browser walkthroughs of real sign-in/role-gating/welcome-leave flows. Found and fixed three real bugs along the way, none anticipated by the addendum: (1) `service_role` had no table grants at all anywhere in the schema — the invite-notification function was the first thing to ever need it; (2) two more instances of the known missing-`ON DELETE`-cascade bug class, on `practice_live_sessions.practice_id` and `preview_sessions.practice_id` (found while cleaning up stale test data, not by design); (3) six leftover disposable test teams/accounts from prior sessions (2026-07-07) were still in production, never cleaned up as the testing convention requires — deleted with explicit confirmation. Frontend changes are **not yet git-committed**; all migrations are applied and the Edge Function is deployed to production regardless.
- **2026-07-09**: Practice Detail no longer offers "Run Now" on an unplanned practice (was leading to a blank screen after Attendance) — shows "Plan Practice" instead, "Run Now"/"Edit" only once a plan exists. Team color picker added to team *creation* (was edit-only); added black/dark-gray to the palette. Fixed Schedule tab's Agenda/Month toggle padding (was 0 top / 12px bottom, now uniform).
- **2026-07-09**: Built the full scheduling addendum — recurring series wizard + RPC, Home screen (replacing Today), Schedule tab (agenda/month), team colors, planned absences end-to-end into live-session attendance. Found and fixed two real bugs via empirical testing: an `upsert()` 403 (needed UPDATE grant it was never given), and a same-flow write race that silently discarded seeded absence data (attendance-snapshot submission was overwriting it moments later). Also fixed a real pre-existing gap: practice times were computed in the browser's timezone instead of the team's.
- **2026-07-09**: Auth UX fixes — OTP screen wrongly claimed "6-digit code" when the project sends 8; fixed a real duplicate-row bug (Save button had no working reentrancy guard — `useState` isn't synchronous enough for rapid clicks, needed `useRef`); fixed a blank-page bug after deleting a team (stale `selectedTeam` state).
- **2026-07-08**: Switched primary sign-in from magic link to Email OTP (magic links broke for the installed-PWA case), branded the auth email via Resend SMTP, added one-time name collection so the greeting shows a real name instead of the raw email.
- **2026-07-07**: Production cutover — merged `frontend-rewire` into `main`, pointed `runofpractice.com` at the new app, retired the old POC. Caught and fixed a real pre-cutover bug: Supabase `site_url`/redirect allow-list still pointed at localhost.
- **2026-07-07**: Post-launch feature round — helper attendance marking, account/team deactivation, structured focus areas, roster/upcoming-activities on the helper view, manual drill reordering. Found and fixed a real pre-existing RLS bug (`teams_select_access` ambiguous-column reference silently blocked non-owner coaches from ever seeing their team).
- **2026-07-06/07**: The full 7-stage rewire off the old POC data layer onto the current 35-table Supabase schema — auth, teams/roster, library (with org-sharing), templates/builder, live sessions, helper/preview anonymous pages, offline resilience/PWA polish.

---
*Maintained by Claude. Update this file at the end of any session that changes what's built, what's deferred, or how the codebase should be approached — don't let it go stale.*
