// Pre-import validator for the 6 public drill library JSON files
// (ROP-Public-Drills-Seed-Spec.md). Run this BEFORE
// scripts/import-public-library.mjs.
//
// The reason this exists: resolveTag() in the import script silently skips a
// skillTags string it can't resolve -- it warns per drill and moves on, it
// does not error and it does not create the tag. A single typo therefore
// produces a drill that imports "successfully" and then sits in the app's
// Untagged bucket, which is only noticeable by eye in the Library UI. This
// script resolves every tag the same way the importer does, but against the
// migrations rather than the database, and fails loudly instead.
//
// Taxonomy is parsed out of the seed migrations rather than retyped, so it
// cannot drift from what's actually in the database:
//   20260707090000_seed_skill_categories.sql          (Baseball/Basketball categories)
//   20260718040000_seed_public_library_taxonomy.sql   (other 4 sports' categories + all global tags)
//   20260914010000_public_library_subtag_gaps.sql     (later added sub-tags)
// Add any future tag-seeding migration to TAG_MIGRATIONS below.
//
// Usage: node scripts/validate-public-library.mjs
// Exits non-zero if any file has an error, so it can gate a deploy step.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const MIG = join(ROOT, 'supabase', 'migrations')
const SPORTS = ['Baseball', 'Basketball', 'Football', 'Lacrosse', 'Soccer', 'Volleyball']
const CATEGORY_MIGRATIONS = ['20260707090000_seed_skill_categories.sql', '20260718040000_seed_public_library_taxonomy.sql']
const TAG_MIGRATIONS = ['20260718040000_seed_public_library_taxonomy.sql', '20260914010000_public_library_subtag_gaps.sql']
const GROUPINGS = ['whole', 'partners', 'groups']
const FIELDS = ['name', 'description', 'coachingPoints', 'duration', 'grouping', 'numGroups', 'skillTags', 'teamEquipment', 'playerGear']
const TARGET_PER_CATEGORY = 15

// Strip -- comments first: the migrations' prose contains apostrophes that
// would otherwise look like SQL string literals to the tuple regex below.
const body = f => readFileSync(join(MIG, f), 'utf8').split('\n').map(l => l.replace(/--.*$/, '')).join('\n')

function loadTaxonomy() {
  const categories = {}
  for (const f of CATEGORY_MIGRATIONS) {
    const blk = body(f).split('insert into public.skill_categories')[1]?.split(';')[0]
    if (!blk) continue
    for (const [, sport, name, order] of blk.matchAll(/\('([^']+)',\s*'([^']+)',\s*(\d+)\)/g)) {
      ;(categories[sport] ||= new Map()).set(name, Number(order))
    }
  }
  const tags = {}
  for (const f of TAG_MIGRATIONS) {
    const blk = body(f).split('insert into public.skill_tags')[1]
    if (!blk) continue
    for (const [, sport, category, tag] of blk.matchAll(/\('([^']+)',\s*'([^']+)',\s*'([^']+)'\)/g)) {
      ;((tags[sport] ||= {})[category] ||= []).push(tag)
    }
  }
  const out = {}
  for (const sport of Object.keys(categories)) {
    const ordered = [...categories[sport].entries()].sort((a, b) => a[1] - b[1]).map(([n]) => n)
    out[sport] = Object.fromEntries(ordered.map(c => [c, tags[sport]?.[c] || []]))
  }
  return out
}

function validateSport(sport, taxonomy) {
  const file = JSON.parse(readFileSync(join(ROOT, `ROP-Public-Library-${sport}.json`), 'utf8'))
  const tax = taxonomy[sport]
  const valid = new Set(Object.entries(tax).flatMap(([c, ts]) => ts.map(t => `${c}: ${t}`)))
  const errors = []
  const drills = file.drills || []

  if (file.sport !== sport) errors.push(`sport field is ${JSON.stringify(file.sport)}, expected ${sport}`)
  const seen = new Map()
  for (const d of drills) seen.set(d.name, (seen.get(d.name) || 0) + 1)
  for (const [n, c] of seen) if (c > 1) errors.push(`duplicate drill name ${JSON.stringify(n)} appears ${c} times (upsert keyed on name, so one would silently overwrite the other)`)

  const categoryHits = {}, tagHits = {}
  for (const d of drills) {
    const at = `${d.name || '(unnamed)'}`
    for (const f of FIELDS) if (!(f in d)) errors.push(`${at}: missing field ${f}`)
    for (const k of Object.keys(d)) if (!FIELDS.includes(k)) errors.push(`${at}: unexpected field ${k}`)
    for (const f of ['name', 'description', 'coachingPoints']) {
      const v = d[f]
      if (typeof v !== 'string' || !v.trim()) errors.push(`${at}: ${f} is empty`)
      else if (/[–—]/.test(v)) errors.push(`${at}: ${f} contains an en or em dash (spec §7)`)
    }
    if (typeof d.duration !== 'number' || d.duration < 3 || d.duration > 30) errors.push(`${at}: duration ${JSON.stringify(d.duration)} is not a realistic number of minutes`)
    if (!GROUPINGS.includes(d.grouping)) errors.push(`${at}: grouping ${JSON.stringify(d.grouping)} not one of ${GROUPINGS.join('/')}`)
    if (d.grouping === 'groups') {
      if (!Number.isInteger(d.numGroups) || d.numGroups < 2) errors.push(`${at}: numGroups must be an integer >= 2 when grouping is "groups", got ${JSON.stringify(d.numGroups)}`)
    } else if (d.numGroups !== null) {
      errors.push(`${at}: numGroups must be null when grouping is ${JSON.stringify(d.grouping)}`)
    }
    const tags = d.skillTags || []
    if (!tags.length) errors.push(`${at}: no skillTags, would land in the app's Untagged bucket`)
    if (new Set(tags).size !== tags.length) errors.push(`${at}: duplicate entries in skillTags`)
    const cats = new Set()
    for (const t of tags) {
      if (!valid.has(t)) { errors.push(`${at}: skillTag ${JSON.stringify(t)} does not resolve, the import would SILENTLY DROP it`); continue }
      tagHits[t] = (tagHits[t] || 0) + 1
      cats.add(t.slice(0, t.indexOf(': ')))
    }
    for (const c of cats) categoryHits[c] = (categoryHits[c] || 0) + 1
  }

  console.log(`\n=== ${sport}: ${drills.length} drills ===`)
  for (const c of Object.keys(tax)) {
    const n = categoryHits[c] || 0
    const bare = tax[c].filter(t => !tagHits[`${c}: ${t}`])
    console.log(`  ${c.padEnd(16)}${String(n).padStart(3)}${n < TARGET_PER_CATEGORY - 1 ? '  << under target' : ''}${bare.length ? `   sub-tags with no drills: ${bare.join(', ')}` : ''}`)
  }
  if (errors.length) { console.log(`  ERRORS (${errors.length}):`); for (const e of errors) console.log(`    X ${e}`) }
  else console.log('  no errors')
  return errors.length === 0
}

const taxonomy = loadTaxonomy()
for (const [sport, cats] of Object.entries(taxonomy)) {
  const thin = Object.entries(cats).filter(([, t]) => t.length < 4).map(([c]) => c)
  if (thin.length) console.warn(`! ${sport} categories parsed with fewer than 4 sub-tags: ${thin.join(', ')} -- is a tag migration missing from TAG_MIGRATIONS?`)
}
const allOk = SPORTS.map(s => validateSport(s, taxonomy)).every(Boolean)
console.log(allOk ? '\nAll files valid. Safe to run scripts/import-public-library.mjs.' : '\nValidation FAILED. Fix the errors above before importing.')
process.exit(allOk ? 0 : 1)
