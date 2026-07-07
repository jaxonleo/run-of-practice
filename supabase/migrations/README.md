# Chunk 1 + Chunk 2 + Chunk 3 — Core, Library, Practice Layers

## Status
Chunks 1 (0001–0009) and 2 (0010–0017) confirmed applied and live. Chunk 3
(0018–0026) is new, not yet applied.

## What's here
Migration files, meant to run in filename order (they're already timestamp-prefixed
so `supabase db push` will apply them correctly):

### Chunk 1 (applied)

1. `extensions` — pgcrypto for `gen_random_uuid()`
2. `profiles` — 1:1 with `auth.users`, auto-created via trigger on signup
3. `organizations` — top-level org, optional at launch
4. `organization_members` — org roles (owner/admin/coach/viewer); creator auto-added as owner via trigger
5. `teams` — season fields (sport, season_label, start/end date, timezone), `organization_id` nullable for personal teams
6. `team_staff` — coaches/assistants/helpers, split from the player roster (per your call)
7. `players` — roster, `positions` as a text array, `user_id` nullable for future player logins
8. `rls_functions` — `can_access_team`, `can_manage_team`, `is_org_member`, `is_org_admin`
9. `rls_policies` — RLS enabled on every table above; no DELETE policy anywhere (archive via `archived_at`, never hard-delete through the app)

### Chunk 2 (applied)
10. `assets` — equipment/player gear, hard sport-scoped, owned by a coach or an org (never a team)
11. `skill_categories` — global, curated, sport-scoped top-level taxonomy (Hitting, Fielding, etc). No app-level insert — Jax seeds these directly.
12. `skill_tags` — hybrid scope: `global` (curated), `org` (org_admin-managed), `coach` (private subtags, never shared even within an org)
13. `activity_library` — reusable drills, owned by coach or org; org-owned drills only insertable by org admins
14. `activity_library_equipment` — join table linking a drill to its assets (team equipment + player gear, same table, filtered by `assets.type`)
15. `drill_tags` — join table linking a drill to `skill_tags`
16. `rls_functions_chunk2` — `can_access_owned`, `can_manage_owned`, `can_access_activity`, `can_manage_activity`, `can_link_asset_to_activity`, `can_link_tag_to_activity` (generic, reusable across assets/library/tags)
17. `rls_policies_chunk2` — RLS + policies for all of the above; join tables (14, 15) get real DELETE policies since removing an association isn't the same as destroying practice history

### Chunk 3 (new — needs `supabase db push`)
18. `locations` — locations + sublocations, same coach-or-org ownership pattern as assets
19. `templates` — reusable practice plans, coach-personal or org-shared (org-admin managed)
20. `template_activities` — activities within a template, + equipment slots that are either a concrete asset or an abstract requirement, never both
21. `template_stations` — station-block structure within a template (blocks + stations + their equipment), same concrete-or-abstract equipment shape
22. `practices` — real instances for a specific team/roster; status draft/scheduled/completed
23. `practice_activities` — full copies of drill fields at the moment they're added to a practice, plus equipment (always concrete here — no abstract slots on a real practice)
24. `stations` — station_blocks + stations + station_equipment for real practices
25. `rls_functions_chunk3` — ownership lookups chained through templates/practices/stations, plus asset-compatibility checks for template and practice equipment
26. `rls_policies_chunk3` — RLS + policies for all of the above

## How to apply
Same workflow as chunks 1 and 2:

```bash
cd "/Users/jaxonleo/Desktop/Run of Practice/rop"
export PATH="$HOME/.nvm/versions/node/v24.17.0/bin:$PATH"
# copy the chunk 3 files (0018-0026) into supabase/migrations/
npx supabase db push --dry-run   # check the filename list
grep -c "can_link_asset_to_practice_activity" supabase/migrations/20260704002700_rls_functions_chunk3.sql  # confirm content, not just filenames
npx supabase db push
```

## Manual steps NOT covered by SQL
- **Auth settings** (Supabase dashboard → Authentication → URL Configuration): set Site URL
  and Redirect URLs for magic link emails to point at `run-of-practice.vercel.app` (and
  `localhost` for dev).
- **Email templates** for the magic link, if you want them branded beyond Supabase defaults.
- **Old POC tables** (`app_data`, `live_sessions`, `coaches`) are untouched by these
  migrations. Nothing here drops them — that's a deliberate separate decision for you to
  make once the new schema is live and you're ready to cut over.

## Design notes / things worth double-checking against how you actually coach
- `teams.timezone` has **no default** on purpose — I didn't want to bake in a guess (e.g.
  defaulting everyone to one region). The frontend should set it from the browser at team
  creation time.
- `team_staff` stores `first_name`/`last_name` directly (not just via `profiles`) so an
  assistant coach can exist on a roster before they've ever signed up, and so nobody
  needs cross-user profile read access to show a staff list.
- Multi-coach **control handoff** for live sessions (the thing you confirmed you need) is
  intentionally *not* in this chunk — it belongs on `live_sessions` in chunk 4. Flagging so
  it doesn't get lost: plan is a `controller_user_id` + version counter, with a "take
  control" action that bumps the version and causes stale writes from the old controller
  to be rejected.
- Also flagged for later: the anonymous `/live/:id` helper link you already spec'd
  effectively *is* the "let a prospect stream the live practice on their phone" demo
  capability, once chunk 4 lands. No separate demo-account plumbing needed for that.
- **Chunk 2:** `player_gear` is not a separate free-text column on `activity_library`,
  unlike the original target schema listing — it's the same `assets` table as team
  equipment, differentiated by `assets.type`, linked via `activity_library_equipment`.
  One picker mechanism, two contexts.
- **Chunk 2:** org-scoped rows on `assets`, `activity_library`, and `skill_tags` (scope
  `'org'`) are only insertable by an org admin/owner (`can_manage_owned`), never by any
  org member — keeps shared libraries curated rather than turning into the same noise a
  personal library would have.
- **Chunk 2:** both `activity_library_equipment` and `drill_tags` inserts are checked
  against compatibility functions (`can_link_asset_to_activity`, `can_link_tag_to_activity`),
  not just `can_manage_activity` — an org-owned drill can only link assets/tags from that
  *same* org or global ones (never a personal asset, never someone's private tag); a
  personal drill can link the coach's own assets/tags or anything from an org they belong
  to. Enforced in the RLS policies themselves, not just a UI convention — I initially
  fixed this for equipment and missed the identical issue on tags in the same pass, so
  flagging that I had to go back and catch it, not just that it's handled.
- **Chunk 2:** `skill_categories` and global `skill_tags` have no INSERT policy at all —
  they're only writable via the Supabase service role / SQL editor, i.e. you seed and
  curate them directly, not through the app.
- **Chunk 3:** no separate `equipment_links` table. Each equipment slot on a template is
  either a concrete asset or an abstract description ("6 cones"), never both, and never a
  persisted resolution mapping — pulling from an org template with abstract slots means
  resolving fresh every time (chunk 6 builds the actual resolution screen), forever, unless
  a coach copies the template into their own library and edits it to point at concrete
  assets directly.
- **Chunk 3:** practice/station equipment is always concrete (no abstract branch) — by the
  time something's attached to a real practice, it's inherently resolved regardless of
  where it came from.
- **Chunk 3, known limitation, not solved:** a personal team (no organization) with more
  than one staff member has no shared equipment pool — assets only belong to a coach or an
  org, never a team. If one coach on such a team attaches their own personal asset to a
  practice, a co-coach without a shared org can't see that asset's details. Narrow edge
  case (multi-staff personal teams without an org), flagged rather than fixed, since a real
  fix means revisiting "assets never belong to a team."
