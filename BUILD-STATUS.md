# Run of Practice — Build Status

**Last updated:** 2026-07-09
**Status:** Live in production at [runofpractice.com](https://www.runofpractice.com), single real user (solo coach), actively iterating ahead of August testing.

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
- `supabase/migrations/*.sql` — 88 migrations, applied directly via the Supabase Management API SQL endpoint (no local Supabase CLI in this environment). Each new feature gets one dated migration file with inline comments explaining *why*, not just *what*.

## Feature inventory (what actually works today)

**Auth & account**
- Email OTP sign-in (code, not magic link — magic links broke for the installed-homescreen-PWA case). Branded email via Resend SMTP.
- One-time name capture on first sign-in (covers pre-existing accounts too).
- Soft account deactivation (reversible, auto-reactivates on next sign-in) and team deletion.

**Teams & roster**
- Teams with sport, timezone, season dates, and a color (auto-assigned from a curated palette on creation, editable, includes black/dark gray).
- Players, staff (head coach/assistant/helper roles), structured focus areas (skill-tag taxonomy + coach freeform sub-tags).

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

**Live sessions**
- Real-time state machine (`practice_live_sessions`) with take-control/hand-off between coaches, pause/resume, ±1 min nudge, station rotation, append-only attendance (`session_attendance`) and per-activity dwell-time logging.
- Offline resilience: single-pending-write retry with backoff, distinguishes "network down" from "someone else moved the session" so a signal drop doesn't blank the screen.
- Mid-run plan editing (`LiveEditBuilder`).

**Helper/parent-facing (anonymous, token-based, no login)**
- `/preview/:token` — pre-practice setup view (equipment, roster, countdown to start).
- `/live/:token` — live view during a run (current drill/station, roster, optional attendance-marking scope).
- Player data is minimized (first name + last-initial + jersey), everything else (equipment, coaching points, location) is shown — a deliberate choice, not an oversight.

## Known gaps / deferred (do not build without checking with the user first)

- **Hard account/data deletion** (GDPR-style erase) — not built. Soft deactivation only. There's an unresolved multi-path FK cascade-ordering issue blocking this; see memory `rop_actor_deletion_fk_gotcha`.
- **Week view, drag-to-reschedule, games/events, series-level default templates, moving a plan between practices, availability polling, parent/player-facing anything** — explicitly out of scope per the scheduling addendum's positioning boundary (this is a coach tool, not TeamSnap).
- **Notifications/reminders** — needs PWA push, not started.
- No automated test suite — every feature has been verified empirically in a live browser against the real Supabase project with disposable throwaway accounts, not via unit/integration tests.

## Conventions worth knowing before you touch this codebase

- **No client-side inserts loop for bulk operations** — anything that creates many rows (e.g. a recurring series) goes through a single atomic RPC with server-side caps, never a client `for` loop of inserts.
- **Archive, don't delete** — almost every table uses `archived_at`, not hard deletes. Matches the whole app's "your data is safe" posture.
- **RLS on everything** — new tables get policies following the existing `can_access_team`/`can_manage_team`/`can_access_practice` helper-function pattern (`supabase/migrations/20260704000800_rls_functions.sql` and friends), not ad hoc per-table logic.
- **Actor-identity columns** (`created_by`, `marked_by`, `noted_by`) are stamped via `WITH CHECK (col = auth.uid())` on insert, following the pattern in `20260704000900_rls_policies.sql`.
- **`.upsert()` needs UPDATE grant** even for `ON CONFLICT DO UPDATE` — if a table's RLS is deliberately insert/delete-only (no update policy), use `{onConflict, ignoreDuplicates: true}` instead, which only needs INSERT.
- **Migrations are dry-run before applying** — wrap in `BEGIN; ...; ROLLBACK;` via the Management API first, confirm no errors, then apply for real. See any recent migration-adding session in git history for the exact curl pattern.
- **Testing pattern**: create a disposable Supabase user via the Admin API (`generate_link` returns an `email_otp`/`hashed_token` without sending real email), sign in via `verifyEmailOtp` in the browser console, exercise the feature, verify via direct SQL against the project, then delete the disposable user/data. Never test destructive flows against the real coach's account.
- **Timezone**: practice times must always be computed/displayed in the *team's* `timezone` column, not the browser's. Use `scheduledAtToTeamLocal`/`teamLocalToScheduledAt` in `supabase.js`, not raw `Date` methods.

## Recent session log (most recent first)

- **2026-07-09**: Practice Detail no longer offers "Run Now" on an unplanned practice (was leading to a blank screen after Attendance) — shows "Plan Practice" instead, "Run Now"/"Edit" only once a plan exists. Team color picker added to team *creation* (was edit-only); added black/dark-gray to the palette. Fixed Schedule tab's Agenda/Month toggle padding (was 0 top / 12px bottom, now uniform).
- **2026-07-09**: Built the full scheduling addendum — recurring series wizard + RPC, Home screen (replacing Today), Schedule tab (agenda/month), team colors, planned absences end-to-end into live-session attendance. Found and fixed two real bugs via empirical testing: an `upsert()` 403 (needed UPDATE grant it was never given), and a same-flow write race that silently discarded seeded absence data (attendance-snapshot submission was overwriting it moments later). Also fixed a real pre-existing gap: practice times were computed in the browser's timezone instead of the team's.
- **2026-07-09**: Auth UX fixes — OTP screen wrongly claimed "6-digit code" when the project sends 8; fixed a real duplicate-row bug (Save button had no working reentrancy guard — `useState` isn't synchronous enough for rapid clicks, needed `useRef`); fixed a blank-page bug after deleting a team (stale `selectedTeam` state).
- **2026-07-08**: Switched primary sign-in from magic link to Email OTP (magic links broke for the installed-PWA case), branded the auth email via Resend SMTP, added one-time name collection so the greeting shows a real name instead of the raw email.
- **2026-07-07**: Production cutover — merged `frontend-rewire` into `main`, pointed `runofpractice.com` at the new app, retired the old POC. Caught and fixed a real pre-cutover bug: Supabase `site_url`/redirect allow-list still pointed at localhost.
- **2026-07-07**: Post-launch feature round — helper attendance marking, account/team deactivation, structured focus areas, roster/upcoming-activities on the helper view, manual drill reordering. Found and fixed a real pre-existing RLS bug (`teams_select_access` ambiguous-column reference silently blocked non-owner coaches from ever seeing their team).
- **2026-07-06/07**: The full 7-stage rewire off the old POC data layer onto the current 35-table Supabase schema — auth, teams/roster, library (with org-sharing), templates/builder, live sessions, helper/preview anonymous pages, offline resilience/PWA polish.

---
*Maintained by Claude. Update this file at the end of any session that changes what's built, what's deferred, or how the codebase should be approached — don't let it go stale.*
