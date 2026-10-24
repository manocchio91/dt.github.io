/**
 * Compatibilità: funzioni di percorso e pulizia metadati.
 * Il caricamento vero e proprio passa da mediaStore.ts (scheda con contesto
 * prima dell'oggetto, come richiesto dalle policy della migrazione 0004).
 */
export { stripJpegMetadata, stripPngMetadata, stripWebpMetadata, stripMetadata } from '@mdt/domain';
export { MEDIA_BUCKET } from './mediaStore';

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
