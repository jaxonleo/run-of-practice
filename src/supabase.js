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
