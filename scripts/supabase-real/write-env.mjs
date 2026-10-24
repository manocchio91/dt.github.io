// Scrive .env.supabase-test (escluso da Git) con URL e chiavi del progetto collegato,
// leggendole dalla CLI già autenticata. Le chiavi non vengono mai stampate.
// Uso: node scripts/supabase-real/write-env.mjs <project-ref>
import { execFileSync } from 'node:child_process';
import { writeFileSync, existsSync } from 'node:fs';

const ref = process.argv[2];
if (!/^[a-z0-9]{20}$/.test(ref ?? '')) {
  console.error('Riferimento del progetto non valido.');
  process.exit(1);
}
const out = execFileSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['supabase', 'projects', 'api-keys', '--project-ref', ref, '-o', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], shell: process.platform === 'win32' });
const keys = JSON.parse(out.slice(out.indexOf('[')));
const pick = (name) => keys.find((k) => k.name === name)?.api_key;
const anon = pick('anon');
const service = pick('service_role');
if (!anon || !service) {
  console.error('Chiavi anon/service_role non trovate nella risposta della CLI.');
  process.exit(1);
}
if (existsSync('.env.supabase-test')) console.log('.env.supabase-test esistente: sovrascritto.');
writeFileSync('.env.supabase-test', [
  '# Generato da scripts/supabase-real/write-env.mjs — NON versionare, NON condividere.',
  `SUPABASE_URL=https://${ref}.supabase.co`,
  `SUPABASE_ANON_KEY=${anon}`,
  `SUPABASE_SERVICE_ROLE_KEY=${service}`,
  'MDT_CONFIRM_TEST_PROJECT=yes',
  '',
].join('\n'), { mode: 0o600 });
console.log(`.env.supabase-test scritto per il progetto ${ref.slice(0, 4)}…: chiavi non mostrate.`);
