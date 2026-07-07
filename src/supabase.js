import { createClient } from '@supabase/supabase-js'
const SUPABASE_URL = 'https://bepoojcbizxhqadrytjq.supabase.co'
const SUPABASE_ANON_KEY = 'sb_publishable_z0atQT9uv4_9OZSlGe_awg_d07YcC7v'
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

// ── Auth (magic link) ──────────────────────────────────────────────────────────
export async function sendMagicLink(email) {
  return supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin } })
}
export async function getCurrentSession() {
  const { data } = await supabase.auth.getSession()
  return data.session
}
export function onAuthStateChange(cb) {
  const { data } = supabase.auth.onAuthStateChange((_event, session) => cb(session))
  return data.subscription
}
export async function signOut() {
  return supabase.auth.signOut()
}

let _coachKey = null
export function setCoachKey(id) { _coachKey = 'coach_' + id }
let saveTimer = null
export async function loadData() {
  if (!_coachKey) return null
  try { const { data, error } = await supabase.from('app_data').select('value').eq('key', _coachKey).maybeSingle(); if (error) return null; return data ? data.value : null } catch (e) { return null }
}
export function saveData(d) {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(async () => {
    if (!_coachKey) return
    try { await supabase.from('app_data').upsert({ key: _coachKey, value: d }, { onConflict: 'key' }) } catch (e) { console.error(e) }
  }, 1500)
}
export function flushSave(d) {
  clearTimeout(saveTimer)
  if (!_coachKey || !d) return
  supabase.from('app_data').upsert({ key: _coachKey, value: d }, { onConflict: 'key' })
}

// ── Teams / roster ──────────────────────────────────────────────────────────────
const ROLE_LABELS = { head_coach: 'Head Coach', assistant_coach: 'Assistant Coach', helper: 'Helper' }
const ROLE_VALUES = { 'Head Coach': 'head_coach', 'Assistant Coach': 'assistant_coach', 'Helper': 'helper' }

function mapPlayerRow(p) {
  return { id: p.id, firstName: p.first_name, lastName: p.last_name, jersey: p.jersey_number || '', positions: p.positions || [], notes: p.notes || '', focusAreas: p.focus_areas || [] }
}
function mapStaffRow(s) {
  return { id: s.id, name: (s.first_name + ' ' + s.last_name).trim(), role: ROLE_LABELS[s.role] || s.role, inviteEmail: s.invite_email, userId: s.user_id }
}
function splitName(name) {
  const parts = (name || '').trim().split(/\s+/)
  return { firstName: parts[0] || name || '', lastName: parts.slice(1).join(' ') }
}

export async function fetchMyTeams() {
  const [teamsRes, playersRes, staffRes] = await Promise.all([
    supabase.from('teams').select('*').is('archived_at', null),
    supabase.from('players').select('*').is('archived_at', null),
    supabase.from('team_staff').select('*').is('archived_at', null),
  ])
  if (teamsRes.error) { console.error('fetchMyTeams:', teamsRes.error); return [] }
  const players = playersRes.data || []
  const staff = staffRes.data || []
  return (teamsRes.data || []).map(t => ({
    id: t.id,
    name: t.name,
    sport: t.sport,
    players: players.filter(p => p.team_id === t.id).map(mapPlayerRow),
    coaches: staff.filter(s => s.team_id === t.id).map(mapStaffRow),
  }))
}

export async function createTeam(ownerUserId, { name, sport }) {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const { error } = await supabase.from('teams').insert({ name, sport: sport || 'Basketball', owner_user_id: ownerUserId, timezone })
  if (error) console.error('createTeam:', error)
  return { error }
}
export async function updateTeam(id, { name, sport }) {
  const { error } = await supabase.from('teams').update({ name, sport: sport || 'Basketball' }).eq('id', id)
  if (error) console.error('updateTeam:', error)
  return { error }
}
export async function archiveTeam(id) {
  const { error } = await supabase.from('teams').update({ archived_at: new Date().toISOString() }).eq('id', id)
  if (error) console.error('archiveTeam:', error)
  return { error }
}

export async function createPlayer(teamId, { firstName, lastName, jersey, positions, notes }) {
  const { error } = await supabase.from('players').insert({ team_id: teamId, first_name: firstName, last_name: lastName || '', jersey_number: jersey || null, positions: positions || [], notes: notes || null })
  if (error) console.error('createPlayer:', error)
  return { error }
}
export async function updatePlayer(id, { firstName, lastName, jersey, positions, notes }) {
  const { error } = await supabase.from('players').update({ first_name: firstName, last_name: lastName || '', jersey_number: jersey || null, positions: positions || [], notes: notes || null }).eq('id', id)
  if (error) console.error('updatePlayer:', error)
  return { error }
}
export async function archivePlayer(id) {
  const { error } = await supabase.from('players').update({ archived_at: new Date().toISOString() }).eq('id', id)
  if (error) console.error('archivePlayer:', error)
  return { error }
}
export async function updatePlayerFocusAreas(id, focusAreas) {
  const { error } = await supabase.from('players').update({ focus_areas: focusAreas }).eq('id', id)
  if (error) console.error('updatePlayerFocusAreas:', error)
  return { error }
}

export async function createStaff(teamId, { name, role, inviteEmail }) {
  const { firstName, lastName } = splitName(name)
  const { error } = await supabase.from('team_staff').insert({ team_id: teamId, first_name: firstName, last_name: lastName, role: ROLE_VALUES[role] || 'assistant_coach', invite_email: inviteEmail || null })
  if (error) console.error('createStaff:', error)
  return { error }
}
export async function updateStaff(id, { name, role, inviteEmail }) {
  const { firstName, lastName } = splitName(name)
  const { error } = await supabase.from('team_staff').update({ first_name: firstName, last_name: lastName, role: ROLE_VALUES[role] || 'assistant_coach', invite_email: inviteEmail || null }).eq('id', id)
  if (error) console.error('updateStaff:', error)
  return { error }
}
export async function archiveStaff(id) {
  const { error } = await supabase.from('team_staff').update({ archived_at: new Date().toISOString() }).eq('id', id)
  if (error) console.error('archiveStaff:', error)
  return { error }
}

// ── Library (assets, skill tags, drills, sharing) ─────────────────────────────
const EQUIP_TYPE_TO_OLD = { team_equipment: 'team', player_gear: 'player' }
const OLD_TO_EQUIP_TYPE = { team: 'team_equipment', player: 'player_gear' }

function mapAssetRow(a) {
  return { id: a.id, name: a.name, type: EQUIP_TYPE_TO_OLD[a.type] || a.type, sport: a.sport, organizationId: a.organization_id, ownerUserId: a.owner_user_id }
}
function mapSkillTagRow(t) {
  return { id: t.id, categoryId: t.category_id, scope: t.scope, organizationId: t.organization_id, ownerUserId: t.owner_user_id, name: t.name }
}
function mapDrillRow(a, equipmentByDrill, tagsByDrill) {
  return {
    id: a.id, name: a.name, sport: a.sport,
    duration: a.duration_minutes || 10, description: a.description || '', coachingPoints: a.coaching_points || '',
    grouping: a.grouping || 'whole', numGroups: a.num_groups || 2,
    organizationId: a.organization_id, ownerUserId: a.owner_user_id, sharedWithOrganizationId: a.shared_with_organization_id,
    updatedAt: a.updated_at,
    equipment: equipmentByDrill[a.id] || [],
    skillTagIds: tagsByDrill[a.id] || [],
  }
}

export async function fetchLibraryData() {
  const [assetsRes, categoriesRes, tagsRes, drillsRes, equipRes, drillTagsRes, orgsRes, profilesRes] = await Promise.all([
    supabase.from('assets').select('*').is('archived_at', null),
    supabase.from('skill_categories').select('*'),
    supabase.from('skill_tags').select('*').is('archived_at', null),
    supabase.from('activity_library').select('*').is('archived_at', null),
    supabase.from('activity_library_equipment').select('*'),
    supabase.from('drill_tags').select('*'),
    supabase.from('organization_members').select('organization_id, role, organizations(id, name)').is('archived_at', null),
    supabase.from('profiles').select('id, email, first_name, last_name'), // own row + org co-members, per RLS
  ])
  if (drillsRes.error) console.error('fetchLibraryData drills:', drillsRes.error)
  if (assetsRes.error) console.error('fetchLibraryData assets:', assetsRes.error)

  const equipmentByDrill = {}
  for (const e of equipRes.data || []) (equipmentByDrill[e.activity_library_id] ||= []).push(e.asset_id)
  const tagsByDrill = {}
  for (const t of drillTagsRes.data || []) (tagsByDrill[t.activity_library_id] ||= []).push(t.skill_tag_id)
  const profilesById = {}
  for (const p of profilesRes.data || []) profilesById[p.id] = { name: (p.first_name && p.last_name) ? (p.first_name + ' ' + p.last_name) : (p.email || 'A coach') }

  return {
    assets: (assetsRes.data || []).map(mapAssetRow),
    skillCategories: categoriesRes.data || [],
    skillTags: (tagsRes.data || []).map(mapSkillTagRow),
    activityLibrary: (drillsRes.data || []).map(a => mapDrillRow(a, equipmentByDrill, tagsByDrill)),
    myOrgs: (orgsRes.data || []).map(m => ({ id: m.organization_id, name: m.organizations ? m.organizations.name : '', role: m.role })),
    profilesById,
  }
}

export async function createAsset(ownerUserId, { name, sport, type }) {
  const { data, error } = await supabase.from('assets').insert({ name, sport: sport || 'General', type: OLD_TO_EQUIP_TYPE[type] || type || 'team_equipment', owner_user_id: ownerUserId }).select().single()
  if (error) console.error('createAsset:', error)
  return { data: data ? mapAssetRow(data) : null, error }
}
export async function updateAsset(id, { name, sport }) {
  const { error } = await supabase.from('assets').update({ name, sport }).eq('id', id)
  if (error) console.error('updateAsset:', error)
  return { error }
}
export async function archiveAsset(id) {
  const { error } = await supabase.from('assets').update({ archived_at: new Date().toISOString() }).eq('id', id)
  if (error) console.error('archiveAsset:', error)
  return { error }
}

export async function createSkillTag(ownerUserId, { categoryId, name }) {
  const { data, error } = await supabase.from('skill_tags').insert({ category_id: categoryId, scope: 'coach', owner_user_id: ownerUserId, name }).select().single()
  if (error) console.error('createSkillTag:', error)
  return { data: data ? mapSkillTagRow(data) : null, error }
}
export async function archiveSkillTag(id) {
  const { error } = await supabase.from('skill_tags').update({ archived_at: new Date().toISOString() }).eq('id', id)
  if (error) console.error('archiveSkillTag:', error)
  return { error }
}

async function syncDrillEquipment(drillId, assetIds) {
  const { data: existing } = await supabase.from('activity_library_equipment').select('id, asset_id').eq('activity_library_id', drillId)
  const existingIds = new Set((existing || []).map(e => e.asset_id))
  const wantIds = new Set(assetIds)
  const toAdd = assetIds.filter(id => !existingIds.has(id))
  const toRemove = (existing || []).filter(e => !wantIds.has(e.asset_id)).map(e => e.id)
  if (toAdd.length) await supabase.from('activity_library_equipment').insert(toAdd.map(asset_id => ({ activity_library_id: drillId, asset_id })))
  if (toRemove.length) await supabase.from('activity_library_equipment').delete().in('id', toRemove)
}
async function syncDrillTags(drillId, tagIds) {
  const { data: existing } = await supabase.from('drill_tags').select('id, skill_tag_id').eq('activity_library_id', drillId)
  const existingIds = new Set((existing || []).map(e => e.skill_tag_id))
  const wantIds = new Set(tagIds)
  const toAdd = tagIds.filter(id => !existingIds.has(id))
  const toRemove = (existing || []).filter(e => !wantIds.has(e.skill_tag_id)).map(e => e.id)
  if (toAdd.length) await supabase.from('drill_tags').insert(toAdd.map(skill_tag_id => ({ activity_library_id: drillId, skill_tag_id })))
  if (toRemove.length) await supabase.from('drill_tags').delete().in('id', toRemove)
}

export async function createDrill(ownerUserId, { name, sport, duration, description, coachingPoints, grouping, numGroups, equipment, skillTagIds }) {
  const { data, error } = await supabase.from('activity_library').insert({
    owner_user_id: ownerUserId, name, sport: sport || 'General', duration_minutes: duration || null,
    description: description || null, coaching_points: coachingPoints || null,
    grouping: grouping || 'whole', num_groups: numGroups || null,
  }).select().single()
  if (error) { console.error('createDrill:', error); return { error } }
  if (equipment && equipment.length) await syncDrillEquipment(data.id, equipment)
  if (skillTagIds && skillTagIds.length) await syncDrillTags(data.id, skillTagIds)
  return { data }
}
export async function updateDrill(id, { name, sport, duration, description, coachingPoints, grouping, numGroups, equipment, skillTagIds }) {
  const { error } = await supabase.from('activity_library').update({
    name, sport: sport || 'General', duration_minutes: duration || null,
    description: description || null, coaching_points: coachingPoints || null,
    grouping: grouping || 'whole', num_groups: numGroups || null,
  }).eq('id', id)
  if (error) { console.error('updateDrill:', error); return { error } }
  if (equipment) await syncDrillEquipment(id, equipment)
  if (skillTagIds) await syncDrillTags(id, skillTagIds)
  return {}
}
export async function archiveDrill(id) {
  const { error } = await supabase.from('activity_library').update({ archived_at: new Date().toISOString() }).eq('id', id)
  if (error) console.error('archiveDrill:', error)
  return { error }
}
export async function setDrillShare(id, organizationId) {
  const { error } = await supabase.from('activity_library').update({ shared_with_organization_id: organizationId }).eq('id', id)
  if (error) console.error('setDrillShare:', error)
  return { error }
}

// Copy semantics (addendum, "recurring bug" section): copying a shared drill
// into your own library must NOT reference the sharer's asset rows. Resolve
// by name+type into the recipient's own pool -- match an existing asset, or
// inline-create one, exactly like the "type a new one" picker behavior.
export async function copyDrillToMyLibrary(ownerUserId, sourceDrill, sourceAssetsById) {
  const { data: created, error } = await supabase.from('activity_library').insert({
    owner_user_id: ownerUserId, name: sourceDrill.name, sport: sourceDrill.sport,
    duration_minutes: sourceDrill.duration || null, description: sourceDrill.description || null,
    coaching_points: sourceDrill.coachingPoints || null, grouping: sourceDrill.grouping || 'whole',
    num_groups: sourceDrill.numGroups || null,
  }).select().single()
  if (error) { console.error('copyDrillToMyLibrary:', error); return { error } }

  const equipmentIds = sourceDrill.equipment || []
  if (equipmentIds.length) {
    const { data: myAssets } = await supabase.from('assets').select('*').eq('owner_user_id', ownerUserId).is('archived_at', null)
    const mine = (myAssets || []).map(mapAssetRow)
    const resolvedIds = []
    for (const assetId of equipmentIds) {
      const source = sourceAssetsById[assetId]
      if (!source) continue
      const match = mine.find(a => a.name.toLowerCase() === source.name.toLowerCase() && a.type === source.type)
      if (match) { resolvedIds.push(match.id); continue }
      const { data: newAsset } = await createAsset(ownerUserId, { name: source.name, sport: source.sport, type: source.type })
      if (newAsset) { resolvedIds.push(newAsset.id); mine.push(newAsset) }
    }
    if (resolvedIds.length) await syncDrillEquipment(created.id, resolvedIds)
  }
  // Tags deliberately not copied -- coach-scoped tags never transfer, and an
  // org tag copied outside that org's context would be meaningless. Recipient
  // re-tags manually if they want to.
  return { data: created }
}

// ── Locations ──────────────────────────────────────────────────────────────────
export async function fetchLocations() {
  const [locsRes, subsRes] = await Promise.all([
    supabase.from('locations').select('*').is('archived_at', null),
    supabase.from('sublocations').select('*').is('archived_at', null),
  ])
  if (locsRes.error) console.error('fetchLocations:', locsRes.error)
  return (locsRes.data || []).map(l => ({
    id: l.id, name: l.name,
    sublocations: (subsRes.data || []).filter(s => s.location_id === l.id).map(s => ({ id: s.id, name: s.name })),
  }))
}
export async function createLocation(ownerUserId, name) {
  const { data, error } = await supabase.from('locations').insert({ owner_user_id: ownerUserId, name }).select().single()
  if (error) console.error('createLocation:', error)
  return { data, error }
}
export async function updateLocation(id, name) {
  const { error } = await supabase.from('locations').update({ name }).eq('id', id)
  if (error) console.error('updateLocation:', error)
  return { error }
}
export async function archiveLocation(id) {
  const { error } = await supabase.from('locations').update({ archived_at: new Date().toISOString() }).eq('id', id)
  if (error) console.error('archiveLocation:', error)
  return { error }
}
export async function createSublocation(locationId, name) {
  const { error } = await supabase.from('sublocations').insert({ location_id: locationId, name })
  if (error) console.error('createSublocation:', error)
  return { error }
}

// ── Practice / template trees ─────────────────────────────────────────────────
// Both practices and templates share the same activities-tree shape used
// throughout ActConfig/StationConfig/ChecklistConfig/Builder/TemplateWorkspace
// -- the local editing UX never changes, only how it's persisted. A local
// activity/station id is either a real DB uuid (already-saved row) or a
// short client-generated id from uid() (never saved yet); the two are never
// ambiguous since uid() never produces UUID-shaped strings.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const isDbId = id => UUID_RE.test(id || '')

function localToScheduledAt(date, time) {
  if (!date) return null
  const d = new Date(date + 'T' + (time || '00:00'))
  return d.toISOString()
}
function scheduledAtToLocal(iso) {
  if (!iso) return { date: '', startTime: '' }
  const d = new Date(iso)
  const pad = n => String(n).padStart(2, '0')
  return {
    date: d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()),
    startTime: pad(d.getHours()) + ':' + pad(d.getMinutes()),
  }
}

function mapActivityRow(a, equipByAct, itemsByAct, stationBlocksByAct, stationsByBlock, stationEquipByStation) {
  const base = {
    id: a.id, type: a.type, name: a.name || '', duration: a.duration_minutes || 10,
    description: a.description || '', coachingPoints: a.coaching_points || '',
    grouping: a.grouping || 'whole', numGroups: a.num_groups || 2,
    coachId: a.team_staff_id || '', sublocationId: a.sublocation_id || '',
    libraryId: a.library_activity_id || null,
    equipment: equipByAct[a.id] || [],
  }
  if (a.type === 'checklist') {
    base.items = (itemsByAct[a.id] || []).map(it => ({ id: it.id, text: it.text }))
    base.notes = base.description
  }
  if (a.type === 'station_block') {
    const block = (stationBlocksByAct[a.id] || [])[0]
    base.rotate = block ? block.rotate : true
    base.stationDuration = block ? Math.round((block.station_duration_seconds || 600) / 60) : 10
    base.transitionDuration = block ? Math.round((block.transition_duration_seconds || 120) / 60) : 2
    const stations = block ? (stationsByBlock[block.id] || []) : []
    base.stations = stations.map(st => ({
      id: st.id, name: st.name || '', activityName: st.name || '',
      coachId: st.team_staff_id || '', sublocationId: st.sublocation_id || '',
      coachingPoints: st.coaching_points || '', libraryId: st.library_activity_id || null,
      equipment: stationEquipByStation[st.id] || [], playerGear: '',
      assignments: st.assignments || [],
    }))
  }
  return base
}

export async function fetchPracticesFull() {
  const [practicesRes, actsRes, equipRes, itemsRes, blocksRes, stationsRes, stationEquipRes] = await Promise.all([
    supabase.from('practices').select('*').is('archived_at', null),
    supabase.from('practice_activities').select('*').is('archived_at', null),
    supabase.from('practice_activity_equipment').select('*'),
    supabase.from('practice_activity_checklist_items').select('*').order('position'),
    supabase.from('station_blocks').select('*'),
    supabase.from('stations').select('*').is('archived_at', null).order('position'),
    supabase.from('station_equipment').select('*'),
  ])
  if (practicesRes.error) console.error('fetchPracticesFull:', practicesRes.error)
  const equipByAct = {}
  for (const e of equipRes.data || []) (equipByAct[e.practice_activity_id] ||= []).push(e.asset_id)
  const itemsByAct = {}
  for (const it of itemsRes.data || []) (itemsByAct[it.practice_activity_id] ||= []).push(it)
  const blocksByAct = {}
  for (const b of blocksRes.data || []) (blocksByAct[b.practice_activity_id] ||= []).push(b)
  const stationsByBlock = {}
  for (const s of stationsRes.data || []) (stationsByBlock[s.station_block_id] ||= []).push(s)
  const stationEquipByStation = {}
  for (const se of stationEquipRes.data || []) (stationEquipByStation[se.station_id] ||= []).push(se.asset_id)

  const actsByPractice = {}
  for (const a of (actsRes.data || []).sort((x, y) => x.position - y.position)) (actsByPractice[a.practice_id] ||= []).push(a)

  return (practicesRes.data || []).map(p => {
    const { date, startTime } = scheduledAtToLocal(p.scheduled_at)
    const activities = (actsByPractice[p.id] || []).map(a => mapActivityRow(a, equipByAct, itemsByAct, blocksByAct, stationsByBlock, stationEquipByStation))
    return { id: p.id, teamId: p.team_id, locationId: p.location_id || '', date, startTime, durMin: sumMinsLocal(activities), activities }
  })
}

function sumMinsLocal(acts) {
  return (acts || []).reduce((s, a) => {
    if (a.type === 'station_block') return s + a.stations.length * (a.stationDuration || 0) + Math.max(0, a.stations.length - 1) * (a.rotate !== false ? (a.transitionDuration || 0) : 0)
    return s + (a.duration || 0)
  }, 0)
}

// Full replace-all sync for a join/list table scoped to one parent row --
// simplest robust approach for explicit-Save-button data (not live-typing),
// matching the size of these lists (a handful of equipment/items per activity).
async function replaceEquipment(table, fkCol, parentId, assetIds) {
  await supabase.from(table).delete().eq(fkCol, parentId)
  const ids = (assetIds || []).filter(Boolean)
  if (ids.length) await supabase.from(table).insert(ids.map(asset_id => ({ [fkCol]: parentId, asset_id })))
}
async function replaceChecklistItems(table, fkCol, parentId, items) {
  await supabase.from(table).delete().eq(fkCol, parentId)
  const list = (items || []).filter(it => it.text && it.text.trim())
  if (list.length) await supabase.from(table).insert(list.map((it, i) => ({ [fkCol]: parentId, position: i, text: it.text.trim() })))
}

async function saveActivityTree({ parentIdCol, parentId, activities, activityTable, equipTable, itemsTable, blockTable, stationTable, stationEquipTable, teamScoped }) {
  const { data: existingActs } = await supabase.from(activityTable).select('id').eq(parentIdCol, parentId).is('archived_at', null)
  const keepActIds = new Set()

  for (let i = 0; i < activities.length; i++) {
    const act = activities[i]
    const row = {
      [parentIdCol]: parentId, position: i, type: act.type, name: act.name || null,
      duration_minutes: act.duration || null,
      description: act.type === 'checklist' ? (act.notes || null) : (act.description || null),
      coaching_points: act.coachingPoints || null,
      grouping: act.grouping || 'whole', num_groups: act.numGroups || null,
      library_activity_id: act.libraryId || null,
      sublocation_id: act.sublocationId || null,
    }
    if (teamScoped) row.team_staff_id = act.coachId || null

    let actId = act.id
    if (isDbId(actId)) {
      await supabase.from(activityTable).update(row).eq('id', actId)
    } else {
      const { data: created, error } = await supabase.from(activityTable).insert(row).select().single()
      if (error) { console.error('saveActivityTree insert activity:', error); continue }
      actId = created.id
    }
    keepActIds.add(actId)

    await replaceEquipment(equipTable, activityTable === 'practice_activities' ? 'practice_activity_id' : 'template_activity_id', actId, act.equipment)

    if (act.type === 'checklist' && itemsTable) {
      await replaceChecklistItems(itemsTable, activityTable === 'practice_activities' ? 'practice_activity_id' : 'template_activity_id', actId, act.items)
    }

    if (act.type === 'station_block' && blockTable) {
      const { data: existingBlock } = await supabase.from(blockTable).select('id').eq(activityTable === 'practice_activities' ? 'practice_activity_id' : 'template_activity_id', actId).maybeSingle()
      const blockRow = {
        rotate: act.rotate !== false,
        station_duration_seconds: (act.stationDuration || 10) * 60,
        transition_duration_seconds: (act.transitionDuration || 2) * 60,
      }
      let blockId = existingBlock && existingBlock.id
      if (blockId) {
        await supabase.from(blockTable).update(blockRow).eq('id', blockId)
      } else {
        blockRow[activityTable === 'practice_activities' ? 'practice_activity_id' : 'template_activity_id'] = actId
        const { data: createdBlock, error } = await supabase.from(blockTable).insert(blockRow).select().single()
        if (error) { console.error('saveActivityTree insert block:', error); continue }
        blockId = createdBlock.id
      }

      const { data: existingStations } = await supabase.from(stationTable).select('id').eq(blockTable === 'station_blocks' ? 'station_block_id' : 'template_station_block_id', blockId).is('archived_at', null)
      const keepStationIds = new Set()
      const stations = act.stations || []
      for (let si = 0; si < stations.length; si++) {
        const st = stations[si]
        const stRow = {
          [blockTable === 'station_blocks' ? 'station_block_id' : 'template_station_block_id']: blockId,
          position: si, name: st.activityName || st.name || null,
          coaching_points: st.coachingPoints || null,
          sublocation_id: st.sublocationId || null,
          library_activity_id: st.libraryId || null,
        }
        if (teamScoped) {
          stRow.team_staff_id = st.coachId || null
          stRow.assignments = st.assignments || []
        }
        let stId = st.id
        if (isDbId(stId)) {
          await supabase.from(stationTable).update(stRow).eq('id', stId)
        } else {
          const { data: createdSt, error } = await supabase.from(stationTable).insert(stRow).select().single()
          if (error) { console.error('saveActivityTree insert station:', error); continue }
          stId = createdSt.id
        }
        keepStationIds.add(stId)
        await replaceEquipment(stationEquipTable, stationTable === 'stations' ? 'station_id' : 'template_station_id', stId, st.equipment)
      }
      for (const es of existingStations || []) {
        if (!keepStationIds.has(es.id)) await supabase.from(stationTable).update({ archived_at: new Date().toISOString() }).eq('id', es.id)
      }
    }
  }

  for (const ea of existingActs || []) {
    if (!keepActIds.has(ea.id)) await supabase.from(activityTable).update({ archived_at: new Date().toISOString() }).eq('id', ea.id)
  }
}

export async function savePracticeTree(existingId, { teamId, locationId, date, startTime, activities }) {
  const row = { team_id: teamId, location_id: locationId || null, scheduled_at: localToScheduledAt(date, startTime), status: date ? 'scheduled' : 'draft' }
  let practiceId = existingId
  if (isDbId(practiceId)) {
    await supabase.from('practices').update(row).eq('id', practiceId)
  } else {
    const { data, error } = await supabase.from('practices').insert(row).select().single()
    if (error) { console.error('savePracticeTree:', error); return { error } }
    practiceId = data.id
  }
  await saveActivityTree({
    parentIdCol: 'practice_id', parentId: practiceId, activities,
    activityTable: 'practice_activities', equipTable: 'practice_activity_equipment',
    itemsTable: 'practice_activity_checklist_items', blockTable: 'station_blocks',
    stationTable: 'stations', stationEquipTable: 'station_equipment', teamScoped: true,
  })
  return { data: { id: practiceId } }
}
export async function archivePractice(id) {
  const { error } = await supabase.from('practices').update({ archived_at: new Date().toISOString() }).eq('id', id)
  if (error) console.error('archivePractice:', error)
  return { error }
}

export async function fetchTemplatesFull() {
  const [tplsRes, actsRes, equipRes, itemsRes, blocksRes, stationsRes, stationEquipRes] = await Promise.all([
    supabase.from('templates').select('*').is('archived_at', null),
    supabase.from('template_activities').select('*').is('archived_at', null),
    supabase.from('template_activity_equipment').select('*'),
    supabase.from('template_activity_checklist_items').select('*').order('position'),
    supabase.from('template_station_blocks').select('*'),
    supabase.from('template_stations').select('*').is('archived_at', null).order('position'),
    supabase.from('template_station_equipment').select('*'),
  ])
  if (tplsRes.error) console.error('fetchTemplatesFull:', tplsRes.error)
  const equipByAct = {}
  for (const e of equipRes.data || []) (equipByAct[e.template_activity_id] ||= []).push(e.asset_id)
  const itemsByAct = {}
  for (const it of itemsRes.data || []) (itemsByAct[it.template_activity_id] ||= []).push(it)
  const blocksByAct = {}
  for (const b of blocksRes.data || []) (blocksByAct[b.template_activity_id] ||= []).push(b)
  const stationsByBlock = {}
  for (const s of stationsRes.data || []) (stationsByBlock[s.template_station_block_id] ||= []).push(s)
  const stationEquipByStation = {}
  for (const se of stationEquipRes.data || []) (stationEquipByStation[se.template_station_id] ||= []).push(se.asset_id)

  const actsByTpl = {}
  for (const a of (actsRes.data || []).sort((x, y) => x.position - y.position)) (actsByTpl[a.template_id] ||= []).push(a)

  return (tplsRes.data || []).map(t => {
    const activities = (actsByTpl[t.id] || []).map(a => mapActivityRow(a, equipByAct, itemsByAct, blocksByAct, stationsByBlock, stationEquipByStation))
    return {
      id: t.id, name: t.name, sport: t.sport, locationId: t.location_id || '',
      organizationId: t.organization_id, ownerUserId: t.owner_user_id, sharedWithOrganizationId: t.shared_with_organization_id,
      durMin: sumMinsLocal(activities), activities,
    }
  })
}
export async function saveTemplateTree(ownerUserId, existingId, { name, sport, locationId, activities }) {
  const row = { name, sport: sport || 'General', location_id: locationId || null }
  let tplId = existingId
  if (isDbId(tplId)) {
    await supabase.from('templates').update(row).eq('id', tplId)
  } else {
    const { data, error } = await supabase.from('templates').insert(Object.assign({ owner_user_id: ownerUserId }, row)).select().single()
    if (error) { console.error('saveTemplateTree:', error); return { error } }
    tplId = data.id
  }
  await saveActivityTree({
    parentIdCol: 'template_id', parentId: tplId, activities,
    activityTable: 'template_activities', equipTable: 'template_activity_equipment',
    itemsTable: 'template_activity_checklist_items', blockTable: 'template_station_blocks',
    stationTable: 'template_stations', stationEquipTable: 'template_station_equipment', teamScoped: false,
  })
  return { data: { id: tplId } }
}
export async function archiveTemplate(id) {
  const { error } = await supabase.from('templates').update({ archived_at: new Date().toISOString() }).eq('id', id)
  if (error) console.error('archiveTemplate:', error)
  return { error }
}

// ── Live sessions (practice_live_sessions + append-only history tables) ────────
// Persistence model: current_phase_started_at/paused_at/total_paused_seconds
// drive the timer -- elapsed is always derived client-side from these three
// timestamps, never written per-tick. Every control-affecting write is
// optimistic-concurrency gated (WHERE id=? AND version=?); RLS additionally
// enforces controller_user_id=auth.uid() on update, so a stale/non-controller
// write fails structurally, not just by convention. attendance/groups are
// append-only inserts (current = latest batch by created_at), matching the
// schema's own history-table pattern.

export async function findActiveLiveSession(practiceId) {
  const { data, error } = await supabase.from('practice_live_sessions').select('*')
    .eq('practice_id', practiceId).eq('status', 'active')
    .order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (error) { console.error('findActiveLiveSession:', error); return null }
  return data
}

export async function createLiveSession(practiceId, controllerUserId, { practiceActivityId, inBlockIntro }) {
  const row = {
    practice_id: practiceId, status: 'active', controller_user_id: controllerUserId, version: 1,
    current_practice_activity_id: practiceActivityId, current_rotation_number: 0,
    in_transition: false, in_block_intro: !!inBlockIntro,
    current_phase_started_at: new Date().toISOString(), paused_at: null, total_paused_seconds: 0,
  }
  const { data, error } = await supabase.from('practice_live_sessions').insert(row).select().single()
  if (error) { console.error('createLiveSession:', error); return null }
  return data
}

// Returns the updated row, or null if the version was stale (someone else
// wrote first, or took control) -- caller should refetch and reconcile.
export async function updateLiveSession(id, version, patch) {
  const { data, error } = await supabase.from('practice_live_sessions')
    .update(Object.assign({}, patch, { version: version + 1 }))
    .eq('id', id).eq('version', version).select().maybeSingle()
  if (error) { console.error('updateLiveSession:', error); return null }
  return data
}

export async function takeControl(id, version, userId) {
  return updateLiveSession(id, version, { controller_user_id: userId })
}

export function subscribeToLiveSession(id, onUpdate) {
  return supabase.channel('live_session_' + id)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'practice_live_sessions', filter: 'id=eq.' + id }, payload => onUpdate(payload.new))
    .subscribe()
}

export async function endLiveSession(id, version) {
  return updateLiveSession(id, version, { status: 'completed', ended_at: new Date().toISOString(), paused_at: null })
}

// Best-effort audit log of control actions. Not yet wired to client-side
// retry/offline-queue logic (that's stage 7) so duplicate suppression only
// helps against double-submits within this session, not resumed retries.
export async function submitOperation(sessionId, submittedBy, actionType) {
  const { error } = await supabase.from('session_operations')
    .insert({ session_id: sessionId, operation_id: crypto.randomUUID(), submitted_by: submittedBy, action_type: actionType })
  if (error && error.code !== '23505') console.error('submitOperation:', error)
}

export async function submitAttendanceSnapshot(sessionId, markedBy, presentIds, allPlayerIds) {
  const rows = allPlayerIds.map(id => ({ session_id: sessionId, player_id: id, status: presentIds.has(id) ? 'present' : 'absent', marked_by: markedBy }))
  if (!rows.length) return
  const { error } = await supabase.from('session_attendance').insert(rows)
  if (error) console.error('submitAttendanceSnapshot:', error)
}

export async function fetchLatestAttendance(sessionId) {
  const { data, error } = await supabase.from('session_attendance').select('player_id,status,created_at')
    .eq('session_id', sessionId).order('created_at', { ascending: false })
  if (error) { console.error('fetchLatestAttendance:', error); return {} }
  const seen = {}
  for (const row of data || []) if (!(row.player_id in seen)) seen[row.player_id] = row.status
  return seen
}

// groups: array of arrays of player ids, index = group_number - 1. Used both
// for regular-activity sub-grouping and for station-block per-station
// assignment (group_number i = whoever starts at station i).
export async function saveSessionGroups(sessionId, practiceActivityId, createdBy, groups) {
  const rows = groups.map((g, i) => ({ session_id: sessionId, practice_activity_id: practiceActivityId, group_number: i + 1, created_by: createdBy }))
  if (!rows.length) return
  const { data: groupRows, error } = await supabase.from('session_groups').insert(rows).select()
  if (error) { console.error('saveSessionGroups:', error); return }
  const memberRows = []
  groupRows.forEach((gr, i) => { (groups[i] || []).forEach(pid => memberRows.push({ group_id: gr.id, player_id: pid })) })
  if (memberRows.length) {
    const { error: mErr } = await supabase.from('session_group_members').insert(memberRows)
    if (mErr) console.error('saveSessionGroups members:', mErr)
  }
}

export async function fetchLatestGroups(sessionId, practiceActivityId) {
  const { data: groups, error } = await supabase.from('session_groups').select('*')
    .eq('session_id', sessionId).eq('practice_activity_id', practiceActivityId).order('created_at', { ascending: false })
  if (error) { console.error('fetchLatestGroups:', error); return null }
  if (!groups || !groups.length) return null
  const latestTime = groups[0].created_at
  const latestGroups = groups.filter(g => g.created_at === latestTime).sort((a, b) => a.group_number - b.group_number)
  const { data: members } = await supabase.from('session_group_members').select('group_id,player_id').in('group_id', latestGroups.map(g => g.id))
  return latestGroups.map(g => (members || []).filter(m => m.group_id === g.id).map(m => m.player_id))
}

// Reconstructs the in-memory "currently open log row" ref after a resume
// (page reload, new device) -- the ref itself doesn't survive a remount.
export async function findOpenActivityLogId(sessionId) {
  const { data, error } = await supabase.from('session_activity_log').select('id')
    .eq('session_id', sessionId).is('ended_at', null).order('started_at', { ascending: false }).limit(1).maybeSingle()
  if (error) { console.error('findOpenActivityLogId:', error); return null }
  return data ? data.id : null
}

export async function openActivityLog(sessionId, loggedBy, { practiceActivityId, stationId }, presentPlayerIds) {
  const { data, error } = await supabase.from('session_activity_log').insert({
    session_id: sessionId, practice_activity_id: practiceActivityId || null, station_id: stationId || null,
    started_at: new Date().toISOString(), present_player_ids: presentPlayerIds || [], logged_by: loggedBy,
  }).select().single()
  if (error) { console.error('openActivityLog:', error); return null }
  return data.id
}

export async function closeActivityLog(logId) {
  if (!logId) return
  const { error } = await supabase.from('session_activity_log').update({ ended_at: new Date().toISOString() }).eq('id', logId)
  if (error) console.error('closeActivityLog:', error)
}

export async function createHelperShareToken(liveSessionId, createdBy) {
  const { data, error } = await supabase.from('session_access_tokens')
    .insert({ live_session_id: liveSessionId, scope: 'helper_read', created_by: createdBy }).select().single()
  if (error) { console.error('createHelperShareToken:', error); return null }
  return data.id
}

// ── Legacy POC live_sessions table -- still used by HelperView/PreviewView,
// unrewired until stage 6 (their anon RPC surface is a separate, deliberately
// privacy-minimized API: get_live_session_view/get_preview_view/
// submit_helper_attendance). Do not point these at practice_live_sessions.
export async function getSession(sessionId) {
  const { data, error } = await supabase.from('live_sessions').select('*').eq('session_id', sessionId).maybeSingle()
  if (error) return null
  return data
}
export function subscribeToSession(sessionId, onUpdate) {
  return supabase.channel('session_' + sessionId).on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'live_sessions', filter: 'session_id=eq.' + sessionId }, payload => { onUpdate(payload.new) }).subscribe()
}

// ── Preview sessions ──────────────────────────────────────────────────────────
// Reuses live_sessions table with type:"preview" in state.
// preview_id is stored as practice_id so we can query it.
// The state object contains full practice data for helpers to see setup info.

export async function createPreviewSession(coachId, practice, teamData, locationData, assetData) {
  const previewId = 'prev_' + Math.random().toString(36).slice(2, 10)
  const state = {
    type: 'preview',
    practice,
    team: teamData || null,
    locations: locationData || [],
    assets: assetData || [],
    liveSessionId: null, // filled when coach starts practice
  }
  const { error } = await supabase.from('live_sessions').insert({
    session_id: previewId,
    coach_id: coachId,
    practice_id: practice.id,
    state,
  })
  if (error) { console.error('createPreviewSession:', error); return null }
  return previewId
}

export async function updatePreviewWithLiveSession(previewId, liveSessionId) {
  const { data } = await supabase.from('live_sessions').select('state').eq('session_id', previewId).maybeSingle()
  if (!data) return
  const newState = Object.assign({}, data.state, { liveSessionId })
  await supabase.from('live_sessions').update({ state: newState }).eq('session_id', previewId)
}

export async function getPreviewSession(previewId) {
  const { data, error } = await supabase.from('live_sessions').select('*').eq('session_id', previewId).maybeSingle()
  if (error) return null
  return data
}

export function subscribeToPreview(previewId, onUpdate) {
  return supabase.channel('preview_' + previewId)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'live_sessions', filter: 'session_id=eq.' + previewId }, payload => { onUpdate(payload.new) })
    .subscribe()
}
