// Interrompe la pubblicazione se il bundle del sito contiene una chiave che non deve stare nel
// browser: secret key Supabase (sb_secret_…), JWT con ruolo diverso da "anon" (service_role),
// valori lunghi assegnati a nomi di segreti server. Le chiavi trovate non vengono stampate.
// Uso: node scripts/check-bundle-secrets.mjs <cartella-del-bundle>
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
if (!dir) {
  console.error('Uso: node scripts/check-bundle-secrets.mjs <cartella>');
  process.exit(2);
}
const files = [];
const walk = (d) => {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(js|mjs|css|html|json|map|txt)$/.test(f)) files.push(p);
  }
};
walk(dir);

const problems = [];
for (const f of files) {
  const text = readFileSync(f, 'utf8');
  if (/sb_secret_[A-Za-z0-9_-]{20,}/.test(text)) problems.push(`${f}: secret key Supabase`);
  for (const [jwt] of text.matchAll(/eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g)) {
    try {
      const role = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString('utf8')).role;
      if (role !== 'anon') problems.push(`${f}: JWT con ruolo "${role}"`);
    } catch {
      problems.push(`${f}: JWT non decodificabile`);
    }
  }
  if (/(SERVICE_ROLE_KEY|CRON_SECRET|SERVICE_TOKEN)["']?\s*[:=]\s*["'][^"']{16,}/.test(text)) problems.push(`${f}: valore assegnato a un nome di segreto`);
}
if (problems.length) {
  for (const p of problems) console.error(`::error::${p}`);
  console.error(`Chiavi segrete nel bundle (${problems.length}): pubblicazione interrotta.`);
  process.exit(1);
}
console.log(`Nessuna chiave segreta in ${files.length} file del bundle.`);
