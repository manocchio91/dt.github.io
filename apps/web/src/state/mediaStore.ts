import { openDB, type IDBPDatabase } from 'idb';
import {
  addYears,
  checkFile,
  DEFAULT_RETENTION_YEARS,
  METADATA_KEPT,
  sha256Bytes,
  stripMetadata,
  type FileCheck,
  type MediaAssociation,
  type MediaCategory,
  type MediaRecord,
} from '@mdt/domain';
import type { SupabaseLike } from './supabase';

/**
 * Archivi per foto e documenti.
 * - LocalMediaStore: IndexedDB del browser (ospite, oppure file in attesa di rete).
 * - SupabaseMediaStore: tabella media_assets + bucket privato project-media.
 * La protezione principale resta lato server (RLS e policy di storage).
 */

export const MEDIA_BUCKET = 'project-media';
export const SIGNED_URL_SECONDS = 60;
export const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' };

export interface PreparedUpload {
  bytes: Uint8Array;
  mime: string;
  sizeBytes: number;
  sha256: string;
  originalName: string;
  metadataRemoved: string[];
  metadataKept: string[];
  metadataStripped: boolean;
}

export interface UploadDetails extends MediaAssociation {
  category: MediaCategory;
  description: string;
  observedOn: string;
  author: string;
  authorId: string | null;
  location: { lat: number; lon: number } | null;
  locationConsent: boolean;
  retentionYears?: number;
}

export type UploadStage = 'controllo' | 'pulizia' | 'registrazione' | 'invio' | 'conferma' | 'fatto';
export const STAGE_LABEL: Record<UploadStage, string> = {
  controllo: 'Controllo del file',
  pulizia: 'Rimozione dei metadati',
  registrazione: 'Registrazione del contesto',
  invio: 'Invio del file',
  conferma: 'Conferma',
  fatto: 'Completato',
};

export class UploadCancelled extends Error {
  constructor() {
    super('Caricamento annullato: nessun file è rimasto sul server.');
    this.name = 'UploadCancelled';
  }
}

export class PartialDeletionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PartialDeletionError';
  }
}

/** Controllo + rimozione metadati + impronta: nessuna rete coinvolta. */
export function prepareUpload(file: { name: string; type: string; size: number }, bytes: Uint8Array, maxBytes?: number): { check: FileCheck; prepared: PreparedUpload | null } {
  const check = checkFile({ name: file.name, size: file.size, declaredMime: file.type, head: bytes.slice(0, 64), maxBytes });
  if (!check.ok || !check.mime) return { check, prepared: null };
  try {
    const s = stripMetadata(bytes, check.mime);
    return {
      check,
      prepared: {
        bytes: s.bytes,
        mime: check.mime,
        sizeBytes: s.bytes.length,
        sha256: sha256Bytes(s.bytes),
        originalName: check.normalizedName,
        metadataRemoved: s.removed,
        metadataStripped: s.stripped,
        metadataKept: [...METADATA_KEPT, ...(s.stripped ? [] : ['metadati interni del PDF (autore, software): non vengono modificati'])],
      },
    };
  } catch (e) {
    return { check: { ...check, ok: false, errors: [`File danneggiato o non leggibile: ${(e as Error).message}`] }, prepared: null };
  }
}

export interface OpenedMedia {
  url: string;
  expiresAt: number | null;
  release(): void;
}

export interface MediaStore {
  readonly kind: 'locale' | 'server';
  list(projectId: string): Promise<MediaRecord[]>;
  upload(p: PreparedUpload, d: UploadDetails, onStage?: (s: UploadStage) => void, signal?: AbortSignal): Promise<MediaRecord>;
  update(r: MediaRecord, patch: Partial<Pick<MediaRecord, 'description' | 'category' | 'observedOn' | 'zoneId' | 'cellId' | 'scenarioId' | 'observationId' | 'workflowStage'>>): Promise<MediaRecord>;
  open(r: MediaRecord): Promise<OpenedMedia>;
  remove(r: MediaRecord): Promise<void>;
}

const today = () => new Date().toISOString().slice(0, 10);

function baseRecord(id: string, p: PreparedUpload, d: UploadDetails): Omit<MediaRecord, 'storage' | 'storagePath' | 'status'> {
  return {
    id,
    organizationId: d.organizationId,
    projectId: d.projectId,
    areaId: d.areaId,
    zoneId: d.zoneId,
    cellId: d.cellId,
    scenarioId: d.scenarioId,
    observationId: d.observationId,
    workflowStage: d.workflowStage,
    category: d.category,
    description: d.description.trim(),
    observedOn: d.observedOn,
    author: d.author.trim(),
    authorId: d.authorId,
    createdAt: new Date().toISOString(),
    mime: p.mime,
    sizeBytes: p.sizeBytes,
    sha256: p.sha256,
    originalName: p.originalName,
    location: d.locationConsent ? d.location : null,
    locationConsent: d.locationConsent && !!d.location,
    metadataRemoved: p.metadataRemoved,
    metadataKept: p.metadataKept,
    retentionUntil: addYears(today(), d.retentionYears ?? DEFAULT_RETENTION_YEARS),
  };
}

// ------------------------------------------------------------------ locale

interface LocalBlob {
  id: string;
  bytes: Uint8Array;
}

export class LocalMediaStore implements MediaStore {
  readonly kind = 'locale' as const;
  private db: Promise<IDBPDatabase>;

  constructor(name = 'mdt-media') {
    this.db = openDB(name, 1, {
      upgrade(db) {
        const r = db.createObjectStore('records', { keyPath: 'id' });
        r.createIndex('projectId', 'projectId');
        db.createObjectStore('blobs', { keyPath: 'id' });
      },
    });
  }

  async list(projectId: string) {
    return ((await (await this.db).getAllFromIndex('records', 'projectId', projectId)) as MediaRecord[]).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async listAll(): Promise<MediaRecord[]> {
    return (await (await this.db).getAll('records')) as MediaRecord[];
  }

  async bytesOf(id: string): Promise<Uint8Array> {
    const b = (await (await this.db).get('blobs', id)) as LocalBlob | undefined;
    if (!b) throw new Error('Contenuto locale non trovato.');
    return b.bytes;
  }

  async upload(p: PreparedUpload, d: UploadDetails, onStage?: (s: UploadStage) => void, signal?: AbortSignal) {
    onStage?.('registrazione');
    if (signal?.aborted) throw new UploadCancelled();
    const rec: MediaRecord = { ...baseRecord(crypto.randomUUID(), p, d), storage: 'locale', storagePath: null, status: 'non_sincronizzato' };
    const db = await this.db;
    const tx = db.transaction(['records', 'blobs'], 'readwrite');
    await Promise.all([tx.objectStore('records').put(rec), tx.objectStore('blobs').put({ id: rec.id, bytes: p.bytes } satisfies LocalBlob), tx.done]);
    onStage?.('fatto');
    return rec;
  }

  async update(r: MediaRecord, patch: Parameters<MediaStore['update']>[1]) {
    const next = { ...r, ...patch };
    await (await this.db).put('records', next);
    return next;
  }

  async open(r: MediaRecord): Promise<OpenedMedia> {
    const bytes = await this.bytesOf(r.id);
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: r.mime }));
    return { url, expiresAt: null, release: () => URL.revokeObjectURL(url) };
  }

  async remove(r: MediaRecord) {
    const db = await this.db;
    const tx = db.transaction(['records', 'blobs'], 'readwrite');
    await Promise.all([tx.objectStore('records').delete(r.id), tx.objectStore('blobs').delete(r.id), tx.done]);
  }
}

// ------------------------------------------------------------------ server

interface Row {
  id: string;
  project_id: string;
  organization_id: string;
  storage_path: string;
  mime: string;
  size_bytes: number;
  sha256: string;
  original_name: string;
  uploaded_by: string;
  author_name: string;
  category: MediaCategory;
  description: string;
  observed_on: string;
  area_ref: string;
  zone_ref: string | null;
  cell_ref: string | null;
  scenario_ref: string | null;
  observation_ref: string | null;
  workflow_stage: MediaRecord['workflowStage'];
  location: unknown;
  location_consent: boolean;
  metadata_removed: string[];
  metadata_kept: string[];
  retention_until: string;
  status: 'caricamento' | 'attivo' | 'eliminazione_in_corso';
  created_at: string;
}

function parseLocation(v: unknown): { lat: number; lon: number } | null {
  if (v && typeof v === 'object' && Array.isArray((v as { coordinates?: unknown }).coordinates)) {
    const [lon, lat] = (v as { coordinates: [number, number] }).coordinates;
    return { lat, lon };
  }
  return null;
}

export function rowToRecord(r: Row): MediaRecord {
  return {
    id: r.id,
    organizationId: r.organization_id,
    projectId: r.project_id,
    areaId: r.area_ref,
    zoneId: r.zone_ref,
    cellId: r.cell_ref,
    scenarioId: r.scenario_ref,
    observationId: r.observation_ref,
    workflowStage: r.workflow_stage,
    category: r.category,
    description: r.description,
    observedOn: r.observed_on,
    author: r.author_name,
    authorId: r.uploaded_by,
    createdAt: r.created_at,
    mime: r.mime,
    sizeBytes: r.size_bytes,
    sha256: r.sha256,
    originalName: r.original_name,
    storage: 'server',
    storagePath: r.storage_path,
    location: parseLocation(r.location),
    locationConsent: r.location_consent,
    metadataRemoved: r.metadata_removed ?? [],
    metadataKept: r.metadata_kept ?? [],
    retentionUntil: r.retention_until,
    status: r.status,
  };
}

const msg = (e: { message: string } | null | undefined, fallback: string) => (e ? `${fallback}: ${e.message}` : fallback);

export class SupabaseMediaStore implements MediaStore {
  readonly kind = 'server' as const;

  constructor(
    private readonly client: SupabaseLike,
    readonly organizationId: string,
    private readonly userId: string,
  ) {}

  async list(projectId: string) {
    const { data, error } = await this.client.from('media_assets').select('*').eq('project_id', projectId);
    if (error) throw new Error(msg(error, 'Elenco dei file non disponibile'));
    return ((data ?? []) as Row[]).map(rowToRecord).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async upload(p: PreparedUpload, d: UploadDetails, onStage?: (s: UploadStage) => void, signal?: AbortSignal) {
    const id = crypto.randomUUID();
    const rec = baseRecord(id, p, { ...d, organizationId: this.organizationId, authorId: this.userId });
    const path = `${this.organizationId}/${d.projectId}/${id}.${EXT[p.mime]}`;
    let rowCreated = false;
    let objectSent = false;
    const cleanup = async () => {
      if (objectSent) await this.client.storage.from(MEDIA_BUCKET).remove([path]);
      if (rowCreated) await this.client.from('media_assets').delete().eq('id', id);
    };
    try {
      onStage?.('registrazione');
      if (signal?.aborted) throw new UploadCancelled();
      const { error: e1 } = await this.client.from('media_assets').insert({
        id,
        project_id: d.projectId,
        organization_id: this.organizationId,
        storage_path: path,
        mime: p.mime,
        size_bytes: p.sizeBytes,
        sha256: p.sha256,
        original_name: p.originalName,
        uploaded_by: this.userId,
        author_name: rec.author,
        category: rec.category,
        description: rec.description,
        observed_on: rec.observedOn,
        area_ref: rec.areaId,
        zone_ref: rec.zoneId,
        cell_ref: rec.cellId,
        scenario_ref: rec.scenarioId,
        observation_ref: rec.observationId,
        workflow_stage: rec.workflowStage,
        location: rec.location ? `SRID=4326;POINT(${rec.location.lon} ${rec.location.lat})` : null,
        location_consent: rec.locationConsent,
        metadata_removed: rec.metadataRemoved,
        metadata_kept: rec.metadataKept,
      });
      if (e1) throw new Error(msg(e1, 'Il server ha rifiutato il file'));
      rowCreated = true;

      onStage?.('invio');
      if (signal?.aborted) throw new UploadCancelled();
      const { error: e2 } = await this.client.storage
        .from(MEDIA_BUCKET)
        .upload(path, new Blob([p.bytes as BlobPart], { type: p.mime }), { contentType: p.mime, upsert: false, cacheControl: 'no-store' });
      if (e2) throw new Error(msg(e2, 'Invio del file non riuscito'));
      objectSent = true;

      onStage?.('conferma');
      if (signal?.aborted) throw new UploadCancelled();
      const { error: e3 } = await this.client.from('media_assets').update({ status: 'attivo' }).eq('id', id);
      if (e3) throw new Error(msg(e3, 'Conferma non riuscita'));
      onStage?.('fatto');
      return { ...rec, organizationId: this.organizationId, storage: 'server' as const, storagePath: path, status: 'attivo' as const };
    } catch (e) {
      try {
        await cleanup();
      } catch {
        /* resta una scheda "in caricamento" visibile solo all'autore: si può riprovare */
      }
      throw e;
    }
  }

  async update(r: MediaRecord, patch: Parameters<MediaStore['update']>[1]) {
    const cols: Record<string, unknown> = {};
    if (patch.description !== undefined) cols.description = patch.description;
    if (patch.category !== undefined) cols.category = patch.category;
    if (patch.observedOn !== undefined) cols.observed_on = patch.observedOn;
    if (patch.zoneId !== undefined) cols.zone_ref = patch.zoneId;
    if (patch.cellId !== undefined) cols.cell_ref = patch.cellId;
    if (patch.scenarioId !== undefined) cols.scenario_ref = patch.scenarioId;
    if (patch.observationId !== undefined) cols.observation_ref = patch.observationId;
    if (patch.workflowStage !== undefined) cols.workflow_stage = patch.workflowStage;
    const { data, error } = await this.client.from('media_assets').update(cols).eq('id', r.id).select('*');
    if (error) throw new Error(msg(error, 'Modifica non salvata'));
    const row = (data as Row[] | null)?.[0];
    if (!row) throw new Error('Modifica non consentita: puoi modificare solo i tuoi contenuti.');
    return rowToRecord(row);
  }

  /** Registra la consultazione e crea un URL firmato di breve durata. */
  async open(r: MediaRecord): Promise<OpenedMedia> {
    const { data: path, error } = await this.client.rpc('log_media_access', { p_media: r.id });
    if (error || !path) throw new Error(msg(error, 'File non disponibile'));
    const { data, error: e2 } = await this.client.storage.from(MEDIA_BUCKET).createSignedUrl(path as string, SIGNED_URL_SECONDS, { download: r.originalName });
    if (e2 || !data) throw new Error(msg(e2, 'Link temporaneo non disponibile'));
    return { url: data.signedUrl, expiresAt: Date.now() + SIGNED_URL_SECONDS * 1000, release: () => {} };
  }

  /** Tre passi: segna in eliminazione → rimuove l'oggetto → rimuove la scheda. Riprende da dove si è interrotta. */
  async remove(r: MediaRecord) {
    if (r.status !== 'eliminazione_in_corso') {
      const { data, error } = await this.client.from('media_assets').update({ status: 'eliminazione_in_corso' }).eq('id', r.id).select('id');
      if (error) throw new Error(msg(error, 'Eliminazione non avviata'));
      if (!data || (data as unknown[]).length === 0) throw new Error('Solo un amministratore può eliminare i file.');
    }
    const { error: e2 } = await this.client.storage.from(MEDIA_BUCKET).remove([r.storagePath!]);
    if (e2) throw new PartialDeletionError('Eliminazione incompleta: il file è nascosto ma non è stato rimosso dallo storage. Riprova.');
    const { data: d3, error: e3 } = await this.client.from('media_assets').delete().eq('id', r.id).select('id');
    if (e3 || !d3 || (d3 as unknown[]).length === 0) {
      throw new PartialDeletionError('Eliminazione incompleta: il file è stato rimosso ma la scheda resta. Riprova per completare.');
    }
  }
}
