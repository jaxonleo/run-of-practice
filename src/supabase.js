import { createClient } from '@supabase/supabase-js'
const SUPABASE_URL = 'https://bepoojcbizxhqadrytjq.supabase.co'
const SUPABASE_ANON_KEY = 'sb_publishable_z0atQT9uv4_9OZSlGe_awg_d07YcC7v'
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
let _coachKey = null
export function setCoachKey(id) { _coachKey = 'coach_' + id }
let saveTimer = null
export async function getCoaches() {
  try { const { data, error } = await supabase.from('coaches').select('id, name').order('name', { ascending: true }); if (error) return []; return data || [] } catch (e) { return [] }
}
export async function registerCoach(id, name) {
  if (!id || !name) return
  try { const { error } = await supabase.from('coaches').upsert([{ id, name }], { onConflict: 'id' }); if (error) console.error('registerCoach:', error) } catch (e) { console.error(e) }
}
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
