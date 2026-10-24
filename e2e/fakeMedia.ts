import type { Request, Route } from '@playwright/test';

/**
 * Parte "media" del backend Supabase simulato: media_assets, RPC di consultazione
 * e Storage (upload, URL firmati con scadenza, rimozione). Riproduce le regole
 * della migrazione 0004 per le chiamate usate dall'app. NON è Supabase reale.
 */
export type MediaRole = 'viewer' | 'editor' | 'approver' | 'admin';

export interface MediaState {
  media: Record<string, Record<string, unknown>>;
  objects: Map<string, { bytes: Buffer; mime: string }>;
  tokens: Map<string, { path: string; exp: number }>;
  clockOffsetMs: number;
  mediaCalls: string[];
}

export function initialMediaState(): MediaState {
  return { media: {}, objects: new Map(), tokens: new Map(), clockOffsetMs: 0, mediaCalls: [] };
}

const cors = { 'access-control-allow-origin': '*' };
const json = (route: Route, status: number, body: unknown) =>
  route.fulfill({ status, contentType: 'application/json', headers: cors, body: body === undefined ? '' : JSON.stringify(body) });

const eq = (url: URL, k: string) => url.searchParams.get(k)?.replace(/^eq\./, '') ?? null;

/** Estrae il file da una richiesta multipart (supabase-js invia un FormData). */
function filePart(req: Request): { bytes: Buffer; mime: string } {
  const raw = req.postDataBuffer() ?? Buffer.alloc(0);
  const ct = req.headers()['content-type'] ?? '';
  const m = /boundary=(.+)$/.exec(ct);
  if (!m) return { bytes: raw, mime: ct };
  const boundary = Buffer.from(`--${m[1]}`);
  let start = 0;
  while (true) {
    const b = raw.indexOf(boundary, start);
    if (b < 0) break;
    const headEnd = raw.indexOf('\r\n\r\n', b);
    if (headEnd < 0) break;
    const head = raw.subarray(b, headEnd).toString('latin1');
    const next = raw.indexOf(boundary, headEnd);
    const mime = /Content-Type:\s*([^\r\n]+)/i.exec(head)?.[1];
    if (mime && !/text\/plain/.test(mime)) return { bytes: raw.subarray(headEnd + 4, next - 2), mime };
    start = headEnd;
  }
  return { bytes: raw, mime: 'application/octet-stream' };
}

export async function handleMedia(
  route: Route,
  state: MediaState,
  roleIn: (org: string) => MediaRole | undefined,
  userId: string | null,
): Promise<boolean> {
  const req = route.request();
  const url = new URL(req.url());
  const p = url.pathname;
  const method = req.method();
  const now = Date.now() + state.clockOffsetMs;

  // URL firmato: nessuna intestazione di autenticazione, vale solo il token
  if (method === 'GET' && p.startsWith('/storage/v1/object/sign/project-media/')) {
    const path = decodeURIComponent(p.replace('/storage/v1/object/sign/project-media/', ''));
    const t = state.tokens.get(url.searchParams.get('token') ?? '');
    state.mediaCalls.push(`GET sign ${path}`);
    if (!t || t.path !== path) return json(route, 400, { statusCode: '400', error: 'InvalidJWT', message: 'invalid signature' }), true;
    if (t.exp < now) return json(route, 400, { statusCode: '400', error: 'InvalidJWT', message: '"exp" claim timestamp check failed' }), true;
    const obj = state.objects.get(path);
    if (!obj) return json(route, 404, { statusCode: '404', error: 'not_found', message: 'Object not found' }), true;
    await route.fulfill({ status: 200, headers: { ...cors, 'content-type': obj.mime, 'cache-control': 'no-store' }, body: obj.bytes });
    return true;
  }

  const isMedia = p === '/rest/v1/media_assets' || p === '/rest/v1/rpc/log_media_access' || p.startsWith('/storage/v1/object') || p === '/functions/v1/media-gateway';
  if (!isMedia) return false;
  if (!userId) return json(route, 401, { message: 'unauthorized' }), true;
  const row = (id: string | null) => (id ? state.media[id] : undefined);
  const roleOf = (r: Record<string, unknown>) => roleIn(r.organization_id as string);
  const rank = (r?: MediaRole) => (r ? ['viewer', 'editor', 'approver', 'admin'].indexOf(r) : -1);

  if (p === '/rest/v1/media_assets') {
    if (method === 'GET') {
      const pid = eq(url, 'project_id');
      const rows = Object.values(state.media).filter((r) => rank(roleOf(r)) >= 0 && (!pid || r.project_id === pid) && (r.status !== 'caricamento' || r.uploaded_by === userId));
      return json(route, 200, rows), true;
    }
    if (method === 'POST') {
      const v = req.postDataJSON() as Record<string, unknown>;
      state.mediaCalls.push('POST media_assets');
      if (rank(roleIn(v.organization_id as string)) < 1 || v.uploaded_by !== userId) {
        return json(route, 403, { code: '42501', message: 'new row violates row-level security policy for table "media_assets"' }), true;
      }
      state.media[v.id as string] = { ...v, status: 'caricamento', created_at: new Date(now).toISOString(), retention_until: '2031-10-24' };
      return json(route, 201, undefined), true;
    }
    const r = row(eq(url, 'id'));
    if (method === 'PATCH') {
      const v = req.postDataJSON() as Record<string, unknown>;
      state.mediaCalls.push(`PATCH media_assets ${JSON.stringify(v.status ?? 'contesto')}`);
      const allowed = r && ((r.uploaded_by === userId && rank(roleOf(r)) >= 1) || roleOf(r) === 'admin');
      if (!allowed) return json(route, 200, []), true;
      // B-124: l'uscita dalla quarantena è riservata al servizio (gateway)
      if (v.status === 'attivo') return json(route, 400, { message: 'Il file esce dalla quarantena solo dopo la validazione del server.' }), true;
      if (v.status === 'eliminazione_in_corso' && roleOf(r) !== 'admin') return json(route, 400, { message: 'Solo un amministratore può eliminare i file.' }), true;
      Object.assign(r, v);
      return json(route, 200, [r]), true;
    }
    if (method === 'DELETE') {
      state.mediaCalls.push('DELETE media_assets');
      const ok = r && !state.objects.has(r.storage_path as string) && ((r.status === 'eliminazione_in_corso' && roleOf(r) === 'admin') || (r.status === 'caricamento' && r.uploaded_by === userId));
      if (!ok) return json(route, 200, []), true;
      delete state.media[r.id as string];
      return json(route, 200, [r]), true;
    }
  }

  if (p === '/rest/v1/rpc/log_media_access') {
    const { p_media } = req.postDataJSON() as { p_media: string };
    const r = row(p_media);
    state.mediaCalls.push('RPC log_media_access');
    if (!r || r.status !== 'attivo' || rank(roleOf(r)) < 0) return json(route, 403, { code: '42501', message: 'File non disponibile.' }), true;
    return json(route, 200, r.storage_path), true;
  }

  // B-124: i client non firmano più direttamente (nessuna policy di lettura sugli oggetti)
  if (method === 'POST' && p.startsWith('/storage/v1/object/sign/project-media/')) {
    state.mediaCalls.push('SIGN diretta rifiutata');
    return json(route, 400, { statusCode: '404', error: 'not_found', message: 'Object not found' }), true;
  }

  if (method === 'POST' && p === '/functions/v1/media-gateway') {
    const { action, mediaId } = req.postDataJSON() as { action: string; mediaId: string };
    state.mediaCalls.push(`GATEWAY ${action}`);
    const r = row(mediaId);
    if (!r) return json(route, 404, { error: 'File non trovato.' }), true;
    if (action === 'complete') {
      if (r.uploaded_by !== userId || rank(roleOf(r)) < 1) return json(route, 403, { error: 'Non autorizzato.' }), true;
      if (r.status === 'attivo') return json(route, 200, { status: 'attivo', idempotent: true }), true;
      const obj = state.objects.get(r.storage_path as string);
      if (!obj) return json(route, 409, { error: 'Oggetto non presente.' }), true;
      if (obj.bytes.includes(Buffer.from('Exif'))) {
        state.objects.delete(r.storage_path as string);
        delete state.media[mediaId];
        return json(route, 422, { error: 'File rifiutato dalla validazione del server.', details: ['Il file contiene ancora metadati.'] }), true;
      }
      r.status = 'attivo';
      return json(route, 200, { status: 'attivo', idempotent: false }), true;
    }
    if (action === 'sign') {
      if (r.status !== 'attivo' || rank(roleOf(r)) < 0) return json(route, 403, { error: 'File non disponibile.' }), true;
      state.mediaCalls.push('AUDIT consultazione');
      const token = `t${Math.random().toString(36).slice(2)}`;
      const path = r.storage_path as string;
      state.tokens.set(token, { path, exp: now + 60_000 });
      return json(route, 200, { signedUrl: `http://supabase.e2e.test/storage/v1/object/sign/project-media/${path}?token=${token}`, expiresInSeconds: 60 }), true;
    }
    if (action === 'delete') {
      if (roleOf(r) !== 'admin') return json(route, 403, { error: 'Solo un amministratore può eliminare i file.' }), true;
      r.status = 'eliminazione_in_corso';
      state.objects.delete(r.storage_path as string);
      delete state.media[mediaId];
      return json(route, 200, { deleted: true }), true;
    }
    return json(route, 400, { error: 'Azione sconosciuta' }), true;
  }

  if (method === 'POST' && p.startsWith('/storage/v1/object/project-media/')) {
    const path = decodeURIComponent(p.replace('/storage/v1/object/project-media/', ''));
    const r = Object.values(state.media).find((m) => m.storage_path === path);
    state.mediaCalls.push(`UPLOAD ${path}`);
    if (!r || r.status !== 'caricamento' || r.uploaded_by !== userId || rank(roleOf(r)) < 1) {
      return json(route, 400, { statusCode: '403', error: 'Unauthorized', message: 'new row violates row-level security policy' }), true;
    }
    state.objects.set(path, filePart(req));
    return json(route, 200, { Key: `project-media/${path}`, Id: path }), true;
  }

  if (method === 'DELETE' && p === '/storage/v1/object/project-media') {
    const { prefixes } = req.postDataJSON() as { prefixes: string[] };
    const removed: { name: string }[] = [];
    for (const path of prefixes) {
      const r = Object.values(state.media).find((m) => m.storage_path === path);
      const ok = r && ((r.status === 'eliminazione_in_corso' && roleOf(r) === 'admin') || (r.status === 'caricamento' && r.uploaded_by === userId));
      if (ok && state.objects.delete(path)) removed.push({ name: path });
    }
    state.mediaCalls.push(`REMOVE ${removed.length}`);
    return json(route, 200, removed), true;
  }
  return json(route, 404, { message: `media non simulato: ${method} ${p}` }), true;
}
