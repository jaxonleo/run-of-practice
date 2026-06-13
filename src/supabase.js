import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://bepoojcbizxhqadrytjq.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJlcG9vamNiaXp4aHFhZHJ5dGpxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEzNjkzMzQsImV4cCI6MjA5Njk0NTMzNH0.zcOwVhgsne5-igkCONo1g8D7j6-mlRwRaLWXu28mp8Ya'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

const KEY = 'cb_data'

export async function loadData() {
  try {
    const { data, error } = await supabase
      .from('app_data')
      .select('value')
      .eq('key', KEY)
      .single()
    if (error || !data) return null
    return data.value
  } catch (e) {
    return null
  }
}

export async function saveData(d) {
  try {
    await supabase
      .from('app_data')
      .upsert({ key: KEY, value: d }, { onConflict: 'key' })
  } catch (e) {
    console.error('saveData error', e)
  }
}
