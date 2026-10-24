import type { SupabaseLike } from './supabase';

/**
 * Archiviazione media per tenant. Percorso: {organization_id}/{project_id}/{uuid}.{ext}
 * (lo stesso verificato dalle policy di storage). I metadati EXIF (inclusa la
 * posizione GPS) vengono rimossi dai JPEG/PNG prima del caricamento.
 */
export const MEDIA_BUCKET = 'project-media';
export const MEDIA_MAX_BYTES = 20 * 1024 * 1024;
export const MEDIA_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function mediaPath(organizationId: string, projectId: string, mime: string, id: string = crypto.randomUUID()): string {
  if (!UUID.test(organizationId) || !UUID.test(projectId)) throw new Error('Organizzazione o progetto non validi.');
  const ext = MEDIA_TYPES[mime];
  if (!ext) throw new Error(`Tipo di file non ammesso: ${mime}`);
  return `${organizationId}/${projectId}/${id}.${ext}`;
}

/** Rimuove i segmenti APP1 (EXIF/XMP) da un JPEG senza ricodificare l'immagine. */
export function stripJpegMetadata(bytes: Uint8Array): Uint8Array {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error('Non è un JPEG valido.');
  const out: number[] = [0xff, 0xd8];
  let i = 2;
  while (i + 4 <= bytes.length) {
    if (bytes[i] !== 0xff) throw new Error('Struttura JPEG non valida.');
    const marker = bytes[i + 1]!;
    if (marker === 0xda) {
      // inizio dei dati compressi: il resto del file si copia così com'è
      for (let k = i; k < bytes.length; k++) out.push(bytes[k]!);
      return Uint8Array.from(out);
    }
    const len = (bytes[i + 2]! << 8) | bytes[i + 3]!;
    if (len < 2 || i + 2 + len > bytes.length) throw new Error('Segmento JPEG troncato.');
    if (marker !== 0xe1) for (let k = i; k < i + 2 + len; k++) out.push(bytes[k]!);
    i += 2 + len;
  }
  return Uint8Array.from(out);
}

/** Rimuove i chunk eXIf, tEXt, iTXt, zTXt da un PNG. */
export function stripPngMetadata(bytes: Uint8Array): Uint8Array {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (!sig.every((b, k) => bytes[k] === b)) throw new Error('Non è un PNG valido.');
  const drop = new Set(['eXIf', 'tEXt', 'iTXt', 'zTXt']);
  const parts: Uint8Array[] = [bytes.slice(0, 8)];
  let i = 8;
  while (i + 12 <= bytes.length) {
    const len = ((bytes[i]! << 24) >>> 0) + (bytes[i + 1]! << 16) + (bytes[i + 2]! << 8) + bytes[i + 3]!;
    const type = String.fromCharCode(bytes[i + 4]!, bytes[i + 5]!, bytes[i + 6]!, bytes[i + 7]!);
    const end = i + 12 + len;
    if (end > bytes.length) throw new Error('Chunk PNG troncato.');
    if (!drop.has(type)) parts.push(bytes.slice(i, end));
    i = end;
  }
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export function stripMetadata(bytes: Uint8Array, mime: string): { bytes: Uint8Array; stripped: boolean } {
  if (mime === 'image/jpeg') return { bytes: stripJpegMetadata(bytes), stripped: true };
  if (mime === 'image/png') return { bytes: stripPngMetadata(bytes), stripped: true };
  return { bytes, stripped: false };
}

export interface UploadedMedia {
  path: string;
  mime: string;
  size: number;
  metadataStripped: boolean;
}

export async function uploadMedia(client: SupabaseLike, organizationId: string, projectId: string, file: File): Promise<UploadedMedia> {
  if (file.size > MEDIA_MAX_BYTES) throw new Error('File oltre 20 MB.');
  const path = mediaPath(organizationId, projectId, file.type);
  const { bytes, stripped } = stripMetadata(new Uint8Array(await file.arrayBuffer()), file.type);
  const { error } = await client.storage.from(MEDIA_BUCKET).upload(path, new Blob([bytes as BlobPart], { type: file.type }), { contentType: file.type, upsert: false });
  if (error) throw new Error(`Caricamento non riuscito: ${error.message}`);
  return { path, mime: file.type, size: bytes.length, metadataStripped: stripped };
}

export async function signedMediaUrl(client: SupabaseLike, path: string, seconds = 300): Promise<string> {
  const { data, error } = await client.storage.from(MEDIA_BUCKET).createSignedUrl(path, seconds);
  if (error || !data) throw new Error('Impossibile generare il link temporaneo.');
  return data.signedUrl;
}

export async function deleteMedia(client: SupabaseLike, path: string): Promise<void> {
  const { data, error } = await client.storage.from(MEDIA_BUCKET).remove([path]);
  if (error) throw new Error(`Eliminazione non riuscita: ${error.message}`);
  if (!data || data.length === 0) throw new Error('Eliminazione non verificata: file inesistente o permesso negato.');
}
