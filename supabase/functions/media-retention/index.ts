// Edge Function (Deno) — pulizia a fine conservazione (B-125).
// Da invocare con pianificazione (vedi supabase/sql/schedule-media-retention.sql) usando un segreto dedicato.
// NON eseguita localmente in questo repository: la logica (../_shared/mediaGateway.ts) è testata su PGlite.
import { createClient } from 'npm:@supabase/supabase-js@2.75.0';
import { purgeExpired, type GatewayClient } from '../_shared/mediaGateway.ts';

Deno.serve(async (req) => {
  const secret = Deno.env.get('RETENTION_CRON_SECRET');
  if (!secret || req.headers.get('x-cron-secret') !== secret) return new Response('Non autorizzato', { status: 401 });
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Rome' }).format(new Date());
  const report = await purgeExpired(admin as unknown as GatewayClient, today);
  // il report contiene solo identificativi e fasi, nessun contenuto dei file
  return new Response(JSON.stringify(report), { status: report.errori.length ? 207 : 200, headers: { 'content-type': 'application/json' } });
});
