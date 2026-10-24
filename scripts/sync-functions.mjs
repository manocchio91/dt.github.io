// Copia nel codice delle Edge Function i moduli di dominio condivisi (Deno non importa
// file fuori da supabase/functions). Il test functions-sync.test.ts verifica che siano identici.
import { copyFileSync } from 'node:fs';
copyFileSync('packages/domain/src/media/files.ts', 'supabase/functions/_shared/files.ts');
console.log('supabase/functions/_shared/files.ts aggiornato');
