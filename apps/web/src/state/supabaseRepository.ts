import { hashOf, type ProjectBundle } from '@mdt/domain';
import type { Repository } from './repository';
import type { SupabaseLike } from './supabase';

/** Dettagli tecnici del conflitto (mostrati solo espandendo "Dettagli tecnici"). */
export interface ConflictInfo {
  codice: string;
  versioneAttesa: number | null;
  versioneTrovata: number | null;
  aggiornatoIl: string | null;
}

export const CONFLICT_MESSAGE = 'Questo progetto è stato aggiornato da un’altra persona. Ricarica i dati prima di salvare nuovamente.';

export class ConflictError extends Error {
  constructor(readonly info: ConflictInfo = { codice: 'MDT_CONFLITTO_VERSIONE', versioneAttesa: null, versioneTrovata: null, aggiornatoIl: null }) {
    super(CONFLICT_MESSAGE);
    this.name = 'ConflictError';
  }
}

export class PermissionError extends Error {
  constructor(message = 'Operazione non consentita dal tuo ruolo in questa organizzazione.') {
    super(message);
    this.name = 'PermissionError';
  }
}

interface PgError {
  code?: string;
  message: string;
  details?: string | null;
  hint?: string | null;
}

function conflictInfo(e: PgError): ConflictInfo {
  let d: Record<string, unknown> = {};
  try {
    d = e.details ? (JSON.parse(e.details) as Record<string, unknown>) : {};
  } catch {
    d = {};
  }
  const num = (x: unknown) => (typeof x === 'number' ? x : null);
  return {
    codice: typeof d.codice === 'string' ? d.codice : 'MDT_CONFLITTO_VERSIONE',
    versioneAttesa: num(d.versione_attesa),
    versioneTrovata: num(d.versione_trovata),
    aggiornatoIl: typeof d.aggiornato_il === 'string' ? d.aggiornato_il : null,
  };
}

function toError(e: PgError): Error {
  // PT409 (risposta HTTP 409 di PostgREST); 40001 resta riconosciuto per i server non ancora aggiornati
  if (e.code === 'PT409' || e.hint === 'MDT_CONFLITTO_VERSIONE' || e.code === '40001') return new ConflictError(conflictInfo(e));
  if (e.code === '42501' || /row-level security|permission denied/i.test(e.message)) return new PermissionError();
  return new Error(e.message);
}

/**
 * Repository su Supabase: un documento per progetto (ProjectBundle) nella
 * tabella project_documents, salvato con save_project() che applica RLS,
 * concorrenza ottimistica e regole di integrità lato server.
 */
export class SupabaseRepository implements Repository {
  readonly kind = 'supabase' as const;
  private versions = new Map<string, number>();

  constructor(
    private readonly client: SupabaseLike,
    readonly organizationId: string,
  ) {}

  async list(): Promise<ProjectBundle[]> {
    const { data, error } = await this.client
      .from('project_documents')
      .select('project_id, version, bundle')
      .eq('organization_id', this.organizationId);
    if (error) throw toError(error);
    const rows = (data ?? []) as { project_id: string; version: number; bundle: ProjectBundle }[];
    for (const r of rows) this.versions.set(r.project_id, r.version);
    return rows.map((r) => r.bundle);
  }

  async get(id: string): Promise<ProjectBundle | undefined> {
    const { data, error } = await this.client
      .from('project_documents')
      .select('project_id, version, bundle')
      .eq('project_id', id)
      .maybeSingle();
    if (error) throw toError(error);
    if (!data) return undefined;
    const row = data as { project_id: string; version: number; bundle: ProjectBundle };
    this.versions.set(row.project_id, row.version);
    return row.bundle;
  }

  async save(bundle: ProjectBundle): Promise<void> {
    const expected = this.versions.get(bundle.project.id) ?? 0;
    const { data, error } = await this.client.rpc('save_project', {
      p_organization_id: this.organizationId,
      p_bundle: bundle,
      p_bundle_hash: hashOf(bundle),
      p_expected_version: expected,
    });
    if (error) throw toError(error);
    this.versions.set(bundle.project.id, data as number);
  }

  async remove(id: string): Promise<void> {
    const { data, error } = await this.client.from('projects').delete().eq('id', id).select('id');
    if (error) throw toError(error);
    if (!data || (data as unknown[]).length === 0) throw new PermissionError('Solo un amministratore dell’organizzazione può eliminare un progetto.');
    this.versions.delete(id);
  }

  versionOf(id: string): number | undefined {
    return this.versions.get(id);
  }
}
