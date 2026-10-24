/**
 * Gateway server-side dei media (B-124) e pulizia a fine conservazione (B-125).
 *
 * Logica pura, senza API Deno: l'Edge Function (index.ts) la avvolge, i test la
 * eseguono su Postgres reale (PGlite) con le policy RLS e di storage.
 * Due client:
 * - `user`: porta il JWT dell'utente → RLS, ruoli e audit con l'attore corretto;
 * - `admin`: chiave di servizio → legge i byte, firma gli URL, rimuove gli oggetti.
 * Nessuna scansione antivirus (B-123): il gateway non la dichiara.
 */
import { checkFile, inspectContent, stripMetadata } from './files.ts';

export const BUCKET = 'project-media';
export const SIGNED_SECONDS = 60;

type Err = { message: string; code?: string } | null;
interface QueryLike extends PromiseLike<{ data: unknown; error: Err }> {
  select(cols?: string): QueryLike;
  eq(col: string, v: unknown): QueryLike;
  update(v: Record<string, unknown>): QueryLike;
  delete(): QueryLike;
}
export interface GatewayClient {
  from(table: string): QueryLike;
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: Err }>;
  storage: {
    from(bucket: string): {
      download(path: string): Promise<{ data: Blob | null; error: Err }>;
      remove(paths: string[]): Promise<{ data: unknown; error: Err }>;
      createSignedUrl(path: string, seconds: number, opts?: { download?: string }): Promise<{ data: { signedUrl: string } | null; error: Err }>;
    };
  };
}

export class GatewayError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details: string[] = [],
  ) {
    super(message);
  }
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return Array.from(new Uint8Array(d), (x) => x.toString(16).padStart(2, '0')).join('');
}

const denied = (e: Err) => !!e && (e.code === '42501' || /non autorizzato|amministratore|non disponibile|row-level/i.test(e.message));

/**
 * Esce dalla quarantena solo se i byte reali corrispondono a quanto dichiarato.
 * Idempotente: se il file è già attivo restituisce lo stato attuale.
 */
export async function completeUpload(user: GatewayClient, admin: GatewayClient, mediaId: string) {
  const { data, error } = await user.rpc('media_authorize_complete', { p_media: mediaId });
  if (error) throw new GatewayError(denied(error) ? 403 : 400, error.message);
  const m = data as { status: string; storage_path: string; mime: string; size_bytes: number; sha256: string; original_name: string };
  if (m.status === 'attivo') return { status: 'attivo' as const, idempotent: true };
  if (m.status !== 'caricamento') throw new GatewayError(409, `Stato non valido: ${m.status}`);

  const dl = await admin.storage.from(BUCKET).download(m.storage_path);
  if (dl.error || !dl.data) throw new GatewayError(409, 'Oggetto non ancora presente nello storage: riprova dopo l’invio.');
  const bytes = new Uint8Array(await dl.data.arrayBuffer());

  const reasons: string[] = [];
  const check = checkFile({ name: m.original_name, size: bytes.length, declaredMime: m.mime, head: bytes.slice(0, 64) });
  reasons.push(...check.errors);
  if (check.mime !== m.mime) reasons.push('Il tipo reale del file non corrisponde a quello registrato.');
  if (bytes.length !== m.size_bytes) reasons.push('La dimensione del file non corrisponde a quella registrata.');
  if ((await sha256Hex(bytes)) !== m.sha256) reasons.push('L’impronta SHA-256 non corrisponde: il file è cambiato dopo la registrazione.');
  if (check.mime) {
    reasons.push(...inspectContent(bytes, check.mime));
    try {
      const s = stripMetadata(bytes, check.mime);
      if (s.removed.length) reasons.push(`Il file contiene ancora metadati (${s.removed.join(', ')}): il caricamento non ha seguito la procedura.`);
    } catch (e) {
      reasons.push(`File danneggiato: ${(e as Error).message}`);
    }
  }

  if (reasons.length) {
    // scarto: oggetto e scheda rimossi dal servizio; resta solo l'audit "caricamento_scartato"
    await admin.storage.from(BUCKET).remove([m.storage_path]);
    await admin.from('media_assets').delete().eq('id', mediaId);
    throw new GatewayError(422, 'File rifiutato dalla validazione del server.', reasons);
  }
  const { error: e2 } = await admin
    .from('media_assets')
    .update({ status: 'attivo', validated_at: new Date().toISOString(), validation: { tipo_reale: check.mime, sha256_verificato: true, metadati_assenti: true, antivirus: 'non disponibile' } })
    .eq('id', mediaId);
  if (e2) throw new GatewayError(500, e2.message);
  return { status: 'attivo' as const, idempotent: false };
}

/** Registra la consultazione con il token dell'utente, poi firma con la chiave di servizio. */
export async function signedUrl(user: GatewayClient, admin: GatewayClient, mediaId: string, downloadName?: string) {
  const { data: path, error } = await user.rpc('log_media_access', { p_media: mediaId });
  if (error || !path) throw new GatewayError(denied(error) ? 403 : 404, error?.message ?? 'File non disponibile.');
  const s = await admin.storage.from(BUCKET).createSignedUrl(path as string, SIGNED_SECONDS, downloadName ? { download: downloadName } : undefined);
  if (s.error || !s.data) throw new GatewayError(404, s.error?.message ?? 'Oggetto non trovato.');
  return { signedUrl: s.data.signedUrl, expiresInSeconds: SIGNED_SECONDS };
}

/**
 * Eliminazione amministrativa in tre passi, ripresa in caso di errore parziale:
 * autorizzazione+stato (token utente, audit) → rimozione oggetto → rimozione scheda.
 */
export async function deleteMedia(user: GatewayClient, admin: GatewayClient, mediaId: string) {
  const { data: path, error } = await user.rpc('media_authorize_delete', { p_media: mediaId });
  if (error) throw new GatewayError(denied(error) ? 403 : 400, error.message);
  const r = await admin.storage.from(BUCKET).remove([path as string]);
  if (r.error) throw new GatewayError(503, 'Eliminazione incompleta: lo storage non ha risposto. Il file resta nascosto; riprova.');
  const d = await admin.from('media_assets').delete().eq('id', mediaId).select('id');
  if (d.error) throw new GatewayError(503, 'Eliminazione incompleta: file rimosso, scheda ancora presente. Riprova.');
  return { deleted: true };
}

export interface RetentionReport {
  esaminati: number;
  eliminati: number;
  errori: { id: string; fase: string; messaggio: string }[];
}

/** Pulizia a fine conservazione (da eseguire con la chiave di servizio, es. ogni notte). */
export async function purgeExpired(admin: GatewayClient, today: string): Promise<RetentionReport> {
  const { data, error } = await admin.from('media_assets').select('id, storage_path, status, retention_until');
  if (error) throw new GatewayError(500, error.message);
  // PostgREST restituisce le date come 'AAAA-MM-GG', altri driver come Date: si normalizza prima del confronto
  const day = (v: unknown) => (typeof v === 'string' ? v.slice(0, 10) : new Date(v as string | number | Date).toISOString().slice(0, 10));
  const due = ((data ?? []) as { id: string; storage_path: string; status: string; retention_until: unknown }[]).filter(
    (m) => day(m.retention_until) < today && (m.status === 'attivo' || m.status === 'eliminazione_in_corso'),
  );
  const report: RetentionReport = { esaminati: due.length, eliminati: 0, errori: [] };
  for (const m of due) {
    if (m.status === 'attivo') {
      const u = await admin.from('media_assets').update({ status: 'eliminazione_in_corso' }).eq('id', m.id);
      if (u.error) {
        report.errori.push({ id: m.id, fase: 'stato', messaggio: u.error.message });
        continue;
      }
    }
    const r = await admin.storage.from(BUCKET).remove([m.storage_path]);
    if (r.error) {
      report.errori.push({ id: m.id, fase: 'storage', messaggio: r.error.message });
      continue;
    }
    const d = await admin.from('media_assets').delete().eq('id', m.id);
    if (d.error) {
      report.errori.push({ id: m.id, fase: 'scheda', messaggio: d.error.message });
      continue;
    }
    report.eliminati++;
  }
  return report;
}
