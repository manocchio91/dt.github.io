// Edge Function (Deno) — proxy autenticato verso il servizio Timestral (B-131/B-165).
// browser (token di sessione) → questa funzione → services/forecasting (token di servizio) → Supabase.
// Percorso usato dal sito: <SUPABASE_URL>/functions/v1/forecast-proxy/v1/forecast (VITE_FORECAST_URL
// punta a .../functions/v1/forecast-proxy). Senza FORECAST_SERVICE_URL e FORECAST_SERVICE_TOKEN risponde
// 503 "Il modello avanzato non è disponibile": il sito continua con la previsione di base.
// Segreti (mai nel repository): FORECAST_SERVICE_URL, FORECAST_SERVICE_TOKEN; ALLOWED_ORIGIN facoltativo.
// La logica è in ../_shared/forecastProxy.ts (testata su PGlite). NON eseguita localmente: Deno non installato.
import { createClient } from 'npm:@supabase/supabase-js@2.75.0';
import { PROXY_LIMITS, ProxyError, proxyForecast, type ProxyClient, type ProxyRequest } from '../_shared/forecastProxy.ts';

const cors = {
  'access-control-allow-origin': Deno.env.get('ALLOWED_ORIGIN') ?? '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
};
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type': 'application/json' } });
const log = (msg: string) => console.log(msg); // solo identificativi tecnici, esiti e durate

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  const configured = !!(Deno.env.get('FORECAST_SERVICE_URL') && Deno.env.get('FORECAST_SERVICE_TOKEN'));
  if (req.method === 'GET') return json(200, { servizio: 'forecast-proxy', modello_avanzato: configured ? 'configurato' : 'non disponibile' });
  if (req.method !== 'POST' || !new URL(req.url).pathname.endsWith('/v1/forecast')) return json(404, { detail: 'Percorso non trovato' });
  const length = Number(req.headers.get('content-length') ?? '0');
  if (length > PROXY_LIMITS.maxBodyBytes) return json(413, { detail: 'Richiesta troppo grande' });

  const jwt = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!jwt) return json(401, { detail: 'Autenticazione richiesta' });
  const url = Deno.env.get('SUPABASE_URL')!;
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
  const user = createClient(url, anon, { global: { headers: { Authorization: `Bearer ${jwt}` } }, auth: { persistSession: false } });
  const { data: who, error: authErr } = await user.auth.getUser(jwt);
  if (authErr || !who?.user) return json(401, { detail: 'Sessione non valida' });
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

  let body: ProxyRequest;
  try {
    const text = await req.text();
    if (text.length > PROXY_LIMITS.maxBodyBytes) return json(413, { detail: 'Richiesta troppo grande' });
    body = JSON.parse(text);
  } catch {
    return json(400, { detail: 'JSON non valido' });
  }
  try {
    const out = await proxyForecast(
      {
        user: user as unknown as ProxyClient,
        admin: admin as unknown as ProxyClient,
        userId: who.user.id,
        serviceUrl: Deno.env.get('FORECAST_SERVICE_URL'),
        serviceToken: Deno.env.get('FORECAST_SERVICE_TOKEN'),
        timeoutMs: Number(Deno.env.get('FORECAST_TIMEOUT_MS') ?? '60000'),
        log,
      },
      body,
    );
    return json(200, out);
  } catch (e) {
    if (e instanceof ProxyError) return json(e.status, { detail: e.message, code: e.code });
    log(`forecast-proxy errore interno ${(e as Error).name}`);
    return json(500, { detail: 'Errore interno' });
  }
});
