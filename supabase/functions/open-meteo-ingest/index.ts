// Edge Function (Deno) — acquisizione Open-Meteo → Supabase.
// Chiamate ammesse:
//  * pianificate (pg_cron + pg_net) con intestazione x-cron-secret = OPEN_METEO_CRON_SECRET:
//    body {"all_active": true} oppure {"location_id": "<uuid>"};
//  * manuali dall'app con il token dell'utente (ruolo "modifica", limite 10 minuti): body {"location_id": "<uuid>"};
//  * GET: controllo di salute, senza dati né configurazione.
// Pubblicata con --no-verify-jwt: il job pianificato non ha un token utente. L'autenticazione è
// qui: segreto del job confrontato a tempo costante, oppure token dell'utente verificato dal
// database (PostgREST) dentro weather_authorize_manual.
// La logica è in ../_shared/weatherIngest.ts (testata su PGlite). NON eseguita localmente: Deno non installato.
import { createClient } from 'npm:@supabase/supabase-js@2.75.0';
import { authorizeManual, ingestAllActive, ingestLocation, IngestError, type IngestClient } from '../_shared/weatherIngest.ts';

const cors = {
  'access-control-allow-origin': Deno.env.get('ALLOWED_ORIGIN') ?? '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
};
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type': 'application/json' } });
const log = (msg: string) => console.log(msg); // solo identificativi tecnici, esiti e conteggi

function sameSecret(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method === 'GET') return json(200, { servizio: 'open-meteo-ingest', stato: 'attivo' });
  if (req.method !== 'POST') return json(405, { error: 'Metodo non ammesso' });
  let body: { location_id?: string; all_active?: boolean };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: 'JSON non valido' });
  }
  const url = Deno.env.get('SUPABASE_URL')!;
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } }) as unknown as IngestClient;
  const fetchOpts = { timeoutMs: 10_000, retries: 2, baseDelayMs: 750 };

  try {
    const cronSecret = Deno.env.get('OPEN_METEO_CRON_SECRET');
    const given = req.headers.get('x-cron-secret');
    if (given !== null) {
      if (!cronSecret || !sameSecret(given, cronSecret)) return json(401, { error: 'Non autorizzato' });
      if (body.all_active) {
        const results = await ingestAllActive(admin, { fetch: fetchOpts, log });
        const failed = results.filter((r) => r.status === 'errore').length;
        return json(failed ? 207 : 200, { results, completate: results.length - failed, errori: failed });
      }
      if (!body.location_id) return json(400, { error: 'location_id richiesto' });
      return json(200, await ingestLocation(admin, body.location_id, { trigger: 'pianificata', fetch: fetchOpts, log }));
    }

    // richiesta manuale: token dell'utente verificato da Supabase Auth, poi autorizzazione e limite nel database
    const jwt = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
    if (!jwt) return json(401, { error: 'Autenticazione richiesta' });
    if (body.all_active) return json(403, { error: 'Acquisizione completa riservata al job pianificato' });
    if (!body.location_id) return json(400, { error: 'location_id richiesto' });
    const user = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: `Bearer ${jwt}` } }, auth: { persistSession: false } }) as unknown as IngestClient;
    const userId = await authorizeManual(user, body.location_id);
    const summary = await ingestLocation(admin, body.location_id, { trigger: 'manuale', requestedBy: userId, fetch: fetchOpts, log });
    return json(summary.status === 'errore' ? 502 : 200, summary);
  } catch (e) {
    if (e instanceof IngestError) return json(e.status, { error: e.message, code: e.code });
    log(`open-meteo-ingest errore interno ${(e as Error).name}`);
    return json(500, { error: 'Errore interno' });
  }
});
