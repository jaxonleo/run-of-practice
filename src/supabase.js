import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://bepoojcbizxhqadrytjq.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJlcG9vamNiaXp4aHFhZHJ5dGpxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEzNjkzMzQsImV4cCI6MjA5Njk0NTMzNH0.zcOwVhgsne5-igkCONo1g8D7j6-mlRwRaLWXu28mp8Ya'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

const KEY = 'cb_data'

// Debounce saves - wait 800ms after last change before writing
let saveTimer = null

export async function loadData() {
  try {
    const { data, error } = await supabase
      .from('app_data')
      .select('value')
      .eq('key', KEY)
      .maybeSingle()
    if (error) {
      console.error('loadData error:', JSON.stringify(error))
      return null
    }
    if (!data) {
      console.log('No data found in Supabase - using defaults')
      return null
    }
    console.log('Loaded data from Supabase')
    return data.value
  } catch (e) {
    console.error('loadData exception:', e)
    return null
  }
}

export function saveData(d) {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(async () => {
    try {
      const { error } = await supabase
        .from('app_data')
        .upsert({ key: KEY, value: d }, { onConflict: 'key' })
      if (error) {
        console.error('saveData error:', JSON.stringify(error))
      } else {
        console.log('Saved to Supabase')
      }
    } catch (e) {
      console.error('saveData exception:', e)
    }
  }, 800)
}
