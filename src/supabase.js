import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://bepoojcbizxhqadrytjq.supabase.co'
const SUPABASE_ANON_KEY = 'sb_publishable_z0atQT9uv4_9OZSlGe_awg_d07YcC7v'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

const KEY = 'cb_data'

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
      console.log('No data in Supabase - using defaults')
      return null
    }
    console.log('Loaded from Supabase')
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
