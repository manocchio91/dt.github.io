// Copia nel codice delle Edge Function i moduli di dominio condivisi (Deno non importa
// file fuori da supabase/functions). I test verificano che le copie siano identiche.
import { copyFileSync } from 'node:fs';
const files = [
  ['packages/domain/src/media/files.ts', 'supabase/functions/_shared/files.ts'],
  ['packages/domain/src/connectors/openMeteoForecast.ts', 'supabase/functions/_shared/openMeteoForecast.ts'],
];
for (const [from, to] of files) {
  copyFileSync(from, to);
  console.log(`${to} aggiornato`);
}
