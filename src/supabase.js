import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://bepoojcbizxhqadrytjq.supabase.co'
const SUPABASE_ANON_KEY = 'sb_publishable_z0atQT9uv4_9OZSlGe_awg_d07YcC7v'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

// ── Per-coach data key ────────────────────────────────────────────────────────
let _coachKey = null
export function setCoachKey(id) { _coachKey = 'coach_' + id }

let saveTimer = null

export async function loadData() {
  if (!_coachKey) return null
  try {
    const { data, error } = await supabase
      .from('app_data')
      .select('value')
      .eq('key', _coachKey)
      .maybeSingle()
    if (error) { console.error('loadData error:', error); return null }
    return data ? data.value : null
  } catch (e) {
    console.error('loadData exception:', e)
    return null
  }
}

export async function deleteData() {
  if (!_coachKey) return
  try {
    const { error } = await supabase
      .from('app_data')
      .delete()
      .eq('key', _coachKey)
    if (error) console.error('deleteData error:', error)
    else console.log('Deleted:', _coachKey)
  } catch (e) {
    console.error('deleteData exception:', e)
  }
}

export function saveData(d) {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(async () => {
    if (!_coachKey) return
    try {
      const { error } = await supabase
        .from('app_data')
        .upsert({ key: _coachKey, value: d }, { onConflict: 'key' })
      if (error) console.error('saveData error:', error)
      else console.log('Saved:', _coachKey)
    } catch (e) {
      console.error('saveData exception:', e)
    }
  }, 1500)
}

export function flushSave(d) {
  clearTimeout(saveTimer)
  if (!_coachKey || !d) return
  supabase.from('app_data')
    .upsert({ key: _coachKey, value: d }, { onConflict: 'key' })
    .then(({ error }) => { if (error) console.error('flushSave error:', error) })
}

// ── Live session functions ────────────────────────────────────────────────────
function genSessionId() {
  return Math.random().toString(36).slice(2, 10)
}

export async function createSession(coachId, practiceId, state) {
  const sessionId = genSessionId()
  const { error } = await supabase
    .from('live_sessions')
    .insert({ session_id: sessionId, coach_id: coachId, practice_id: practiceId, state })
  if (error) { console.error('createSession error:', error); return null }
  return sessionId
}

export async function updateSession(sessionId, state) {
  const { error } = await supabase
    .from('live_sessions')
    .update({ state })
    .eq('session_id', sessionId)
  if (error) console.error('updateSession error:', error)
}

export async function endSession(sessionId) {
  const { error } = await supabase
    .from('live_sessions')
    .update({ ended_at: new Date().toISOString() })
    .eq('session_id', sessionId)
  if (error) console.error('endSession error:', error)
}

export async function getSession(sessionId) {
  const { data, error } = await supabase
    .from('live_sessions')
    .select('*')
    .eq('session_id', sessionId)
    .maybeSingle()
  if (error) { console.error('getSession error:', error); return null }
  return data
}

export function subscribeToSession(sessionId, onUpdate) {
  return supabase
    .channel('session_' + sessionId)
    .on('postgres_changes', {
      event: 'UPDATE',
      schema: 'public',
      table: 'live_sessions',
      filter: 'session_id=eq.' + sessionId
    }, payload => { onUpdate(payload.new) })
    .subscribe()
}
