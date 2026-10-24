import type { MediaRecord } from '@mdt/domain';
import type { LocalMediaStore, SupabaseMediaStore } from './mediaStore';

/**
 * Carica sul server file salvati solo nel browser (da ospite o senza rete).
 * Va chiamata soltanto dopo una conferma esplicita dell'utente.
 * I file caricati con successo vengono rimossi dall'archivio locale.
 */
export async function uploadLocalRecords(remote: SupabaseMediaStore, local: LocalMediaStore, records: readonly MediaRecord[], userId: string | null) {
  let ok = 0;
  const failed: string[] = [];
  for (const r of records) {
    try {
      const bytes = await local.bytesOf(r.id);
      await remote.upload(
        { bytes, mime: r.mime, sizeBytes: r.sizeBytes, sha256: r.sha256, originalName: r.originalName, metadataRemoved: r.metadataRemoved, metadataKept: r.metadataKept, metadataStripped: true },
        { ...r, organizationId: remote.organizationId, authorId: userId },
      );
      await local.remove(r);
      ok++;
    } catch (e) {
      failed.push(`${r.originalName}: ${(e as Error).message}`);
    }
  }
  return { ok, failed };
}
