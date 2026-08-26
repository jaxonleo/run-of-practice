// Creates the two persistent QA accounts (ropqa-head / ropqa-asst) and the
// "QA Persistent Wolves" team on a given project. Meant for staging, run
// once per project. Uses the service-role key to bypass RLS, but otherwise
// replicates the app's real creation paths: a plain `teams` insert (which
// fires the on_team_created_add_head_coach trigger for the head coach) and
// a team_staff row for the assistant shaped exactly like accept_team_invite
// would produce.
//
// Usage: PROJECT_REF=<ref> SUPABASE_SERVICE_ROLE_KEY=... node scripts/seed_qa_fixtures.mjs
import { createClient } from '@supabase/supabase-js'

const PROJECT_REF = process.env.PROJECT_REF
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!PROJECT_REF || !SERVICE_ROLE_KEY) {
  console.error('PROJECT_REF and SUPABASE_SERVICE_ROLE_KEY are required in the environment.')
  process.exit(1)
}
const SUPABASE_URL = `https://${PROJECT_REF}.supabase.co`
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })

const HEAD_EMAIL = 'ropqa-head@example.com'
const ASST_EMAIL = 'ropqa-asst@example.com'
const TEAM_NAME = 'QA Persistent Wolves'

async function createCoach(email, firstName, lastName) {
  const { data, error } = await supabase.auth.admin.createUser({ email, email_confirm: true })
  if (error) throw error
  const userId = data.user.id
  const { error: profErr } = await supabase.from('profiles')
    .update({ first_name: firstName, last_name: lastName })
    .eq('id', userId)
  if (profErr) throw profErr
  return userId
}

async function main() {
  console.log(`Creating QA fixtures on ${SUPABASE_URL}...`)

  const headId = await createCoach(HEAD_EMAIL, 'QA', 'Head')
  console.log(`✓ ${HEAD_EMAIL} -> ${headId}`)
  const asstId = await createCoach(ASST_EMAIL, 'QA', 'Assistant')
  console.log(`✓ ${ASST_EMAIL} -> ${asstId}`)

  const { data: team, error: teamErr } = await supabase.from('teams').insert({
    name: TEAM_NAME, sport: 'Basketball', owner_user_id: headId, timezone: 'America/Phoenix',
  }).select().single()
  if (teamErr) throw teamErr
  console.log(`✓ team "${TEAM_NAME}" -> ${team.id} (head_coach team_staff row auto-created by trigger)`)

  const { error: staffErr } = await supabase.from('team_staff').insert({
    team_id: team.id, user_id: asstId, first_name: 'QA', last_name: 'Assistant',
    role: 'assistant_coach', added_by: headId,
  })
  if (staffErr) throw staffErr
  console.log(`✓ ${ASST_EMAIL} added as assistant_coach`)

  console.log('\nDone. Record these in BUILD-STATUS:')
  console.log(`  head coach user id: ${headId}`)
  console.log(`  assistant user id:  ${asstId}`)
  console.log(`  team id:            ${team.id}`)
}

main().catch(err => { console.error(err); process.exit(1) })
