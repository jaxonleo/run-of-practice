// Shared .env reader for e2e/ scripts -- same manual-parse pattern as
// scripts/qa_login.mjs (no dotenv dependency in this project).
import fs from 'fs';
import path from 'path';

export function readEnvVar(name) {
  if (process.env[name]) return process.env[name];
  const envPath = path.join(process.cwd(), '.env');
  const env = fs.readFileSync(envPath, 'utf8');
  const m = env.match(new RegExp(`^${name}=(.*)$`, 'm'));
  if (!m) throw new Error(`${name} not found in .env or process.env`);
  return m[1].trim();
}
