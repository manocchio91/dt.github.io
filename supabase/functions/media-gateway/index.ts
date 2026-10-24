// Edge Function (Deno) — gateway dei media: conferma dopo validazione, URL firmati con audit, eliminazione.
// La logica è in ../_shared/mediaGateway.ts ed è testata su Postgres reale (PGlite).
// NON eseguita localmente in questo repository (Deno non installato): da provare su Supabase reale (docs/14).
import { createClient } from 'npm:@supabase/supabase-js@2.75.0';
import { completeUpload, deleteMedia, GatewayError, signedUrl, type GatewayClient } from '../_shared/mediaGateway.ts';

const cors = {
  'access-control-allow-origin': Deno.env.get('ALLOWED_ORIGIN') ?? '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
};
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return json(405, { error: 'Metodo non ammesso' });
  const url = Deno.env.get('SUPABASE_URL')!;
  const jwt = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!jwt) return json(401, { error: 'Autenticazione richiesta' });

  // client con il token dell'utente (RLS e audit) e client di servizio (solo lato server)
  const user = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: `Bearer ${jwt}` } }, auth: { persistSession: false } });
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const { data: who, error: authError } = await admin.auth.getUser(jwt);
  if (authError || !who.user) return json(401, { error: 'Sessione non valida' });

  let body: { action?: string; mediaId?: string; downloadName?: string };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: 'JSON non valido' });
  }
  if (!body.mediaId || !/^[0-9a-f-]{36}$/i.test(body.mediaId)) return json(400, { error: 'mediaId non valido' });

  try {
    const u = user as unknown as GatewayClient;
    const a = admin as unknown as GatewayClient;
    if (body.action === 'complete') return json(200, await completeUpload(u, a, body.mediaId));
    if (body.action === 'sign') return json(200, await signedUrl(u, a, body.mediaId, body.downloadName));
    if (body.action === 'delete') return json(200, await deleteMedia(u, a, body.mediaId));
    return json(400, { error: 'Azione sconosciuta' });
  } catch (e) {
    if (e instanceof GatewayError) return json(e.status, { error: e.message, details: e.details });
    console.error('media-gateway', (e as Error).name); // nessun dato personale nei log
    return json(500, { error: 'Errore interno' });
  }
});
