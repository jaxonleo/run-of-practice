# ROP Public Drill Library: Seed Expansion Spec

**For:** Claude Cowork, generating drill data for Run of Practice (runofpractice.com)
**Goal:** expand the public drill library to roughly **15 drills per global skill category**, for all 6 sports: Baseball, Basketball, Football, Lacrosse, Soccer, Volleyball.
**You are producing data files only.** JSON, one per sport, in the exact shape described below. You are not touching the database or writing code. A human will run an existing import script against staging, verify it, then production.

---

## 0. Terminology (read this first)

Two different things in this app are both called "skill tags," and mixing them up is exactly what caused the last round of confusion. Use these terms precisely:

- **Global skill category** (table `skill_categories`): the coarse, top-level taxonomy. Exactly **7 per sport**, curated, never coach-editable. Example for Baseball: `Hitting`, `Fielding`, `Pitching`, `Throwing`, `Baserunning`, `Conditioning`, `Team Play`.
- **Skill tag** / **sub-tag** (table `skill_tags`): the finer-grained tag underneath a category. There are **4 global sub-tags per category** today (any coach can also add their own private ones, but that's irrelevant here since you're only using the existing global sub-tags). Example under Baseball's `Hitting`: `Bat path`, `Timing / pitch recognition`, `Contact to all fields`, `Two-strike approach`.

**"~15 drills per global skill category"** means: for each of a sport's 7 categories, roughly 15 drills should carry at least one sub-tag from that category. A drill that carries sub-tags from two different categories counts toward both. That's fine and expected (see §5).

---

## 1. Drill selection: use proven, real-world drills, not invented ones

This is the part that matters most, so it comes before the format details.

For each category, research and identify drills that are genuinely used and well-regarded in that sport's coaching community, not drills invented from scratch to plausibly fill a slot. Draw on real sources: published practice plans and coaching curricula from recognized governing bodies (USA Baseball, USA Basketball, USA Football, US Lacrosse/USA Lacrosse, US Youth Soccer, USA Volleyball, and equivalents), well-known college and professional programs' publicly shared training content, respected coaching books and clinics, and widely cited coach educators. The goal is that when a coach opens this library, the drills feel familiar: things they've seen run at a camp, read about from a program they respect, or recognize by name.

A few working rules:

- Do the research per sport and per category before drafting, so the ~15 drills in a category actually reflect what's proven and popular, not just internally consistent variations on a theme.
- Write every drill in your own words, in the house style in §7. Adapting a well-known drill's structure and purpose into this format is the goal. Don't quote or closely paraphrase a source's exact wording.
- When a drill is a widely recognized named drill (a name coaches would recognize across many programs, like a wall-ball progression or a shell drill), keep a close variant of that common name rather than renaming it into something generic.
- The output JSON has no field for citing a source, so don't add one. The point is real coaching pedigree behind each pick, not a paper trail in the data.
- If research turns up fewer than 15 well-established drills for a category, say so honestly in your reply rather than padding the count with weaker filler. A category landing at 11 or 12 genuinely good drills is a better outcome than 15 where a third are invented to hit the number.

---

## 2. Output format: one JSON file per sport

File naming: `ROP-Public-Library-<Sport>.json` (e.g. `ROP-Public-Library-Baseball.json`), the same filenames that already exist at the repo root today. Your output should be a complete replacement for each file (not a diff/patch), containing every drill that should exist for that sport once you're done. Reuse or rewrite the sport's current drills where they still earn their place, and add new ones to close the gap in §4.

Top-level shape (unchanged from today):

```json
{
  "sport": "Baseball",
  "drills": [ /* array of drill objects, see below */ ],
  "newTagProposals": []
}
```

Leave `newTagProposals` as an empty array. See §3's hard rule about not inventing new tags.

### Drill object: every field, exact meaning

```json
{
  "name": "Tee Work: Bat Path",
  "description": "Hitters rotate through tee stations into a net: middle tee, inside tee moved up, outside tee moved back. Five swings per station.",
  "coachingPoints": "Short to the ball, long through it. Match the tee depth to the pitch location.",
  "duration": 12,
  "grouping": "groups",
  "numGroups": 3,
  "skillTags": ["Hitting: Bat path"],
  "teamEquipment": ["Batting Tees", "Bucket of Balls", "Hitting Net"],
  "playerGear": ["Bat", "Batting Helmet"]
}
```

| Field | Type | Notes |
|---|---|---|
| `name` | string | Must be unique within the sport's file. The import is an upsert keyed on `(catalog, name)`, so a name collision silently overwrites instead of adding a new drill. |
| `description` | string | What the drill is and how it runs. 1 to 3 sentences, concrete (formations, reps, rotation), no fluff. |
| `coachingPoints` | string | 1 to 2 short coaching cues, the kind a coach would actually shout mid-drill. Terse, imperative, sport-authentic voice. See the house style examples in §7. |
| `duration` | number (minutes) | Realistic for the drill as written. Most existing drills run 8 to 15. |
| `grouping` | `"whole"` \| `"partners"` \| `"groups"` | How players are organized: whole team together, paired up, or split into groups. |
| `numGroups` | number \| `null` | **Required (a number) when `grouping==="groups"`, must be `null` otherwise.** |
| `skillTags` | string array, 1+ entries | Each entry is the exact string `"<Category>: <Sub-tag name>"` from the canonical list in §5. **This is the field that determines which global category(ies) the drill counts toward.** See §3's hard rule. |
| `teamEquipment` | string array, can be empty | Shared/team gear the drill needs (balls, cones, nets, etc). Reuse existing names where they fit. See §6. |
| `playerGear` | string array, can be empty | Gear each player individually needs or wears (bat, helmet, gloves, etc). Same reuse guidance as `teamEquipment`. |

---

## 3. Hard rule: use only the exact sub-tag strings listed below

The import script resolves each `skillTags` string by looking up `skill_categories` by `(sport, category name)` and then `skill_tags` by `(category_id, sub-tag name, scope='global')`. **If a string doesn't match one of the sub-tags in §5 exactly, case and punctuation included, the import silently drops that tag on that drill.** It does not error, and it does not create a new tag. So:

- Do not invent new sub-tags, even ones that seem obviously missing. If a category is genuinely missing an important sub-tag, note it separately in your reply to the human rather than putting it in `skillTags`. It can be added to the taxonomy deliberately later.
- Match capitalization and punctuation exactly as written in §5 (e.g. `"Ball Handling: Change of direction"`, not `"ball handling: change of direction"` or `"Change of Direction"`).
- A drill needs **at least one** valid `skillTags` entry. An untagged drill won't count toward any category's target and will show up in the app's "Untagged" bucket, which defeats the point of this exercise. Most drills should carry 1 to 2 tags; 2 tags from *different* categories is a good way to build coverage efficiently (a drill that's genuinely both a Fielding and a Team Play drill should carry both), but don't force a tag that doesn't really fit just to pad a count.

---

## 4. Current gap: what "~15 per category" means concretely

Every sport already has a seed file with 20 drills, but coverage per category is thin (2 to 5 drills each, since most existing drills carry only one tag). Counts below are drills touching that category today (a multi-tagged drill counts once per category it touches):

**Baseball** (20 drills total): Hitting 4, Fielding 3, Pitching 3, Throwing 3, Baserunning 4, Conditioning 2, Team Play 4
**Basketball** (20 drills total): Shooting 4, Ball Handling 3, Passing 4, Defense 5, Rebounding 3, Conditioning 4, Team Play 4
**Football** (20 drills total): Passing 4, Receiving 4, Rushing 4, Blocking 3, Tackling 4, Conditioning 3, Team Play 2
**Lacrosse** (20 drills total): Passing 5, Shooting 4, Dodging 4, Defending 4, Ground Balls 3, Conditioning 3, Team Play 5
**Soccer** (20 drills total): Passing 5, Shooting 4, Dribbling 4, Defending 4, Goalkeeping 2, Conditioning 4, Team Play 4
**Volleyball** (20 drills total): Serving 3, Passing 4, Setting 3, Hitting 4, Blocking 4, Conditioning 5, Team Play 4

Target: every category above reaches ~15 (see §1 for what "reaches ~15" should mean in practice, real drills first, not a hard quota). That's roughly 85 to 100 net new or rewritten drills per sport, 550 to 600 total across all 6 sports, which is why this is being done as a batch rather than by hand. Within each category, aim for real variety: different formats (partner reps, station rotations, small-group competitions, whole-team reps), different skill sub-tags represented (all 4 of a category's sub-tags should show up across its ~15 drills, not just 1 or 2 of them), and no near-duplicates of an existing drill.

---

## 5. Canonical taxonomy: the only valid category/sub-tag strings

Verified directly against production on 2026-09-14 (a prior data-duplication bug in `skill_categories` for Football, Lacrosse, Soccer, and Volleyball was found and fixed the same day; these lists are the clean, canonical taxonomy after that fix). Each sport has exactly 7 categories in this sort order, each with exactly 4 sub-tags. Build every `skillTags` string as `"<Category>: <Sub-tag>"` from these tables verbatim.

### Baseball
| Category | Sub-tags |
|---|---|
| Hitting | Bat path · Timing / pitch recognition · Contact to all fields · Two-strike approach |
| Fielding | Glove work / fundamentals · First-step reads · Footwork on ground balls · Pop-up communication |
| Pitching | Mechanics / delivery · Command · Pitch mix · Pickoff moves |
| Throwing | Arm action · Accuracy · Crow hops / transfers · Long toss |
| Baserunning | Leads and reads · First-to-third · Sliding technique · Stealing bags |
| Conditioning | Speed / sprint work · Agility · Strength · Endurance |
| Team Play | Cutoffs and relays · Situational awareness · Communication · Bunt defense |

### Basketball
| Category | Sub-tags |
|---|---|
| Shooting | Form / mechanics · Catch-and-shoot · Off the dribble · Free throws |
| Ball Handling | Dribble control · Change of direction · Weak-hand development · Pressure handling |
| Passing | Chest / bounce pass · Court vision · Passing off the dribble · Entry passes |
| Defense | On-ball defense · Help defense · Closeouts · Screen navigation |
| Rebounding | Boxing out · Positioning · Put-backs · Long rebounds |
| Conditioning | Speed / sprint work · Agility · Strength · Endurance |
| Team Play | Spacing · Ball movement · Transition offense · Communication |

### Football
| Category | Sub-tags |
|---|---|
| Passing | Throwing mechanics · Footwork & drops · Throwing on the move · Reading coverage |
| Receiving | Catching fundamentals · Route running · Contested catches · Releases & separation |
| Rushing | Ball security · Vision & cuts · Handoff exchange · Open-field running |
| Blocking | Stance & first step · Hand placement · Drive blocking · Pass protection |
| Tackling | Form tackling · Pursuit angles · Wrap & drive · Open-field tackling |
| Conditioning | Speed & acceleration · Agility & change of direction · Explosiveness · Endurance |
| Team Play | Play execution · Situational football · Communication · Special teams basics |

### Lacrosse
| Category | Sub-tags |
|---|---|
| Passing | Stationary passing & catching · Passing on the run · Quick stick · Off-hand development |
| Shooting | Shooting on the run · Time & room shooting · Shot placement · Crease finishing |
| Dodging | Split dodge · Roll dodge · Dodging from X · Change of pace |
| Defending | Approach & breakdown footwork · Stick checks · Body positioning · Slides & recovery |
| Ground Balls | Scooping technique · Contested ground balls · Ground ball to fast break · Boxing out |
| Conditioning | Speed & agility · Acceleration · Endurance · Transition running |
| Team Play | Fast break offense · Clearing · Off-ball movement · Man-up / man-down basics |

### Soccer
| Category | Sub-tags |
|---|---|
| Passing | Short passing accuracy · Receiving / first touch · Long balls & switching play · Passing under pressure |
| Shooting | Finishing technique · Shooting off the dribble · Volleys & first-time finishes · 1v1 vs goalkeeper |
| Dribbling | Close control · Change of direction / moves · Speed dribbling · Shielding the ball |
| Defending | 1v1 defending · Pressing & angles · Tackling technique · Defensive shape |
| Goalkeeping | Handling & catching · Footwork & positioning · Shot stopping · Distribution |
| Conditioning | Speed & agility · Acceleration · Endurance · Small-sided fitness |
| Team Play | Possession play · Small-sided games · Transition play · Combination play |

### Volleyball
| Category | Sub-tags |
|---|---|
| Serving | Serve mechanics · Serve placement · Serving under pressure · Short & deep variation |
| Passing | Forearm platform · Serve receive · Passing footwork · Free-ball passing |
| Setting | Hand shape & contact · Setter footwork · Out-of-system setting · Setter decision-making |
| Hitting | Approach footwork · Arm swing mechanics · Hitting off a live set · Tips & shot placement |
| Blocking | Block footwork · Hand position & penetration · Reading the hitter · Transition off the block |
| Conditioning | Speed & agility · Jumping & explosiveness · Court movement endurance · Quick reactions |
| Team Play | Serve receive rotations · Defense & coverage · Transition offense · Communication |

(Note: Goalkeeping only applies to Soccer. Every other sport's category list is sport-specific as shown; don't cross-apply a category name from one sport's table to another.)

---

## 6. Equipment/gear vocabulary: reuse, don't fragment

`teamEquipment`/`playerGear` names that don't already exist get auto-created as new equipment assets on import. Reusing an existing name keeps the equipment list clean; inventing near-duplicates (`"Ball Bucket"` next to `"Bucket of Balls"`) creates clutter. Prefer these existing names when they fit, and only introduce a new one when the drill genuinely needs something not on this list:

- **Baseball**: team: Batting Tees, Bucket of Balls, Cones, Fungo Bat, Hitting Net, L-Screen, Sliding Mat, Throw-Down Bases. player: Bat, Batting Helmet, Catcher's Gear.
- **Basketball**: team: Basketballs, Cones, Pinnies. player: none yet.
- **Football**: team: Agility Ladder, Blocking Pads, Cones, Footballs, Pinnies, Tackle Bags. player: Helmet, Shoulder Pads.
- **Lacrosse**: team: Cones, Goals, Lacrosse Balls, Pinnies, Rebounder, Shooting Targets. player: Gloves, Helmet, Lacrosse Stick.
- **Soccer**: team: Cones, Pinnies, Portable Goals, Soccer Balls. player: Goalkeeper Gloves.
- **Volleyball**: team: Cones, Net, Volleyballs. player: none yet.

---

## 7. Style / voice: match the existing house style

Terse, concrete, coach-to-coach, not a textbook. Two real examples from the current Baseball file:

> **First-Step Reads off the Bat**: *"Fielders at their positions; coach hits live fungos in any direction. Players read contact and take only their first three steps at full speed, then reset."* Coaching points: *"Read the angle of the bat, not the flight of the ball. Your first step decides the play."*

> **Bullpen Command Grid**: *"Catcher splits the zone into four quadrants; pitcher throws a 20-pitch pen calling the quadrant before each pitch. Score a point per hit target."* Coaching points: *"Commit to the quadrant before you lift your leg. Aim small, miss small."*

Every drill should read like that: a specific setup and mechanic in `description`, a punchy cue or two in `coachingPoints`. Avoid generic filler like "improves footwork and awareness." Say what actually happens.

**No em dashes.** Don't use the em dash character anywhere in `name`, `description`, or `coachingPoints`. Break the sentence instead, or use a comma, a colon, or "and." For example, write "Coach rolls firm grounders. Alternate forehand and backhand." rather than joining the two halves with a dash. Hyphens inside words (three-step, first-to-third) are fine. It's the standalone dash used as punctuation that should go, since it reads more like written prose than something a coach would actually say out loud.

---

## 8. What happens after you deliver the files

Not your job to execute, just context: a human runs the existing `scripts/import-public-library.mjs` against **staging first**, spot-checks the result in the app's Library, Public Library tab, and the "By skill category" grouping view, then re-runs it against production. That script already does upsert-by-name (safe to re-run) and auto-creates any new equipment/gear names it encounters. The only failure mode on the human's side is a `skillTags` string that doesn't resolve (§3): it warns per-drill and just skips that tag, so double-check your strings against §5 before delivering.

Deliver: 6 files, `ROP-Public-Library-Baseball.json`, `Basketball`, `Football`, `Lacrosse`, `Soccer`, `Volleyball`, each matching §2's schema, each sport's categories at ~15 real, well-sourced drills apiece per §1/§4.
