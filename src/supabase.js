import { createClient } from '@supabase/supabase-js'
const SUPABASE_URL = 'https://bepoojcbizxhqadrytjq.supabase.co'
const SUPABASE_ANON_KEY = 'sb_publishable_z0atQT9uv4_9OZSlGe_awg_d07YcC7v'
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

// ── Auth (email OTP code) ────────────────────────────────────────────────────
// Interim primary method -- magic links kept breaking for coaches using the
// homescreen-installed PWA (link opens in Safari, not the installed app, so
// the PKCE code_verifier from the requesting context is never found). A
// typed code has no cross-context requirement. No emailRedirectTo: the
// email template shows only the code, not a clickable link, so there's
// nothing for a coach to tap into the wrong context.
export async function sendEmailOtp(email) {
  return supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: true } })
}
export async function verifyEmailOtp(email, token) {
  return supabase.auth.verifyOtp({ email, token, type: 'email' })
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
// Name collection: profiles.first_name/last_name exist in the schema but are
// never populated by the auth trigger, so every coach greeting fell back to
// their raw email. Fetched once per session and cached in App state; caller
// treats a null first_name as "needs the one-time name prompt."
export async function fetchOwnProfile(userId) {
  const { data, error } = await supabase.from('profiles').select('first_name,last_name,email').eq('id', userId).maybeSingle()
  if (error) console.error('fetchOwnProfile:', error)
  return data
}
export async function updateOwnProfile(userId, { firstName, lastName }) {
  const { error } = await supabase.from('profiles').update({ first_name: firstName, last_name: lastName || null }).eq('id', userId)
  if (error) console.error('updateOwnProfile:', error)
  return { error }
}

// Soft, reversible account close -- data stays intact, coach just vanishes
// from teammates' rosters until they sign back in.
export async function deactivateOwnAccount(userId) {
  const { error } = await supabase.from('profiles').update({ deactivated_at: new Date().toISOString() }).eq('id', userId)
  if (error) console.error('deactivateOwnAccount:', error)
  return { error }
}
// Called right after a successful sign-in -- if this account was
// deactivated, silently clear it so "come back" really is just signing in
// again, no separate reactivation step.
export async function reactivateIfNeeded(userId) {
  const { data } = await supabase.from('profiles').select('deactivated_at').eq('id', userId).maybeSingle()
  if (data && data.deactivated_at) {
    await supabase.from('profiles').update({ deactivated_at: null }).eq('id', userId)
  }
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
  return { id: p.id, firstName: p.first_name, lastName: p.last_name, jersey: p.jersey_number || '', positions: p.positions || [], notes: p.notes || '' }
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
  const teamIds = (teamsRes.data || []).map(t => t.id)

  const [focusRes, tagsRes, deactivatedRes] = await Promise.all([
    players.length ? supabase.from('player_focus_areas').select('*').in('player_id', players.map(p => p.id)) : Promise.resolve({ data: [] }),
    supabase.from('skill_tags').select('id, category_id, name').is('archived_at', null),
    teamIds.length ? supabase.rpc('get_deactivated_staff_user_ids', { p_team_ids: teamIds }) : Promise.resolve({ data: [] }),
  ])
  const tagsById = {}
  for (const t of tagsRes.data || []) tagsById[t.id] = t
  const focusByPlayer = {}
  for (const fa of focusRes.data || []) {
    const tag = tagsById[fa.skill_tag_id]
    if (!tag) continue
    ;(focusByPlayer[fa.player_id] ||= []).push({ id: fa.id, skillTagId: fa.skill_tag_id, name: tag.name, categoryId: tag.category_id })
  }
  const deactivatedUserIds = new Set(deactivatedRes.data || [])

  return (teamsRes.data || []).map(t => ({
    id: t.id,
    name: t.name,
    sport: t.sport,
    timezone: t.timezone,
    startDate: t.start_date,
    endDate: t.end_date,
    colorPrimary: t.color_primary,
    colorSecondary: t.color_secondary,
    players: players.filter(p => p.team_id === t.id).map(p => Object.assign(mapPlayerRow(p), { focusAreas: focusByPlayer[p.id] || [] })),
    coaches: staff.filter(s => s.team_id === t.id && !(s.user_id && deactivatedUserIds.has(s.user_id))).map(mapStaffRow),
  }))
}

export async function createTeam(ownerUserId, { name, sport, colorPrimary, colorSecondary }) {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const { error } = await supabase.from('teams').insert({ name, sport: sport || 'Basketball', owner_user_id: ownerUserId, timezone, color_primary: colorPrimary || null, color_secondary: colorSecondary || null })
  if (error) console.error('createTeam:', error)
  return { error }
}
export async function updateTeam(id, { name, sport, colorPrimary, colorSecondary }) {
  const row = { name, sport: sport || 'Basketball' }
  if (colorPrimary !== undefined) row.color_primary = colorPrimary || null
  if (colorSecondary !== undefined) row.color_secondary = colorSecondary || null
  const { error } = await supabase.from('teams').update(row).eq('id', id)
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
// Structured focus areas -- a player <-> skill_tags join, replacing the old
// freeform text[]. skillTagId is either an existing tag (global/org/coach)
// or one just created via createSkillTag for a coach's own detail under a
// category.
export async function addPlayerFocusArea(playerId, skillTagId, createdBy) {
  const { error } = await supabase.from('player_focus_areas').insert({ player_id: playerId, skill_tag_id: skillTagId, created_by: createdBy })
  if (error) console.error('addPlayerFocusArea:', error)
  return { error }
}
export async function removePlayerFocusArea(id) {
  const { error } = await supabase.from('player_focus_areas').delete().eq('id', id)
  if (error) console.error('removePlayerFocusArea:', error)
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
    updatedAt: a.updated_at, position: a.position || 0,
    equipment: equipmentByDrill[a.id] || [],
    skillTagIds: tagsByDrill[a.id] || [],
  }
}

export async function fetchLibraryData() {
  const [assetsRes, categoriesRes, tagsRes, drillsRes, equipRes, drillTagsRes, orgsRes, profilesRes] = await Promise.all([
    supabase.from('assets').select('*').is('archived_at', null),
    supabase.from('skill_categories').select('*'),
    supabase.from('skill_tags').select('*').is('archived_at', null),
    supabase.from('activity_library').select('*').is('archived_at', null).order('position'),
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

async function nextDrillPosition(ownerUserId) {
  const { data } = await supabase.from('activity_library').select('position').eq('owner_user_id', ownerUserId).order('position', { ascending: false }).limit(1)
  return data && data.length ? data[0].position + 1 : 0
}
export async function createDrill(ownerUserId, { name, sport, duration, description, coachingPoints, grouping, numGroups, equipment, skillTagIds }) {
  const position = await nextDrillPosition(ownerUserId)
  const { data, error } = await supabase.from('activity_library').insert({
    owner_user_id: ownerUserId, name, sport: sport || 'General', duration_minutes: duration || null,
    description: description || null, coaching_points: coachingPoints || null,
    grouping: grouping || 'whole', num_groups: numGroups || null, position,
  }).select().single()
  if (error) { console.error('createDrill:', error); return { error } }
  if (equipment && equipment.length) await syncDrillEquipment(data.id, equipment)
  if (skillTagIds && skillTagIds.length) await syncDrillTags(data.id, skillTagIds)
  return { data }
}
// Swaps two drills' position values -- used for the My Library up/down
// reorder buttons (adjacent-swap, matching the pattern already used for
// activities within a practice/template).
export async function swapDrillPositions(idA, idB) {
  const { data } = await supabase.from('activity_library').select('id, position').in('id', [idA, idB])
  if (!data || data.length !== 2) return
  const [a, b] = data
  await Promise.all([
    supabase.from('activity_library').update({ position: b.position }).eq('id', a.id),
    supabase.from('activity_library').update({ position: a.position }).eq('id', b.id),
  ])
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

const browserTz = () => Intl.DateTimeFormat().resolvedOptions().timeZone

// Practice times must always read as the TEAM's local wall-clock time, not
// the viewing device's -- a coach traveling shouldn't see practice times
// shift. teams.timezone is nullable (older rows), so both directions fall
// back to the browser's zone when unset.
function teamLocalToScheduledAt(date, time, timeZone) {
  if (!date) return null
  const tz = timeZone || browserTz()
  const [y, mo, d] = date.split('-').map(Number)
  const [hh, mm] = (time || '00:00').split(':').map(Number)
  // Double-conversion trick: format a UTC guess in the target zone, measure
  // how far off that reading is from the guess, then correct by that delta.
  // Intl resolves the real offset for this specific date, so DST just works.
  const utcGuess = new Date(Date.UTC(y, mo - 1, d, hh, mm))
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(utcGuess)
  const get = t => parseInt(parts.find(p => p.type === t).value, 10)
  const tzAsUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'))
  const offset = tzAsUtc - utcGuess.getTime()
  return new Date(utcGuess.getTime() - offset).toISOString()
}
function scheduledAtToTeamLocal(iso, timeZone) {
  if (!iso) return { date: '', startTime: '' }
  const tz = timeZone || browserTz()
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(iso))
  const get = t => parts.find(p => p.type === t).value
  return { date: `${get('year')}-${get('month')}-${get('day')}`, startTime: `${get('hour')}:${get('minute')}` }
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
  const [practicesRes, actsRes, equipRes, itemsRes, blocksRes, stationsRes, stationEquipRes, teamsRes] = await Promise.all([
    supabase.from('practices').select('*').is('archived_at', null),
    supabase.from('practice_activities').select('*').is('archived_at', null),
    supabase.from('practice_activity_equipment').select('*'),
    supabase.from('practice_activity_checklist_items').select('*').order('position'),
    supabase.from('station_blocks').select('*'),
    supabase.from('stations').select('*').is('archived_at', null).order('position'),
    supabase.from('station_equipment').select('*'),
    supabase.from('teams').select('id,timezone'),
  ])
  if (practicesRes.error) console.error('fetchPracticesFull:', practicesRes.error)
  const tzByTeam = {}
  for (const t of teamsRes.data || []) tzByTeam[t.id] = t.timezone
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
    const { date, startTime } = scheduledAtToTeamLocal(p.scheduled_at, tzByTeam[p.team_id])
    const activities = (actsByPractice[p.id] || []).map(a => mapActivityRow(a, equipByAct, itemsByAct, blocksByAct, stationsByBlock, stationEquipByStation))
    return {
      id: p.id, teamId: p.team_id, locationId: p.location_id || '', sublocationId: p.sublocation_id || '',
      date, startTime, status: p.status, scheduledDurationMinutes: p.scheduled_duration_minutes || null,
      seriesId: p.series_id || null, durMin: sumMinsLocal(activities), activities,
    }
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

export async function savePracticeTree(existingId, { teamId, locationId, sublocationId, date, startTime, timezone, scheduledDurationMinutes, activities }) {
  const row = {
    team_id: teamId, location_id: locationId || null, sublocation_id: sublocationId || null,
    scheduled_at: teamLocalToScheduledAt(date, startTime, timezone), status: date ? 'scheduled' : 'draft',
    scheduled_duration_minutes: scheduledDurationMinutes || null,
  }
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

// ── Recurring schedules ──────────────────────────────────────────────────
export async function createPracticeSeries(teamId, { daysOfWeek, startTime, durationMinutes, locationId, sublocationId, rangeStart, rangeEnd, deselectedDates }) {
  const { data, error } = await supabase.rpc('create_practice_series', {
    p_team_id: teamId, p_days_of_week: daysOfWeek, p_start_time: startTime, p_duration_minutes: durationMinutes,
    p_range_start: rangeStart, p_range_end: rangeEnd, p_location_id: locationId || null, p_sublocation_id: sublocationId || null,
    p_deselected_dates: deselectedDates && deselectedDates.length ? deselectedDates : [],
  })
  if (error) { console.error('createPracticeSeries:', error); return { error } }
  return { data: { seriesId: data.series_id, count: data.count } }
}
export async function fetchPracticeSeries(teamId) {
  const { data, error } = await supabase.from('practice_series').select('*').eq('team_id', teamId).is('archived_at', null)
  if (error) console.error('fetchPracticeSeries:', error)
  return data || []
}
export async function archivePracticeSeries(id) {
  const { error } = await supabase.from('practice_series').update({ archived_at: new Date().toISOString() }).eq('id', id)
  if (error) console.error('archivePracticeSeries:', error)
  return { error }
}

// "This only" vs "this and all future" (§6) -- future never touches
// completed occurrences, matching standard calendar-app semantics.
export async function cancelPractice(id, { scope } = {}) {
  if (scope !== 'future') {
    const { error } = await supabase.from('practices').update({ status: 'cancelled' }).eq('id', id)
    if (error) console.error('cancelPractice:', error)
    return { error }
  }
  const { data: p, error: fetchErr } = await supabase.from('practices').select('series_id,scheduled_at').eq('id', id).single()
  if (fetchErr) { console.error('cancelPractice:', fetchErr); return { error: fetchErr } }
  if (!p.series_id) {
    const { error } = await supabase.from('practices').update({ status: 'cancelled' }).eq('id', id)
    if (error) console.error('cancelPractice:', error)
    return { error }
  }
  const { error } = await supabase.from('practices').update({ status: 'cancelled' })
    .eq('series_id', p.series_id).gte('scheduled_at', p.scheduled_at).not('status', 'eq', 'completed')
  if (error) console.error('cancelPractice:', error)
  return { error }
}
export async function restorePractice(id) {
  const { error } = await supabase.from('practices').update({ status: 'scheduled' }).eq('id', id)
  if (error) console.error('restorePractice:', error)
  return { error }
}

// scope:'future' shifts each future, not-yet-completed occurrence's
// time-of-day/location to match, while preserving each occurrence's own
// date -- i.e. "we moved start time to 6:30, starting now," not collapsing
// every future date onto this one. Changing the days-of-week pattern
// itself isn't supported here (that's a new series, per the wizard).
export async function reschedulePractice(id, { date, startTime, timezone, locationId, sublocationId, scope } = {}) {
  const row = { location_id: locationId || null, sublocation_id: sublocationId || null, scheduled_at: teamLocalToScheduledAt(date, startTime, timezone), status: 'scheduled' }
  if (scope !== 'future') {
    const { error } = await supabase.from('practices').update(row).eq('id', id)
    if (error) console.error('reschedulePractice:', error)
    return { error }
  }
  const { data: p, error: fetchErr } = await supabase.from('practices').select('series_id,scheduled_at').eq('id', id).single()
  if (fetchErr) { console.error('reschedulePractice:', fetchErr); return { error: fetchErr } }
  if (!p.series_id) {
    const { error } = await supabase.from('practices').update(row).eq('id', id)
    if (error) console.error('reschedulePractice:', error)
    return { error }
  }
  const { data: future, error: futureErr } = await supabase.from('practices').select('id,scheduled_at')
    .eq('series_id', p.series_id).gte('scheduled_at', p.scheduled_at).not('status', 'eq', 'completed')
  if (futureErr) { console.error('reschedulePractice:', futureErr); return { error: futureErr } }
  for (const occ of future || []) {
    const { date: occDate } = scheduledAtToTeamLocal(occ.scheduled_at, timezone)
    const { error } = await supabase.from('practices').update({ location_id: row.location_id, sublocation_id: row.sublocation_id, scheduled_at: teamLocalToScheduledAt(occDate, startTime, timezone), status: 'scheduled' }).eq('id', occ.id)
    if (error) console.error('reschedulePractice:', error)
  }
  return { error: null }
}

// ── Planned absences (§7) -- the coach recording what they were told in
// advance; the historical record of who actually attended lives in
// session_attendance. Persistence into the live run happens by excluding
// these players from AttendanceScreen's default present-set (see
// CommandScreen.jsx) so the normal submitAttendanceSnapshot flow already
// records them absent -- no separate seed/insert, which would race against
// that same snapshot write and get silently overwritten.
export async function fetchPlannedAbsences(practiceIds) {
  if (!practiceIds || !practiceIds.length) return []
  const { data, error } = await supabase.from('planned_absences').select('*').in('practice_id', practiceIds)
  if (error) console.error('fetchPlannedAbsences:', error)
  return data || []
}
// ON CONFLICT DO NOTHING (ignoreDuplicates), not DO UPDATE -- the table
// only grants select/insert/delete to authenticated (no update policy,
// matching the addendum's spec), so a plain upsert would 403.
export async function createPlannedAbsence(practiceId, playerId, notedBy, note) {
  const { error } = await supabase.from('planned_absences').upsert({ practice_id: practiceId, player_id: playerId, noted_by: notedBy, note: note || null }, { onConflict: 'practice_id,player_id', ignoreDuplicates: true })
  if (error) console.error('createPlannedAbsence:', error)
  return { error }
}
export async function deletePlannedAbsence(practiceId, playerId) {
  const { error } = await supabase.from('planned_absences').delete().eq('practice_id', practiceId).eq('player_id', playerId)
  if (error) console.error('deletePlannedAbsence:', error)
  return { error }
}
// "Pick player, pick practice(s)" capture flow -- sets the exact set of
// practices this player is marked out for among the given candidates
// (adds new rows, removes any no longer selected), rather than only adding.
export async function setPlannedAbsences(playerId, notedBy, selectedPracticeIds, candidatePracticeIds, note) {
  const selected = new Set(selectedPracticeIds)
  const toRemove = (candidatePracticeIds || []).filter(id => !selected.has(id))
  if (toRemove.length) await supabase.from('planned_absences').delete().eq('player_id', playerId).in('practice_id', toRemove)
  if (selectedPracticeIds.length) {
    await supabase.from('planned_absences').upsert(
      selectedPracticeIds.map(practiceId => ({ practice_id: practiceId, player_id: playerId, noted_by: notedBy, note: note || null })),
      { onConflict: 'practice_id,player_id', ignoreDuplicates: true }
    )
  }
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

// A genuine network failure (offline, request never reached the server)
// looks identical to a stale-version conflict at the call site otherwise
// (both resolve with data:null) -- but they need opposite handling. A
// conflict means someone else moved the session forward, so refetching is
// correct. A network failure means nothing changed server-side, so
// refetching (which will also fail offline) and blowing away local state
// would blank the coach's screen mid-practice over a momentary signal drop.
// Real Postgrest/PG errors always carry a `code`; a fetch-level failure
// doesn't.
function isNetworkError(error) {
  if (!error) return false
  if (error.code) return false
  const msg = (error.message || '').toLowerCase()
  return msg.includes('fetch') || msg.includes('network') || msg.includes('load failed') || (typeof navigator !== 'undefined' && navigator.onLine === false)
}

// Returns { data, offline }. data is the updated row, or null if the
// version was stale (someone else wrote first / took control) or the
// request never reached the server. offline distinguishes the two --
// caller should only refetch-and-reconcile when offline is false.
export async function updateLiveSession(id, version, patch) {
  try {
    const { data, error } = await supabase.from('practice_live_sessions')
      .update(Object.assign({}, patch, { version: version + 1 }))
      .eq('id', id).eq('version', version).select().maybeSingle()
    if (error) {
      if (!isNetworkError(error)) console.error('updateLiveSession:', error)
      return { data: null, offline: isNetworkError(error) }
    }
    return { data, offline: false }
  } catch (e) {
    return { data: null, offline: true }
  }
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

// expires_at is NOT NULL with no default -- 24h covers same-day overrun
// without leaving a share link valid indefinitely. scope: 'helper_read'
// (follow-along, default) or 'helper_attendance' (also lets the link mark
// players present/absent via submit_helper_attendance).
export async function createHelperShareToken(liveSessionId, createdBy, scope) {
  const { data, error } = await supabase.from('session_access_tokens')
    .insert({ live_session_id: liveSessionId, scope: scope || 'helper_read', created_by: createdBy, expires_at: new Date(Date.now() + 24 * 3600 * 1000).toISOString() })
    .select().single()
  if (error) { console.error('createHelperShareToken:', error); return null }
  return data.id
}

// ── Anon-facing views (coach-authenticated half) ────────────────────────────
// Everything an anonymous helper/preview viewer sees goes through three
// security-definer RPCs (get_preview_view/get_live_session_view/
// submit_helper_attendance) -- deliberately not direct table reads, since
// anon has zero table grants. These wrappers are the coach-authenticated
// side: creating/reusing the preview_sessions + session_access_tokens rows
// those RPCs read from.

// Reuses an existing, not-yet-live preview session for this practice
// (matching the old "don't regenerate the link every time" UX), and reuses
// a still-valid preview-scope token for it rather than minting a new one
// on every Share tap.
export async function findOrCreatePreviewToken(practiceId, createdBy) {
  let { data: existing } = await supabase.from('preview_sessions').select('id')
    .eq('practice_id', practiceId).is('live_session_id', null)
    .order('created_at', { ascending: false }).limit(1).maybeSingle()
  let previewSessionId = existing ? existing.id : null
  if (!previewSessionId) {
    const { data: created, error } = await supabase.from('preview_sessions').insert({ practice_id: practiceId }).select().single()
    if (error) { console.error('findOrCreatePreviewToken:', error); return null }
    previewSessionId = created.id
  }
  const { data: existingToken } = await supabase.from('session_access_tokens').select('id')
    .eq('preview_session_id', previewSessionId).eq('scope', 'preview').is('revoked_at', null)
    .gt('expires_at', new Date().toISOString()).order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (existingToken) return existingToken.id
  const { data: token, error: tErr } = await supabase.from('session_access_tokens')
    .insert({ preview_session_id: previewSessionId, scope: 'preview', created_by: createdBy, expires_at: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString() })
    .select().single()
  if (tErr) { console.error('findOrCreatePreviewToken token:', tErr); return null }
  return token.id
}

// Links a not-yet-live preview session (if one exists for this practice) to
// the live session just created, and mints the helper_read token the
// preview viewer needs to redirect -- see migration
// 20260707220000_preview_view_live_handoff.sql.
export async function linkPreviewToLiveSession(practiceId, liveSessionId) {
  const { error } = await supabase.rpc('link_preview_to_live_session', { p_practice_id: practiceId, p_live_session_id: liveSessionId })
  if (error) console.error('linkPreviewToLiveSession:', error)
}

export async function getPreviewByToken(token) {
  const { data, error } = await supabase.rpc('get_preview_view', { p_token: token })
  if (error) { console.error('getPreviewByToken:', error); return { error: 'request_failed' } }
  return data
}

export async function getLiveSessionByToken(token) {
  const { data, error } = await supabase.rpc('get_live_session_view', { p_token: token })
  if (error) { console.error('getLiveSessionByToken:', error); return { error: 'request_failed' } }
  return data
}

export async function submitHelperAttendanceByToken(token, playerId, status) {
  const { data, error } = await supabase.rpc('submit_helper_attendance', { p_token: token, p_player_id: playerId, p_status: status })
  if (error) { console.error('submitHelperAttendanceByToken:', error); return { error: 'request_failed' } }
  return data
}
