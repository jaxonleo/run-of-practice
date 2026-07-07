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

// ── Live sessions ─────────────────────────────────────────────────────────────
export async function createSession(coachId, practiceId, state) {
  const sessionId = Math.random().toString(36).slice(2, 10)
  const { error } = await supabase.from('live_sessions').insert({ session_id: sessionId, coach_id: coachId, practice_id: practiceId, state })
  if (error) { console.error(error); return null }
  return sessionId
}
export async function updateSession(sessionId, state) {
  const { error } = await supabase.from('live_sessions').update({ state }).eq('session_id', sessionId)
  if (error) console.error(error)
}
export async function endSession(sessionId) {
  const { error } = await supabase.from('live_sessions').update({ ended_at: new Date().toISOString() }).eq('session_id', sessionId)
  if (error) console.error(error)
}
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
