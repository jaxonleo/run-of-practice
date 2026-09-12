// A service-role Supabase client against staging, for e2e specs to verify
// a write actually landed and to clean up whatever they created -- same
// staging-only, no-stray-test-data discipline as every other testing
// convention in this project (BUILD-STATUS.md Working Conventions).
import { createClient } from '@supabase/supabase-js';
import { readEnvVar } from './env.js';

export function stagingAdminClient() {
  const projectRef = readEnvVar('STAGING_PROJECT_REF');
  const serviceRoleKey = readEnvVar('STAGING_SERVICE_ROLE_KEY');
  return createClient(`https://${projectRef}.supabase.co`, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export const QA_HEAD_USER_ID = '01a39a2b-6aaf-42b8-86ed-6b5a619af7ff';
export const QA_WOLVES_TEAM_ID = 'b6fc36ae-dad2-46e7-9226-055800d66151';
