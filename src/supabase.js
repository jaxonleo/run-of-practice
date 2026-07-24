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
  return { id: p.id, firstName: p.first_name, lastName: p.last_name, jersey: p.jersey_number || '', positions: p.positions || [], bats: p.bats || '', throws: p.throws || '', notes: p.notes || '' }
}
function mapStaffRow(s) {
  return { id: s.id, name: (s.first_name + ' ' + s.last_name).trim(), role: ROLE_LABELS[s.role] || s.role, inviteEmail: s.invite_email, userId: s.user_id, addedBy: s.added_by, welcomedAt: s.welcomed_at, showOnHome: s.show_on_home !== false }
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

  const [focusRes, deactivatedRes] = await Promise.all([
    players.length ? supabase.from('player_focus_areas').select('id, player_id, category_id, note').in('player_id', players.map(p => p.id)) : Promise.resolve({ data: [] }),
    teamIds.length ? supabase.rpc('get_deactivated_staff_user_ids', { p_team_ids: teamIds }) : Promise.resolve({ data: [] }),
  ])
  const focusByPlayer = {}
  for (const fa of focusRes.data || []) {
    if (!fa.category_id) continue
    ;(focusByPlayer[fa.player_id] ||= []).push({ id: fa.id, categoryId: fa.category_id, note: fa.note || '' })
  }
  const deactivatedUserIds = new Set(deactivatedRes.data || [])

  return (teamsRes.data || []).map(t => ({
    id: t.id,
    name: t.name,
    sport: t.sport,
    ownerUserId: t.owner_user_id,
    organizationId: t.organization_id,
    timezone: t.timezone,
    startDate: t.start_date,
    endDate: t.end_date,
    colorPrimary: t.color_primary,
    colorSecondary: t.color_secondary,
    goalsWindowWeeks: t.goals_window_weeks || 4,
    goalsSavedAt: t.goals_saved_at,
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

export async function createPlayer(teamId, { firstName, lastName, jersey, positions, bats, throws, notes }) {
  const { error } = await supabase.from('players').insert({ team_id: teamId, first_name: firstName, last_name: lastName || '', jersey_number: jersey || null, positions: positions || [], bats: bats || null, throws: throws || null, notes: notes || null })
  if (error) console.error('createPlayer:', error)
  return { error }
}
export async function updatePlayer(id, { firstName, lastName, jersey, positions, bats, throws, notes }) {
  const { error } = await supabase.from('players').update({ first_name: firstName, last_name: lastName || '', jersey_number: jersey || null, positions: positions || [], bats: bats || null, throws: throws || null, notes: notes || null }).eq('id', id)
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
export async function removePlayerFocusArea(id) {
  const { error } = await supabase.from('player_focus_areas').delete().eq('id', id)
  if (error) console.error('removePlayerFocusArea:', error)
  return { error }
}
// One row per (player, skill category) holds that category's freeform
// note -- Shooting gets one note, not a separate one under each of
// Form/Mechanics, Catch-and-Shoot, Off the Dribble and Free Throws.
// Called on every edit rather than a separate add-then-edit step;
// clearing the text back to empty deletes the row instead of leaving a
// blank one behind.
export async function setPlayerCategoryNote(playerId, categoryId, note, createdBy, existingId) {
  const trimmed = (note || '').trim()
  if (!trimmed) {
    if (existingId) await removePlayerFocusArea(existingId)
    return { error: null }
  }
  const { error } = await supabase.from('player_focus_areas').upsert({ player_id: playerId, category_id: categoryId, note: trimmed, created_by: createdBy }, { onConflict: 'player_id,category_id' })
  if (error) console.error('setPlayerCategoryNote:', error)
  return { error }
}

export async function createStaff(teamId, { name, role, inviteEmail }) {
  const { firstName, lastName } = splitName(name)
  const { error } = await supabase.rpc('add_team_staff', { p_team_id: teamId, p_email: inviteEmail, p_first_name: firstName, p_last_name: lastName, p_role: ROLE_VALUES[role] || 'assistant_coach' })
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
export async function markTeamStaffWelcomed(teamStaffId) {
  const { error } = await supabase.rpc('mark_team_staff_welcomed', { p_team_staff_id: teamStaffId })
  if (error) console.error('markTeamStaffWelcomed:', error)
  return { error }
}
export async function leaveTeam(teamId) {
  const { error } = await supabase.rpc('leave_team', { p_team_id: teamId })
  if (error) console.error('leaveTeam:', error)
  return { error }
}
// Personal Home-agenda visibility only -- narrow, self-row-only RPC (see
// migration comment), not an access-control change.
export async function setTeamStaffShowOnHome(teamStaffId, show) {
  const { error } = await supabase.rpc('set_team_staff_show_on_home', { p_team_staff_id: teamStaffId, p_show: show })
  if (error) console.error('setTeamStaffShowOnHome:', error)
  return { error }
}
// §5: staff the current user has already added on their OTHER teams, so
// they can tap-to-fill instead of re-typing. Deduped by email; excludes
// the team currently being added to.
// §6: getting-started checklist's last derived step -- has this coach ever
// completed a live session, across any of their teams' practices.
export async function hasCompletedSession(practiceIds) {
  if (!practiceIds || !practiceIds.length) return false
  const { data, error } = await supabase.from('practice_live_sessions').select('id').eq('status', 'completed').in('practice_id', practiceIds).limit(1)
  if (error) { console.error('hasCompletedSession:', error); return false }
  return (data || []).length > 0
}
// Per-practice run state, derived from practice_live_sessions rather than
// stored on the practice itself -- lets History/"already ran" treatment be
// date-agnostic (a practice run this morning counts immediately, not just
// after midnight) and distinguishes a session that finished from one that
// was started and left running/abandoned (no live session row at all means
// it was truly never run). One query per set of practice ids, not per-row.
export async function fetchPracticeRunStatus(practiceIds) {
  if (!practiceIds || !practiceIds.length) return {}
  const { data, error } = await supabase.from('practice_live_sessions').select('practice_id,status').in('practice_id', practiceIds)
  if (error) { console.error('fetchPracticeRunStatus:', error); return {} }
  const out = {}
  for (const row of data || []) {
    if (row.status === 'completed') out[row.practice_id] = 'completed'
    else if (out[row.practice_id] !== 'completed') out[row.practice_id] = 'started'
  }
  return out
}
export async function fetchStaffSuggestions(coachId, excludeTeamId) {
  const { data, error } = await supabase.from('team_staff').select('first_name, last_name, invite_email, team_id').eq('added_by', coachId).not('invite_email', 'is', null)
  if (error) { console.error('fetchStaffSuggestions:', error); return [] }
  const seen = new Set(), out = []
  for (const r of data || []) {
    if (r.team_id === excludeTeamId) continue
    const email = (r.invite_email || '').toLowerCase()
    if (!email || seen.has(email)) continue
    seen.add(email)
    out.push({ name: (r.first_name + ' ' + r.last_name).trim(), email: r.invite_email })
  }
  return out
}

// ── Library (assets, skill tags, drills, sharing) ─────────────────────────────
const EQUIP_TYPE_TO_OLD = { team_equipment: 'team', player_gear: 'player' }
const OLD_TO_EQUIP_TYPE = { team: 'team_equipment', player: 'player_gear' }

// locationIds empty = travels everywhere (no location restriction); one or
// more = only available at those locations.
function mapAssetRow(a, locationsByAsset) {
  return { id: a.id, name: a.name, type: EQUIP_TYPE_TO_OLD[a.type] || a.type, sport: a.sport, organizationId: a.organization_id, ownerUserId: a.owner_user_id, sourceCatalogId: a.source_catalog_id, locationIds: (locationsByAsset && locationsByAsset[a.id]) || [] }
}
function mapSkillTagRow(t) {
  return { id: t.id, categoryId: t.category_id, scope: t.scope, organizationId: t.organization_id, ownerUserId: t.owner_user_id, name: t.name }
}
function mapDrillRow(a, equipmentByDrill, tagsByDrill, sharesByDrill) {
  return {
    id: a.id, name: a.name, sport: a.sport,
    duration: a.duration_minutes || 10, description: a.description || '', coachingPoints: a.coaching_points || '',
    grouping: a.grouping || 'whole', numGroups: a.num_groups || 2,
    organizationId: a.organization_id, ownerUserId: a.owner_user_id, sharedWithOrganizationIds: (sharesByDrill && sharesByDrill[a.id]) || [],
    sourceCatalogId: a.source_catalog_id,
    updatedAt: a.updated_at, position: a.position || 0,
    equipment: equipmentByDrill[a.id] || [],
    skillTagIds: tagsByDrill[a.id] || [],
  }
}
function mapCatalogRow(c) {
  return { id: c.id, name: c.name, sport: c.sport, publisherName: c.publisher_name, organizationName: c.organization_name, publisherType: c.publisher_type, visibility: c.visibility, description: c.description }
}

export async function fetchLibraryData() {
  const [assetsRes, categoriesRes, tagsRes, drillsRes, equipRes, drillTagsRes, orgsRes, profilesRes, catalogsRes, drillSharesRes, assetLocationsRes] = await Promise.all([
    supabase.from('assets').select('*').is('archived_at', null),
    supabase.from('skill_categories').select('*').is('archived_at', null),
    supabase.from('skill_tags').select('*').is('archived_at', null),
    supabase.from('activity_library').select('*').is('archived_at', null).order('position'),
    supabase.from('activity_library_equipment').select('*'),
    supabase.from('drill_tags').select('*'),
    supabase.from('org_staff').select('organization_id, role, organizations(id, name, sport, created_at, color)').is('archived_at', null),
    supabase.from('profiles').select('id, email, first_name, last_name'), // own row + org co-members, per RLS
    supabase.from('content_catalogs').select('*').is('archived_at', null),
    supabase.from('activity_library_org_shares').select('activity_library_id, organization_id'),
    supabase.from('asset_locations').select('*'),
  ])
  // Pending org invites (Org Experience handoff Sec 5) -- fetched here too so
  // the existing app-wide refreshLibrary() call is what surfaces "you've
  // been invited" on Home, same as the rest of this function's data.
  const pendingOrgInvites = await fetchPendingOrgInvites()
  if (drillsRes.error) console.error('fetchLibraryData drills:', drillsRes.error)
  if (assetsRes.error) console.error('fetchLibraryData assets:', assetsRes.error)

  const equipmentByDrill = {}
  for (const e of equipRes.data || []) (equipmentByDrill[e.activity_library_id] ||= []).push(e.asset_id)
  const tagsByDrill = {}
  for (const t of drillTagsRes.data || []) (tagsByDrill[t.activity_library_id] ||= []).push(t.skill_tag_id)
  const sharesByDrill = {}
  for (const s of drillSharesRes.data || []) (sharesByDrill[s.activity_library_id] ||= []).push(s.organization_id)
  const profilesById = {}
  for (const p of profilesRes.data || []) profilesById[p.id] = { name: (p.first_name && p.last_name) ? (p.first_name + ' ' + p.last_name) : (p.email || 'A coach') }
  const locationsByAsset = {}
  for (const al of assetLocationsRes.data || []) (locationsByAsset[al.asset_id] ||= []).push(al.location_id)

  return {
    assets: (assetsRes.data || []).map(a => mapAssetRow(a, locationsByAsset)),
    skillCategories: categoriesRes.data || [],
    skillTags: (tagsRes.data || []).map(mapSkillTagRow),
    activityLibrary: (drillsRes.data || []).map(a => mapDrillRow(a, equipmentByDrill, tagsByDrill, sharesByDrill)),
    myOrgs: (orgsRes.data || []).map(m => ({ id: m.organization_id, name: m.organizations ? m.organizations.name : '', role: m.role, sport: m.organizations ? m.organizations.sport : null, createdAt: m.organizations ? m.organizations.created_at : null, color: m.organizations ? m.organizations.color : null })),
    pendingOrgInvites,
    profilesById,
    catalogs: (catalogsRes.data || []).map(mapCatalogRow),
  }
}

export async function createAsset(ownerUserId, { name, sport, type }) {
  const { data, error } = await supabase.from('assets').insert({ name, sport: sport || 'General', type: OLD_TO_EQUIP_TYPE[type] || type || 'team_equipment', owner_user_id: ownerUserId }).select().single()
  if (error) console.error('createAsset:', error)
  return { data: data ? mapAssetRow(data) : null, error }
}
// Founder-admin equivalent of createAsset for public-catalog equipment --
// owned by the catalog (source_catalog_id) instead of a coach, per the
// activity_has_owner/asset_has_owner constraint relaxation (no fake system
// account needed).
export async function createCatalogAsset(catalogId, { name, sport, type }) {
  const { data, error } = await supabase.from('assets').insert({ name, sport: sport || 'General', type: OLD_TO_EQUIP_TYPE[type] || type || 'team_equipment', source_catalog_id: catalogId }).select().single()
  if (error) console.error('createCatalogAsset:', error)
  return { data: data ? mapAssetRow(data) : null, error }
}
// Org-owned counterpart -- assets_insert_manage's RLS
// (can_manage_asset_owned) already permits a director inserting with
// organization_id set directly, no RPC needed.
export async function createOrgAsset(organizationId, { name, sport, type }) {
  const { data, error } = await supabase.from('assets').insert({ name, sport: sport || 'General', type: OLD_TO_EQUIP_TYPE[type] || type || 'team_equipment', organization_id: organizationId }).select().single()
  if (error) console.error('createOrgAsset:', error)
  return { data: data ? mapAssetRow(data) : null, error }
}
export async function updateAsset(id, { name, sport }) {
  const { error } = await supabase.from('assets').update({ name, sport }).eq('id', id)
  if (error) console.error('updateAsset:', error)
  return { error }
}
// Full replace, same as replaceEquipment -- empty locationIds means "travels
// everywhere" (no restriction), matched by simply having no rows.
export async function setAssetLocations(assetId, locationIds) {
  await supabase.from('asset_locations').delete().eq('asset_id', assetId)
  const ids = (locationIds || []).filter(Boolean)
  if (ids.length) {
    const { error } = await supabase.from('asset_locations').insert(ids.map(location_id => ({ asset_id: assetId, location_id })))
    if (error) console.error('setAssetLocations:', error)
  }
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
// Org-owned counterpart -- skill_tags_insert_scoped's RLS already has a
// scope='org' + is_org_admin(organization_id) branch, no RPC needed.
// skill_tag_scope_matches_owner requires owner_user_id null when scope='org'.
export async function createOrgSkillTag(organizationId, { categoryId, name }) {
  const { data, error } = await supabase.from('skill_tags').insert({ category_id: categoryId, scope: 'org', organization_id: organizationId, name }).select().single()
  if (error) console.error('createOrgSkillTag:', error)
  return { data: data ? mapSkillTagRow(data) : null, error }
}
export async function archiveSkillTag(id) {
  const { error } = await supabase.from('skill_tags').update({ archived_at: new Date().toISOString() }).eq('id', id)
  if (error) console.error('archiveSkillTag:', error)
  return { error }
}
// Founder-admin only (RLS: skill_tags_insert_scoped requires is_admin() for
// scope='global') -- shared by every coach, unlike a personal scope='coach' tag.
export async function createGlobalSkillTag({ categoryId, name }) {
  const { data, error } = await supabase.from('skill_tags').insert({ category_id: categoryId, scope: 'global', name }).select().single()
  if (error) console.error('createGlobalSkillTag:', error)
  return { data: data ? mapSkillTagRow(data) : null, error }
}
// skill_categories: curated taxonomy, admin-only (RLS). archived_at exists
// specifically so "remove" is a soft archive, not a hard delete that would
// cascade-drop every tag underneath.
export async function createSkillCategory({ sport, name, sortOrder }) {
  const { data, error } = await supabase.from('skill_categories').insert({ sport, name, sort_order: sortOrder || 0 }).select().single()
  if (error) console.error('createSkillCategory:', error)
  return { data, error }
}
export async function archiveSkillCategory(id) {
  const { error } = await supabase.from('skill_categories').update({ archived_at: new Date().toISOString() }).eq('id', id)
  if (error) console.error('archiveSkillCategory:', error)
  return { error }
}
// Idempotent (checked server-side) -- safe to call on every sign-in so a
// coach picks up starter tags for any sport/category added after their
// account was created, not just the ones seeded at signup.
export async function ensureDefaultSkillTags(coachId) {
  const { error } = await supabase.rpc('seed_default_skill_tags_for_coach', { p_coach_id: coachId })
  if (error) console.error('ensureDefaultSkillTags:', error)
  return { error }
}

async function syncDrillEquipment(drillId, assetIds) {
  const { data: existing } = await supabase.from('activity_library_equipment').select('id, asset_id').eq('activity_library_id', drillId)
  const existingIds = new Set((existing || []).map(e => e.asset_id))
  const wantIds = new Set(assetIds)
  const toAdd = assetIds.filter(id => !existingIds.has(id))
  const toRemove = (existing || []).filter(e => !wantIds.has(e.asset_id)).map(e => e.id)
  if (toAdd.length) {
    const { error } = await supabase.from('activity_library_equipment').insert(toAdd.map(asset_id => ({ activity_library_id: drillId, asset_id })))
    if (error) { console.error('syncDrillEquipment insert:', error); return { error } }
  }
  if (toRemove.length) {
    const { error } = await supabase.from('activity_library_equipment').delete().in('id', toRemove)
    if (error) { console.error('syncDrillEquipment delete:', error); return { error } }
  }
  return {}
}
// Multiple skill tags per drill: activity_library has no skill_tag_id column
// at all, it's exclusively the drill_tags join table (mirrors player focus
// areas), so this already syncs an arbitrary-length array both ways. What
// was actually silently broken here was errors on the insert/delete going
// unchecked -- a rejected write (RLS, bad id, etc.) looked identical to a
// successful save, so the modal closed as if the tags had persisted.
async function syncDrillTags(drillId, tagIds) {
  const { data: existing } = await supabase.from('drill_tags').select('id, skill_tag_id').eq('activity_library_id', drillId)
  const existingIds = new Set((existing || []).map(e => e.skill_tag_id))
  const wantIds = new Set(tagIds)
  const toAdd = tagIds.filter(id => !existingIds.has(id))
  const toRemove = (existing || []).filter(e => !wantIds.has(e.skill_tag_id)).map(e => e.id)
  if (toAdd.length) {
    const { error } = await supabase.from('drill_tags').insert(toAdd.map(skill_tag_id => ({ activity_library_id: drillId, skill_tag_id })))
    if (error) { console.error('syncDrillTags insert:', error); return { error } }
  }
  if (toRemove.length) {
    const { error } = await supabase.from('drill_tags').delete().in('id', toRemove)
    if (error) { console.error('syncDrillTags delete:', error); return { error } }
  }
  return {}
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
  if (equipment && equipment.length) { const r = await syncDrillEquipment(data.id, equipment); if (r.error) return { data, error: r.error } }
  if (skillTagIds && skillTagIds.length) { const r = await syncDrillTags(data.id, skillTagIds); if (r.error) return { data, error: r.error } }
  return { data }
}
// Drag-to-reorder needs an arbitrary move (index 0 to index 5), not just an
// adjacent swap -- orderedIds is the full new order for whatever subset was
// reordered (e.g. one sport's drills within My Library), positions rewritten
// to match that order's indices.
export async function reorderDrills(orderedIds) {
  await Promise.all(orderedIds.map((id, i) => supabase.from('activity_library').update({ position: i }).eq('id', id)))
}
export async function updateDrill(id, { name, sport, duration, description, coachingPoints, grouping, numGroups, equipment, skillTagIds }) {
  const { error } = await supabase.from('activity_library').update({
    name, sport: sport || 'General', duration_minutes: duration || null,
    description: description || null, coaching_points: coachingPoints || null,
    grouping: grouping || 'whole', num_groups: numGroups || null,
  }).eq('id', id)
  if (error) { console.error('updateDrill:', error); return { error } }
  if (equipment) { const r = await syncDrillEquipment(id, equipment); if (r.error) return { error: r.error } }
  if (skillTagIds) { const r = await syncDrillTags(id, skillTagIds); if (r.error) return { error: r.error } }
  return {}
}
export async function archiveDrill(id) {
  const { error } = await supabase.from('activity_library').update({ archived_at: new Date().toISOString() }).eq('id', id)
  if (error) console.error('archiveDrill:', error)
  return { error }
}
async function nextCatalogDrillPosition(catalogId) {
  const { data } = await supabase.from('activity_library').select('position').eq('source_catalog_id', catalogId).order('position', { ascending: false }).limit(1)
  return data && data.length ? data[0].position + 1 : 0
}
// Founder-admin drill CRUD for public-catalog drills -- same shape as
// createDrill/updateDrill/archiveDrill, but owned by the catalog
// (source_catalog_id) instead of a coach. Reuses syncDrillEquipment/
// syncDrillTags unchanged; RLS (can_link_asset_to_activity/
// can_link_tag_to_activity) restricts these drills to that same catalog's
// own equipment and scope='global' tags only.
export async function createCatalogDrill(catalogId, { name, sport, duration, description, coachingPoints, grouping, numGroups, equipment, skillTagIds }) {
  const position = await nextCatalogDrillPosition(catalogId)
  const { data, error } = await supabase.from('activity_library').insert({
    source_catalog_id: catalogId, name, sport: sport || 'General', duration_minutes: duration || null,
    description: description || null, coaching_points: coachingPoints || null,
    grouping: grouping || 'whole', num_groups: numGroups || null, position,
  }).select().single()
  if (error) { console.error('createCatalogDrill:', error); return { error } }
  if (equipment && equipment.length) { const r = await syncDrillEquipment(data.id, equipment); if (r.error) return { data, error: r.error } }
  if (skillTagIds && skillTagIds.length) { const r = await syncDrillTags(data.id, skillTagIds); if (r.error) return { data, error: r.error } }
  return { data }
}
export async function updateCatalogDrill(id, { name, sport, duration, description, coachingPoints, grouping, numGroups, equipment, skillTagIds }) {
  const { error } = await supabase.from('activity_library').update({
    name, sport: sport || 'General', duration_minutes: duration || null,
    description: description || null, coaching_points: coachingPoints || null,
    grouping: grouping || 'whole', num_groups: numGroups || null,
  }).eq('id', id)
  if (error) { console.error('updateCatalogDrill:', error); return { error } }
  if (equipment) { const r = await syncDrillEquipment(id, equipment); if (r.error) return { error: r.error } }
  if (skillTagIds) { const r = await syncDrillTags(id, skillTagIds); if (r.error) return { error: r.error } }
  return {}
}
export async function archiveCatalogDrill(id) {
  return archiveDrill(id)
}
// Full replace, not a toggle: pass the complete set of org ids this drill
// should be shared with (empty array = make private). A drill can be
// shared into more than one org (a coach may be director of one org while
// coaching a team in another), so this can't be a single id like the old
// single-org column was.
export async function setDrillOrgShares(drillId, organizationIds) {
  const { error } = await supabase.rpc('set_drill_org_shares', { p_drill_ids: [drillId], p_organization_ids: organizationIds || [] })
  if (error) console.error('setDrillOrgShares:', error)
  return { error }
}

export async function promoteDrillToOrgLibrary(drillId, organizationId) {
  const { data, error } = await supabase.rpc('promote_drill_to_org_library', { p_drill_id: drillId, p_organization_id: organizationId })
  if (error) console.error('promoteDrillToOrgLibrary:', error)
  return { data, error }
}

// Copy semantics (addendum, "recurring bug" section): copying a shared drill
// into your own library must NOT reference the sharer's asset rows. Resolve
// by name+type into the recipient's own pool -- match an existing asset, or
// inline-create one, exactly like the "type a new one" picker behavior.
export async function copyDrillToMyLibrary(ownerUserId, sourceDrill, sourceAssetsById, sourceSkillTagsById) {
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
  // Coach/org-scoped tags deliberately not copied -- they'd never transfer
  // meaningfully outside their owner/org. scope='global' tags mean the same
  // thing to every coach, though (public-catalog drills use these
  // exclusively), so those DO copy -- spec §2.5.
  const tagIds = (sourceDrill.skillTagIds || []).filter(id => {
    const t = sourceSkillTagsById && sourceSkillTagsById[id]
    return t && t.scope === 'global'
  })
  if (tagIds.length) await syncDrillTags(created.id, tagIds)
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
    id: l.id, name: l.name, organizationId: l.organization_id, ownerUserId: l.owner_user_id,
    sublocations: (subsRes.data || []).filter(s => s.location_id === l.id).map(s => ({ id: s.id, name: s.name })),
  }))
}
export async function createLocation(ownerUserId, name) {
  const { data, error } = await supabase.from('locations').insert({ owner_user_id: ownerUserId, name }).select().single()
  if (error) console.error('createLocation:', error)
  return { data, error }
}
// Org-owned counterpart -- locations_insert_manage's RLS (can_manage_owned)
// already permits a director inserting with organization_id set directly,
// no RPC needed, same as createOrganization.
export async function createOrgLocation(organizationId, name) {
  const { data, error } = await supabase.from('locations').insert({ organization_id: organizationId, name }).select().single()
  if (error) console.error('createOrgLocation:', error)
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
      coachId: st.team_staff_id || '', helperName: st.helper_name || '', sublocationId: st.sublocation_id || '',
      description: st.description || '',
      coachingPoints: st.coaching_points || '', libraryId: st.library_activity_id || null,
      equipment: stationEquipByStation[st.id] || [], playerGear: '',
      assignments: st.assignments || [], groupLabel: st.group_label || '',
      grouping: st.grouping || 'whole', numGroups: st.num_groups || 2,
    }))
  }
  return base
}

// teamId is optional -- omitted, this fetches every one of the coach's
// practices (Home/My Week's cross-team agenda needs that); passed, it scopes
// the practices query itself to that team (handoff §4.4 "at minimum, scope
// fetchPracticesFull by team" -- the join tables below are still fetched
// unscoped and filtered client-side via actsByPractice, same as before;
// a fully bounded query across every join is flagged as a later gap, not
// required for this milestone).
export async function fetchPracticesFull(teamId) {
  let practicesQuery = supabase.from('practices').select('*').is('archived_at', null)
  if (teamId) practicesQuery = practicesQuery.eq('team_id', teamId)
  const [practicesRes, actsRes, equipRes, itemsRes, blocksRes, stationsRes, stationEquipRes, teamsRes] = await Promise.all([
    practicesQuery,
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
          description: st.description || null,
          coaching_points: st.coachingPoints || null,
          sublocation_id: st.sublocationId || null,
          library_activity_id: st.libraryId || null,
          grouping: st.grouping || 'whole', num_groups: st.numGroups || null,
        }
        if (teamScoped) {
          stRow.team_staff_id = st.coachId || null
          stRow.helper_name = st.coachId ? null : (st.helperName || null)
          stRow.assignments = st.assignments || []
          stRow.group_label = st.groupLabel || null
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
// Tap-to-reassign during a live run: a single-row update to the one
// station, not a full savePracticeTree pass -- that goes through
// saveActivityTree's whole activities/stations/equipment loop, which is
// unnecessary work for changing one field and (more importantly) no
// reason to route through here when nothing about ids, positions, or
// session_groups needs to change. coachId and helperName are mutually
// exclusive -- picking a roster coach clears any freeform helper name and
// vice versa.
export async function updateStationLead(stationId, { coachId, helperName }) {
  const { error } = await supabase.from('stations').update({ team_staff_id: coachId || null, helper_name: coachId ? null : (helperName || null) }).eq('id', stationId)
  if (error) console.error('updateStationLead:', error)
  return { error }
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

// ── Notes (§8) -- captured live during a drill/station or at the end of a
// practice. practiceActivityId + stationId (both optional) record what was
// "current" at note-taking time via real ids, not the old blob's fragile
// name-string match. Fetched on demand per practice (history view, note
// counts) rather than bulk-loaded, unlike the old always-in-memory blob.
export async function fetchNotesForPractice(practiceId) {
  if (!practiceId) return []
  const { data, error } = await supabase.from('notes').select('*').eq('practice_id', practiceId).is('archived_at', null).order('created_at', { ascending: true })
  if (error) { console.error('fetchNotesForPractice:', error); return [] }
  return data.map(n => ({ id: n.id, practiceId: n.practice_id, practiceActivityId: n.practice_activity_id, stationId: n.station_id, text: n.text, createdAt: n.created_at, createdBy: n.created_by }))
}
// Practice-history list rows only need a count, not full note content --
// one query for a whole team's past practices instead of N.
export async function fetchNoteCountsForPractices(practiceIds) {
  if (!practiceIds || !practiceIds.length) return {}
  const { data, error } = await supabase.from('notes').select('practice_id').in('practice_id', practiceIds).is('archived_at', null)
  if (error) { console.error('fetchNoteCountsForPractices:', error); return {} }
  const counts = {}
  for (const row of data || []) counts[row.practice_id] = (counts[row.practice_id] || 0) + 1
  return counts
}
export async function createNote({ practiceId, practiceActivityId, stationId, text, createdBy }) {
  const { data, error } = await supabase.from('notes').insert({
    practice_id: practiceId,
    practice_activity_id: practiceActivityId || null,
    station_id: stationId || null,
    text,
    created_by: createdBy,
  }).select().single()
  if (error) { console.error('createNote:', error); return { error } }
  return { data }
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
      createdAt: t.created_at, updatedAt: t.updated_at, defaultTeamId: t.default_team_id || '',
      durMin: sumMinsLocal(activities), activities,
    }
  })
}
export async function saveTemplateTree(ownerUserId, existingId, { name, sport, locationId, teamId, activities }) {
  const row = { name, sport: sport || 'General', location_id: locationId || null, default_team_id: teamId || null }
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
// stationId is optional -- block-level "who's at which station" groups pass
// none (station_id stays null); a station's own internal partners/groups
// split passes its station id, keeping the two kinds of grouping distinct
// under the same (session, activity) key. roundNumber only matters (and
// only gets stored) alongside a stationId -- a station's occupants change
// every rotation round, so "the latest split for this station" has to be
// scoped to a specific round or it'd resolve to a stale prior round's pairs.
export async function saveSessionGroups(sessionId, practiceActivityId, createdBy, groups, stationId, roundNumber) {
  const rows = groups.map((g, i) => ({ session_id: sessionId, practice_activity_id: practiceActivityId, station_id: stationId || null, round_number: stationId ? (roundNumber ?? 0) : null, group_number: i + 1, created_by: createdBy }))
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

export async function fetchLatestGroups(sessionId, practiceActivityId, stationId, roundNumber) {
  let q = supabase.from('session_groups').select('*').eq('session_id', sessionId).eq('practice_activity_id', practiceActivityId)
  q = stationId ? q.eq('station_id', stationId).eq('round_number', roundNumber ?? 0) : q.is('station_id', null)
  const { data: groups, error } = await q.order('created_at', { ascending: false })
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

// Discards a log row instead of closing it -- used when a jump-navigation
// (Overview list) passed through an activity for under MIN_LOG_MS, so a
// glance while browsing doesn't leave a permanent zero-duration entry in
// Planned vs. Actual.
export async function deleteActivityLog(logId) {
  if (!logId) return
  const { error } = await supabase.from('session_activity_log').delete().eq('id', logId)
  if (error) console.error('deleteActivityLog:', error)
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

export async function submitFeedback(userId, { contactEmail, message, pageContext }) {
  const { error } = await supabase.from('feedback').insert({ user_id: userId, contact_email: contactEmail || null, message, page_context: pageContext || null })
  if (error) console.error('submitFeedback:', error)
  return { error }
}

export async function submitPublicFeedback({ email, message, pageContext }) {
  const { data, error } = await supabase.rpc('submit_public_feedback', { p_email: email, p_message: message, p_page_context: pageContext || null })
  if (error) { console.error('submitPublicFeedback:', error); return { error: 'request_failed' } }
  return data
}

// ── Team goals (ROP-Goals-TeamNav-Handoff.md) ─────────────────────────────────

export async function fetchTeamGoals(teamId) {
  const { data, error } = await supabase.from('team_goals').select('*').eq('team_id', teamId).is('archived_at', null)
  if (error) { console.error('fetchTeamGoals:', error); return [] }
  return (data || []).map(g => ({ id: g.id, teamId: g.team_id, categoryId: g.skill_category_id, targetPct: Number(g.target_pct) }))
}
// Slider-per-category editor (2026-07-19, category-level not tag-level --
// team_goals.skill_category_id, not skill_tag_id): one atomic replace
// instead of N separate row writes. Server-side re-validates the sum
// (0 or 100) so a stale client can't slip a partial save through.
export async function setTeamGoals(teamId, targets) {
  const { error } = await supabase.rpc('set_team_goals', {
    p_team_id: teamId,
    p_targets: targets.map(t => ({ skill_category_id: t.categoryId, target_pct: t.targetPct })),
  })
  if (error) console.error('setTeamGoals:', error)
  return { error }
}
export async function updateGoalsWindowWeeks(teamId, weeks) {
  const { error } = await supabase.from('teams').update({ goals_window_weeks: weeks }).eq('id', teamId)
  if (error) console.error('updateGoalsWindowWeeks:', error)
  return { error }
}
export async function fetchTeamGoalReport(teamId) {
  const { data, error } = await supabase.rpc('get_team_goal_report', { p_team_id: teamId })
  if (error) { console.error('fetchTeamGoalReport:', error); return null }
  return data
}
export async function fetchTeamSessionHistory(teamId) {
  const { data, error } = await supabase.rpc('get_team_session_history', { p_team_id: teamId })
  if (error) { console.error('fetchTeamSessionHistory:', error); return [] }
  return data || []
}
export async function setSessionExclusion(sessionId, excluded) {
  const { error } = await supabase.rpc('set_session_exclusion', { p_session_id: sessionId, p_excluded: excluded })
  if (error) console.error('setSessionExclusion:', error)
  return { error }
}
export async function adjustSessionActivity(logId, startedAt, endedAt) {
  const { error } = await supabase.rpc('adjust_session_activity', { p_log_id: logId, p_started_at: startedAt, p_ended_at: endedAt })
  if (error) console.error('adjustSessionActivity:', error)
  return { error }
}
export async function addSessionActivityRow(sessionId, { practiceActivityId, stationId, startedAt, endedAt }) {
  const { data, error } = await supabase.rpc('add_session_activity_row', {
    p_session_id: sessionId, p_practice_activity_id: practiceActivityId || null, p_station_id: stationId || null,
    p_started_at: startedAt, p_ended_at: endedAt,
  })
  if (error) { console.error('addSessionActivityRow:', error); return { error } }
  return { data: { id: data } }
}
// Real elapsed timing for one completed session's activities, for the
// planned-vs-actual History detail (handoff §5.3) -- this is the first
// frontend read path for session_activity_log's timing columns.
export async function fetchSessionActivityLog(sessionId) {
  const { data, error } = await supabase.from('session_activity_log').select('*').eq('session_id', sessionId).order('started_at')
  if (error) { console.error('fetchSessionActivityLog:', error); return [] }
  return (data || []).map(r => ({
    id: r.id, practiceActivityId: r.practice_activity_id, stationId: r.station_id,
    startedAt: r.started_at, endedAt: r.ended_at, presentPlayerIds: r.present_player_ids || [],
    adjustedAt: r.adjusted_at,
  }))
}

// Founder metrics dashboard (/admin/metrics). checkIsAdmin() is the real
// gate -- the route redirect is UX only, is_admin() is what the RPCs below
// actually enforce server-side.
export async function checkIsAdmin() {
  const { data, error } = await supabase.rpc('is_admin')
  if (error) { console.error('checkIsAdmin:', error); return false }
  return !!data
}
export async function fetchFounderMetricsSummary(weeks) {
  const { data, error } = await supabase.rpc('get_founder_metrics_summary', { p_weeks: weeks })
  if (error) { console.error('fetchFounderMetricsSummary:', error); return null }
  return data
}
export async function fetchFounderMetricsDetail(weeks) {
  const { data, error } = await supabase.rpc('get_founder_metrics_detail', { p_weeks: weeks })
  if (error) { console.error('fetchFounderMetricsDetail:', error); return null }
  return data
}
// admin_users management -- the extensibility path for granting the
// founder-admin right to more users later, no schema change needed.
export async function listAdmins() {
  const { data, error } = await supabase.rpc('list_admins')
  if (error) { console.error('listAdmins:', error); return [] }
  return data || []
}
export async function grantAdmin(email) {
  const { error } = await supabase.rpc('grant_admin', { p_email: email })
  if (error) console.error('grantAdmin:', error)
  return { error }
}
export async function revokeAdmin(userId) {
  const { error } = await supabase.rpc('revoke_admin', { p_user_id: userId })
  if (error) console.error('revokeAdmin:', error)
  return { error }
}
export async function logGoalViewed(teamId) {
  const { error } = await supabase.rpc('log_goal_viewed_event', { p_team_id: teamId })
  if (error) console.error('logGoalViewed:', error)
}

// Org Experience (ROP-Org-Experience-Handoff.md). myOrgs (director
// memberships) already comes back from fetchLibraryData -- these cover the
// rest: pending invites, org-scoped team/staff/player writes, and the
// invite lifecycle. All authorization happens server-side in the RPCs;
// nothing here re-derives a permission check client-side.
// Real bug found live: this had no filter beyond status='pending', so a
// director querying it saw every pending invite for orgs they administer
// (org_invites_select's RLS deliberately allows that, for the *sent*-invites
// list) instead of only invites actually addressed to them -- Jax saw a
// stranger's pending invite on his own Home and its Accept/Decline both
// silently failed, correctly, since the email didn't match his. Narrowed to
// the caller's own verified email, same server-side-truth principle as
// accept/decline_org_invite's own auth.jwt() check.
export async function fetchPendingOrgInvites() {
  const { data: userData } = await supabase.auth.getUser()
  const myEmail = userData && userData.user ? userData.user.email : null
  if (!myEmail) return []
  const { data, error } = await supabase.from('org_invites').select('id, organization_id, team_id, team_role, role, invited_by, created_at, organizations(id, name)').eq('status', 'pending').ilike('email', myEmail)
  if (error) { console.error('fetchPendingOrgInvites:', error); return [] }
  return (data || []).map(i => ({ id: i.id, organizationId: i.organization_id, organizationName: i.organizations ? i.organizations.name : '', teamId: i.team_id, teamRole: i.team_role, role: i.role, invitedBy: i.invited_by, createdAt: i.created_at }))
}
// Org creation itself was never covered by the handoff's RPC list (it's
// entirely upstream of everything org-scoped) -- organizations_insert_self
// already permits a direct authenticated insert (created_by = auth.uid()),
// and handle_new_organization's trigger auto-adds the creator to org_staff
// as director, so a plain insert is enough; no new RPC needed.
export async function createOrganization(coachId, name) {
  const { data, error } = await supabase.from('organizations').insert({ name, created_by: coachId }).select().single()
  if (error) console.error('createOrganization:', error)
  return { data, error }
}
// organizations_update_admin's RLS already permits a director to update
// directly (is_org_admin(id)) -- no RPC needed, same as createOrganization.
export async function updateOrganization(organizationId, { name, sport, color }) {
  const { error } = await supabase.from('organizations').update({ name, sport: sport || null, color: color || null }).eq('id', organizationId)
  if (error) console.error('updateOrganization:', error)
  return { error }
}
export const ORG_ROLE_LABELS = { director: 'Director', admin: 'Admin' }
// Current org_staff membership list (director view) -- profiles_select_org_co_member's
// RLS already lets a fellow org member read these profile rows.
export async function fetchOrgMembers(organizationId) {
  // Real bug found live: org_staff has two FKs to profiles (user_id AND
  // invited_by), so the bare "profiles(...)" embed shorthand was ambiguous
  // -- PostgREST can't tell which relationship to follow, errors, and this
  // silently returned [] every time (explaining why nobody showed up, not
  // just the reporting coach specifically). Disambiguated with the
  // constraint-name hint.
  const { data, error } = await supabase.from('org_staff').select('id, user_id, role, created_at, profiles!org_staff_user_id_fkey(first_name, last_name, email)').eq('organization_id', organizationId).is('archived_at', null).order('created_at')
  if (error) { console.error('fetchOrgMembers:', error); return [] }
  return (data || []).map(m => ({ id: m.id, userId: m.user_id, role: m.role, createdAt: m.created_at, email: m.profiles ? m.profiles.email : '', name: m.profiles ? ((m.profiles.first_name && m.profiles.last_name) ? (m.profiles.first_name + ' ' + m.profiles.last_name) : (m.profiles.email || 'A director')) : 'A director' }))
}
export async function setOrgMemberRole(orgStaffId, role) {
  const { error } = await supabase.rpc('set_org_member_role', { p_org_staff_id: orgStaffId, p_role: role })
  if (error) console.error('setOrgMemberRole:', error)
  return { error }
}
export async function removeOrgMember(orgStaffId) {
  const { error } = await supabase.rpc('remove_org_member', { p_org_staff_id: orgStaffId })
  if (error) console.error('removeOrgMember:', error)
  return { error }
}
// Director's view: every pending invite this org has sent (org_invites_select
// RLS shows these to any is_org_admin of the org, separate from the
// invitee-facing fetchPendingOrgInvites above).
export async function fetchOrgSentInvites(organizationId) {
  const { data, error } = await supabase.from('org_invites').select('id, email, team_id, team_role, role, created_at').eq('organization_id', organizationId).eq('status', 'pending').order('created_at', { ascending: false })
  if (error) { console.error('fetchOrgSentInvites:', error); return [] }
  return (data || []).map(i => ({ id: i.id, email: i.email, teamId: i.team_id, teamRole: i.team_role, role: i.role, createdAt: i.created_at }))
}
export async function orgInviteCoach(organizationId, email, teamId, teamRole, orgRole) {
  const { data, error } = await supabase.rpc('org_invite_coach', { p_organization_id: organizationId, p_email: email, p_team_id: teamId || null, p_team_role: teamRole || null, p_org_role: orgRole || 'director' })
  if (error) console.error('orgInviteCoach:', error)
  return { data, error }
}
export async function acceptOrgInvite(inviteId) {
  const { error } = await supabase.rpc('accept_org_invite', { p_invite_id: inviteId })
  if (error) console.error('acceptOrgInvite:', error)
  return { error }
}
export async function declineOrgInvite(inviteId) {
  const { error } = await supabase.rpc('decline_org_invite', { p_invite_id: inviteId })
  if (error) console.error('declineOrgInvite:', error)
  return { error }
}
// Director-side retraction of an invite that's stuck pending (e.g. the
// notification email never arrived) -- gated on is_org_admin, not the
// invitee's own email, since it's the sender who needs to clear it.
export async function cancelOrgInvite(inviteId) {
  const { error } = await supabase.rpc('cancel_org_invite', { p_invite_id: inviteId })
  if (error) console.error('cancelOrgInvite:', error)
  return { error }
}
export async function orgCreateTeam(organizationId, { name, sport, seasonLabel, startDate, endDate, timezone, colorPrimary, colorSecondary }) {
  const { data, error } = await supabase.rpc('org_create_team', {
    p_organization_id: organizationId, p_name: name, p_sport: sport || 'General',
    p_season_label: seasonLabel || null, p_start_date: startDate || null, p_end_date: endDate || null,
    p_timezone: timezone || null, p_color_primary: colorPrimary || null, p_color_secondary: colorSecondary || null,
  })
  if (error) console.error('orgCreateTeam:', error)
  return { data, error }
}
export async function orgAssignTeamStaff(teamId, userId, role) {
  const { data, error } = await supabase.rpc('org_assign_team_staff', { p_team_id: teamId, p_user_id: userId, p_role: role })
  if (error) console.error('orgAssignTeamStaff:', error)
  return { data, error }
}
export async function orgAssignPlayer(teamId, { firstName, lastName, jerseyNumber, positions }) {
  const { data, error } = await supabase.rpc('org_assign_player', { p_team_id: teamId, p_first_name: firstName, p_last_name: lastName, p_jersey_number: jerseyNumber || null, p_positions: positions || [] })
  if (error) console.error('orgAssignPlayer:', error)
  return { data, error }
}
// Org-wide practices-run rollup for the Org Home page (handoff Sec 4.3) --
// reuses the founder-metrics RPC pattern (weekly counts), scoped to one
// org's teams instead of the whole platform. is_org_member(organizationId)
// gates it, not is_admin().
export async function fetchOrgWeeklyPracticeRollup(organizationId, weeks) {
  const { data, error } = await supabase.rpc('get_org_weekly_practice_rollup', { p_organization_id: organizationId, p_weeks: weeks || 8 })
  if (error) { console.error('fetchOrgWeeklyPracticeRollup:', error); return [] }
  return data || []
}
