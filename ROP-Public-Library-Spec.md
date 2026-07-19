# Public Drill Library — Content Spec & Architecture

Status: **planning only** — nothing in this doc has been built or seeded yet.
Goal: seed a public, curated drill library for each sport, and make the
underlying architecture extend cleanly to the multi-library future (org
libraries, peer-shared libraries, third-party content-provider libraries)
instead of a one-off hack.

This doc has three parts:
1. What to hand to Claude Chat so it can generate the actual drill content.
2. The app/database changes needed to store and surface that content.
3. Navigation design for a world with more than one library to browse.

---

## 0. Two prerequisite fixes (do before generating content)

These aren't optional cleanup — they'll cause real problems if skipped.

### 0.1 The sport list is inconsistent across the app

Three different hardcoded sport lists currently exist:

| Location | List |
|---|---|
| `constants.js` `SPORTS`, `ModalLayer.jsx` top-level `SPORTS` (add team, add drill) | Basketball, Soccer, Baseball, Lacrosse, Football, Softball, Volleyball, Hockey, Tennis, Swimming, General, Other |
| `ModalLayer.jsx` edit-team dropdown (×2), `NewLibraryScreen.jsx` `TemplateWorkspace` | General, Baseball, Basketball, Football, Soccer, Softball, Volleyball, Other *(missing Lacrosse, Hockey, Tennis, Swimming)* |
| `SettingsScreen.jsx` locations/equipment sport pickers | General, Baseball, Basketball, Football, Soccer, Softball, Lacrosse, Hockey, Volleyball, Tennis, Swimming, Other |

A coach can't currently even set their team's sport to Lacrosse, Hockey,
Tennis, or Swimming from the edit-team screen, even though drills/library
support any sport as free text. **Recommendation:** pick one canonical list
and use it everywhere:

```
Baseball, Basketball, Football, Soccer, Softball, Volleyball, Lacrosse, Hockey, Tennis, Swimming, General, Other
```

I'll fix the three call sites to match once you confirm the list (or want a
different one — e.g. drop Tennis/Swimming if they're not real targets).

### 0.2 Skill categories only exist for Baseball and Basketball

`skill_categories` (the top-level taxonomy — Hitting, Fielding, Shooting,
etc.) is curated centrally, seeded via migration, and has **no app-writable
insert policy** — coaches can add tags under a category, but never a new
category. Today only Baseball (7 categories) and Basketball (7 categories)
have any. The other 8 sports have zero, which means:

- Public-library drills for those sports can't carry skill tags at all
  until categories exist for them (tags require a category).
- Claude Chat can't reliably invent this taxonomy itself — it's meant to
  stay tight and centrally controlled (the same category name, e.g. "Team
  Play," is intentionally reused across sports for cross-sport reporting).

**I'll seed the missing 8 sports' categories before content generation
starts**, using the same shape as the existing two (6-7 categories each,
`sort_order` set). Proposed starting taxonomy, for your review — trim/edit
freely, this is a first draft:

<details>
<summary>Proposed categories (Soccer, Football, Softball, Lacrosse, Hockey, Volleyball, Tennis, Swimming)</summary>

- **Soccer:** Passing, Shooting, Dribbling, Defending, Goalkeeping, Conditioning, Team Play
- **Football:** Passing, Receiving, Rushing, Blocking, Tackling, Conditioning, Team Play
- **Softball:** Hitting, Fielding, Pitching, Throwing, Baserunning, Conditioning, Team Play
- **Lacrosse:** Passing, Shooting, Dodging, Defending, Ground Balls, Conditioning, Team Play
- **Hockey:** Skating, Passing, Shooting, Stickhandling, Defending, Goaltending, Conditioning
- **Volleyball:** Serving, Passing, Setting, Hitting, Blocking, Conditioning, Team Play
- **Tennis:** Groundstrokes, Serving, Volleying, Footwork, Strategy, Conditioning
- **Swimming:** Stroke Technique, Starts, Turns, Endurance, Conditioning

</details>

Softball reuses Baseball's category *names* deliberately (same sport
family, same cross-sport reporting value) but gets its own `sport`-scoped
rows, same as Baseball/Basketball's independent "Team Play"/"Conditioning"
categories today.

---

## 1. Content requirements — what to send Claude Chat

### 1.1 Deliverable format

One JSON file per sport (not prose/Markdown for the drills themselves —
this needs to import mechanically without me hand-transcribing 150+
drills). Structure:

```json
{
  "sport": "Baseball",
  "drills": [
    {
      "name": "Ground Ball Fundamentals",
      "description": "Coach rolls firm grounders, alternating forehand and backhand. Field, footwork, throw to the bucket target.",
      "coachingPoints": "Fielding triangle: feet wide, glove out front. Right, left, throw. Work through the ball, never around it.",
      "duration": 10,
      "grouping": "whole",
      "numGroups": null,
      "skillTags": ["Fielding: Glove work / fundamentals", "Fielding: Footwork on ground balls"],
      "teamEquipment": ["Bucket of Balls"],
      "playerGear": []
    }
  ],
  "newTagProposals": []
}
```

### 1.2 Field-by-field spec

| Field | Type | Required | Notes |
|---|---|---|---|
| `name` | string | yes | Short, specific. "Ground Ball Fundamentals," not "Fielding Drill 1." No duplicate names within a sport. |
| `description` | string | yes | 1–2 sentences. What actually happens — the mechanics of the drill, not the goal. This is what a helper reads to run it cold. |
| `coachingPoints` | string | yes | 1 sentence, imperative, cue-based. What the coach says out loud. E.g. "Level swing, contact out front. Let the outside pitch travel." Not a restatement of the description. |
| `duration` | number (minutes) | yes | Realistic default length. Most drills 5–15 min; a few longer (scrimmage-style) up to 20. |
| `grouping` | `"whole"` \| `"partners"` \| `"groups"` | yes | `whole` = everyone together. `partners` = pairs. `groups` = split into `numGroups` groups. |
| `numGroups` | number \| null | only if `grouping:"groups"` | 2–6 typical. `null` otherwise. |
| `skillTags` | string[] | yes, at least 1 | Format `"Category: Tag Name"`, using **only** tags from the taxonomy provided (see §1.3). Don't invent a tag inline — use `newTagProposals` instead (§1.4). |
| `teamEquipment` | string[] | no (`[]` if none) | Shared gear the group uses (cones, a ball bucket, an L-screen). Plain names — these get created as new equipment assets on import if they don't already exist, so keep naming consistent within a sport (don't say "Cone" in one drill and "Cones" in another). |
| `playerGear` | string[] | no (`[]` if none) | Individual gear each player needs (a helmet, a glove). Same naming-consistency note as above. |

Fields intentionally **not** in this schema because they don't exist in the
app yet: age band, skill level/difficulty, video/image links. If you want
those, flag it — see §4 open questions.

### 1.3 Skill tag taxonomy Claude Chat must use

Treat this list as closed per sport — pick from it, don't rename entries
(the string must match exactly, including punctuation like `/`), and don't
add a tag under a category that isn't listed. The 8 sports without a
taxonomy yet are blocked until §0.2 is seeded; only Baseball and Basketball
are unblocked today.

**Baseball** (category order: Hitting, Fielding, Pitching, Throwing,
Baserunning, Conditioning, Team Play)

```
Hitting: Bat path
Hitting: Timing / pitch recognition
Hitting: Contact to all fields
Hitting: Two-strike approach

Fielding: Glove work / fundamentals
Fielding: First-step reads
Fielding: Footwork on ground balls
Fielding: Pop-up communication

Pitching: Mechanics / delivery
Pitching: Command
Pitching: Pitch mix
Pitching: Pickoff moves

Throwing: Arm action
Throwing: Accuracy
Throwing: Crow hops / transfers
Throwing: Long toss

Baserunning: Leads and reads
Baserunning: First-to-third
Baserunning: Sliding technique
Baserunning: Stealing bags

Conditioning: Speed / sprint work
Conditioning: Agility
Conditioning: Strength
Conditioning: Endurance

Team Play: Cutoffs and relays
Team Play: Situational awareness
Team Play: Communication
Team Play: Bunt defense
```

**Basketball** (category order: Shooting, Ball Handling, Passing, Defense,
Rebounding, Conditioning, Team Play)

```
Shooting: Form / mechanics
Shooting: Catch-and-shoot
Shooting: Off the dribble
Shooting: Free throws

Ball Handling: Dribble control
Ball Handling: Change of direction
Ball Handling: Weak-hand development
Ball Handling: Pressure handling

Passing: Chest / bounce pass
Passing: Court vision
Passing: Passing off the dribble
Passing: Entry passes

Defense: On-ball defense
Defense: Help defense
Defense: Closeouts
Defense: Screen navigation

Rebounding: Boxing out
Rebounding: Positioning
Rebounding: Put-backs
Rebounding: Long rebounds

Conditioning: Speed / sprint work
Conditioning: Agility
Conditioning: Strength
Conditioning: Endurance

Team Play: Spacing
Team Play: Ball movement
Team Play: Transition offense
Team Play: Communication
```

Source: `supabase/migrations/20260711000000_seed_default_skill_tags.sql`.
These are currently seeded as `scope: 'coach'` rows (a private copy per
coach), not `scope: 'global'` — the names are canonical and stable, but I
still need to create real `global`-scope rows with these names as part of
the §2.6 import (same step that seeds tags for the other 8 sports).

### 1.4 If a needed tag doesn't exist

Don't invent a `skillTags` string that isn't in the taxonomy. Instead, add
it to the drill's own note (temporarily skip the tag) and list it in the
file-level `newTagProposals` array:

```json
"newTagProposals": [
  { "category": "Fielding", "name": "Double play turns" }
]
```

I'll review these, seed the ones that make sense as real global tags, and
do a second pass to attach them — keeps the taxonomy from silently
sprawling with near-duplicate tags across 12 sport files generated in
parallel.

### 1.5 Volume and coverage

Roughly **15–25 drills per sport**, spread so every skill category has at
least 2–3 drills under it (a category with zero drills is a category a
coach can't build a session around). Mix of `grouping` values — don't make
everything `"whole"`; stations/partner work is a core feature this library
should show off.

### 1.6 Voice/style — match the app's existing tone

The seeded demo content is the style bar. Terse, concrete, no filler:

> **Ball Handling** — "Dribbling fundamentals" / "Eyes up, stay low"
> **Shooting Form** — "Form shooting from close range" / "BEEF - Balance, Eyes, Elbow, Follow through"

Avoid generic descriptions ("players work on their shooting") — a coach or
helper should be able to run the drill from the card alone, no outside
knowledge assumed.

### 1.7 Things to explicitly tell Claude Chat NOT to do

- Don't invent sports outside the confirmed list (§0.1).
- Don't invent skill categories — only tags, and only via `newTagProposals`
  when the existing list doesn't cover it (§1.4).
- Don't put player names, specific ages, or anything that reads as
  personalized coaching — this is generic library content, copied into
  each coach's own library on demand.
- Don't duplicate a drill under a slightly different name — dedupe within
  a sport file.

---

## 2. Architecture changes

### 2.1 The schema already has a hook for this

`activity_library.source_catalog_id` exists today (added in the original
schema migration) with the comment *"nullable lineage hook for chunk 6
curated catalogs; unused until then."* This was planned for, not
retrofitted — good news, less risk.

### 2.2 New table: `content_catalogs`

```sql
create table public.content_catalogs (
  id uuid primary key default gen_random_uuid(),
  name text not null,                    -- "Run of Practice: Baseball Fundamentals"
  sport text not null,
  publisher_name text not null,          -- "Run of Practice", an org name, a coach's name
  publisher_type text not null check (publisher_type in ('system', 'org', 'coach', 'provider')),
  visibility text not null check (visibility in ('public', 'private')),
  description text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  archived_at timestamptz
);
```

One catalog per sport to start (`publisher_type: 'system'`), but the shape
already supports an org publishing their own catalog, or (later) a coach
packaging their library as a shareable one — no redesign needed when that
day comes, just more rows.

### 2.3 Who owns the seeded rows

`activity_library` and `assets` both require an `owner_user_id` or
`organization_id` (existing `activity_has_owner` / `asset_has_owner`
constraints) — I won't relax those. Instead: create one real `profiles`
row for a system publisher account (e.g. `content@runofpractice.com`),
and every catalog-sourced drill/asset gets `owner_user_id` set to that
account. This gives real, visible attribution ("Published by Run of
Practice") for free, using an existing column, no constraint changes.

### 2.4 Visibility (RLS)

Two additive policy changes, both narrowly scoped to avoid touching the
existing org-sharing logic:

- **`activity_library_select_access`**: OR in a branch —
  `source_catalog_id is not null and exists (select 1 from content_catalogs c where c.id = source_catalog_id and c.visibility = 'public')`.
- **`assets_select_access`**: same shape, mirroring the existing
  shared-drill-equipment `exists (...)` branches already in that policy
  (added in the library-sharing migration) — so equipment names render
  while browsing a public drill, same as browsing an org-shared one does
  today.

`skill_tags` need **no changes** — public-catalog drills use `scope:
'global'` tags, which are already visible to every signed-in coach.

### 2.5 Copying into your own library

`copyDrillToMyLibrary` already exists and already does almost exactly the
right thing: creates a fresh coach-owned drill row, and for each piece of
equipment either matches an existing asset by name or creates a new one in
the coach's own library. **One change needed**: it currently skips copying
tags entirely (comment: coach/org-scoped tags "never transfer" or would be
"meaningless" outside their context) — true for those scopes, but not for
`scope: 'global'` tags, which mean the same thing to every coach. Add a
branch: if a source tag is `scope: 'global'`, copy the association;
otherwise skip, as today.

### 2.6 Import pipeline

Once Claude Chat's JSON comes back:
1. I review it (spot-check tag usage, dedupe, sanity-check durations).
2. I resolve `newTagProposals`, seed any approved ones as real `global`
   skill_tags.
3. A one-time import script (Node, using the service-role key, run once
   per sport file) creates the `content_catalogs` row, then each drill via
   the same `createDrill`-equivalent logic but attributed to the system
   profile with `source_catalog_id` set, resolving `skillTags`/
   `teamEquipment`/`playerGear` strings to real IDs (creating
   system-owned equipment assets as needed).
4. Spot-check in the Explore tab before calling a sport "live."

---

## 3. Navigation for multiple libraries

Today's Explore tab (`NewLibraryScreen.jsx`) already has the right shape
for the near term: a horizontal row of "shelves" (`My Library`, one shelf
per org you belong to, "shared by" shelf per org), each showing a filtered
drill list with a skill-tag filter. Adding public catalogs as more shelves
in that same array is the natural Phase 1 move — minimal new UI, and it's
a pattern coaches will already understand from org libraries.

**Phase 1 (this project):** each sport's public catalog becomes a shelf,
labeled with a small "Official" or publisher badge so it reads as
distinct from a peer's personal library. Shown regardless of which org(s)
a coach belongs to (public = public). Tapping a drill offers "Copy to My
Library" exactly like org-shared drills do today.

**Phase 2 (once shelf count grows past a handful):** the flat horizontal
pill-scroller stops scaling once there are a dozen+ libraries (multiple
sports × system catalogs + orgs + eventually peer-shared + content
providers). At that point, restructure Explore into two levels: a
**"Browse Libraries"** grid (name, publisher, sport, drill count, small
icon) you tap into, landing on that one library's filtered drill list —
same drill-list UI as today, just reached through a library picker instead
of an ever-growing tab row. This also gives a natural home for
library-level metadata (publisher description, "12 drills across 5
categories") that doesn't fit in a tab label.

**Phase 3 (later, not this project):** coach- and org-authored *shareable*
catalogs — a coach packages some of their own library as a named,
publishable set (`publisher_type: 'coach'`), visible either publicly or to
an org. The schema in §2.2 already supports this without redesign; it's a
UI-only addition (a "Publish as Catalog" action from My Library) whenever
you want it.

---

## 4. Open questions for you

1. **Sport list** — confirm the canonical 12-sport list in §0.1, or trim
   it (drop Tennis/Swimming?) before I fix the three inconsistent
   dropdowns.
2. **Proposed taxonomy** — sanity-check the 8-sport category list in §0.2
   before I seed it. Softball reuses Baseball's category names on purpose;
   flag if you want it fully independent instead.
3. **Volume** — is 15–25 drills/sport the right target, or do you want a
   deeper first pass on 2–3 flagship sports (Baseball, Basketball, Soccer)
   and a lighter pass elsewhere?
4. **System publisher identity** — okay to create a real
   `content@runofpractice.com`-style account for this (§2.3), or do you
   want catalog content attributed differently (e.g. under your own
   account, or a plain "Run of Practice" label with no real profile
   behind it — which would need a small constraint change instead)?
5. **Fields not in the schema today** (age band, skill level, media) —
   worth adding now, or defer until there's a real reason a coach needs to
   filter/see them?

---

## 5. Suggested sequencing

1. You confirm §4.
2. I fix the sport-list inconsistency and seed the 8 missing sports'
   skill categories (and default global tags, mirroring the existing
   Baseball/Basketball seed).
3. I hand you the finalized taxonomy to include in what you send Claude
   Chat, plus this doc's §1 as the content brief.
4. Claude Chat generates the JSON, sport by sport.
5. I build `content_catalogs` + the RLS/copy changes in §2, write the
   import script, run it per sport as content arrives, and add the
   Phase 1 Explore-tab shelves from §3.
