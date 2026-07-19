// One-time/re-runnable import of the 6-sport public drill library
// (ROP-Public-Library-Spec.md §2.6) into content_catalogs + activity_library.
// Uses the service-role key to bypass RLS -- this is a maintenance script run
// once per sport file by a human with real credentials, not a user-facing
// bulk-insert path, so it doesn't go through an RPC the way live app features
// do (see BUILD-STATUS.md's "no client-side inserts loop" convention, which
// governs product features, not this).
//
// Usage: SUPABASE_SERVICE_ROLE_KEY=... node scripts/import-public-library.mjs
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

const SUPABASE_URL = 'https://bepoojcbizxhqadrytjq.supabase.co'
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SERVICE_ROLE_KEY) {
  console.error('SUPABASE_SERVICE_ROLE_KEY is required in the environment.')
  process.exit(1)
}
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

const SPORT_FILES = ['Football', 'Lacrosse', 'Soccer', 'Volleyball', 'Baseball', 'Basketball']

async function upsertCatalog(sport) {
  const { data: existing, error: findErr } = await supabase
    .from('content_catalogs').select('*')
    .eq('sport', sport).eq('publisher_type', 'system').maybeSingle()
  if (findErr) throw findErr
  if (existing) return existing
  const { data, error } = await supabase.from('content_catalogs').insert({
    name: `Run of Practice: ${sport} Fundamentals`,
    sport, publisher_name: 'Staff Editor', organization_name: 'Run of Practice', publisher_type: 'system', visibility: 'public',
  }).select().single()
  if (error) throw error
  return data
}

async function resolveTag(sport, tagString) {
  const idx = tagString.indexOf(': ')
  if (idx === -1) { console.warn(`  ! skill tag missing "Category: Name" shape: "${tagString}"`); return null }
  const category = tagString.slice(0, idx)
  const name = tagString.slice(idx + 2)
  const { data: cat, error: catErr } = await supabase.from('skill_categories')
    .select('id').eq('sport', sport).eq('name', category).maybeSingle()
  if (catErr) throw catErr
  if (!cat) { console.warn(`  ! no skill_category "${sport}: ${category}"`); return null }
  const { data: tag, error: tagErr } = await supabase.from('skill_tags')
    .select('id').eq('category_id', cat.id).eq('scope', 'global').eq('name', name).maybeSingle()
  if (tagErr) throw tagErr
  if (!tag) { console.warn(`  ! no global skill_tag "${sport}: ${tagString}"`); return null }
  return tag.id
}

async function resolveAsset(catalogId, sport, name, type) {
  const { data: existing, error: findErr } = await supabase.from('assets')
    .select('id').eq('source_catalog_id', catalogId).eq('type', type).ilike('name', name).maybeSingle()
  if (findErr) throw findErr
  if (existing) return existing.id
  const { data, error } = await supabase.from('assets')
    .insert({ source_catalog_id: catalogId, sport, type, name }).select().single()
  if (error) throw error
  return data.id
}

async function upsertDrill(catalogId, sport, drill, position) {
  const { data: existing, error: findErr } = await supabase.from('activity_library')
    .select('id').eq('source_catalog_id', catalogId).eq('name', drill.name).maybeSingle()
  if (findErr) throw findErr

  const row = {
    source_catalog_id: catalogId, sport, name: drill.name,
    duration_minutes: drill.duration || null, description: drill.description || null,
    coaching_points: drill.coachingPoints || null, grouping: drill.grouping || 'whole',
    num_groups: drill.grouping === 'groups' ? (drill.numGroups || null) : null,
  }

  let drillId
  if (existing) {
    drillId = existing.id
    const { error } = await supabase.from('activity_library').update(row).eq('id', drillId)
    if (error) throw error
  } else {
    const { data, error } = await supabase.from('activity_library')
      .insert(Object.assign({ position }, row)).select().single()
    if (error) throw error
    drillId = data.id
  }

  const assetIds = []
  for (const name of drill.teamEquipment || []) assetIds.push(await resolveAsset(catalogId, sport, name, 'team_equipment'))
  for (const name of drill.playerGear || []) assetIds.push(await resolveAsset(catalogId, sport, name, 'player_gear'))
  await supabase.from('activity_library_equipment').delete().eq('activity_library_id', drillId)
  if (assetIds.length) {
    const { error } = await supabase.from('activity_library_equipment')
      .insert(assetIds.map(asset_id => ({ activity_library_id: drillId, asset_id })))
    if (error) throw error
  }

  const tagIds = []
  for (const t of drill.skillTags || []) {
    const id = await resolveTag(sport, t)
    if (id) tagIds.push(id)
  }
  await supabase.from('drill_tags').delete().eq('activity_library_id', drillId)
  if (tagIds.length) {
    const { error } = await supabase.from('drill_tags')
      .insert(tagIds.map(skill_tag_id => ({ activity_library_id: drillId, skill_tag_id })))
    if (error) throw error
  }

  return drillId
}

async function main() {
  for (const sport of SPORT_FILES) {
    const path = join(ROOT, `ROP-Public-Library-${sport}.json`)
    const file = JSON.parse(readFileSync(path, 'utf8'))
    console.log(`\n${sport}: ${file.drills.length} drills`)
    const catalog = await upsertCatalog(sport)
    let i = 0
    for (const drill of file.drills) {
      await upsertDrill(catalog.id, sport, drill, i++)
      console.log(`  ✓ ${drill.name}`)
    }
  }
  console.log('\nDone.')
}

main().catch(err => { console.error(err); process.exit(1) })
