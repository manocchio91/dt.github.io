import { openDB, type IDBPDatabase } from 'idb';
import type { ProjectBundle } from '@mdt/domain';

/**
 * Persistenza M0: IndexedDB locale, dietro un'interfaccia sostituibile da
 * SupabaseRepository in M1. I dati restano nel browser dell'utente.
 */
export interface Repository {
  readonly kind: 'local' | 'supabase';
  list(): Promise<ProjectBundle[]>;
  get(id: string): Promise<ProjectBundle | undefined>;
  save(bundle: ProjectBundle): Promise<void>;
  remove(id: string): Promise<void>;
}

const DB_NAME = 'micro-digital-twin';
const STORE = 'projects';

export class LocalRepository implements Repository {
  readonly kind = 'local' as const;
  private db: Promise<IDBPDatabase>;

  constructor(dbName = DB_NAME) {
    this.db = openDB(dbName, 1, {
      upgrade(db) {
        db.createObjectStore(STORE, { keyPath: 'project.id' });
      },
    });
  }

  async list() {
    return (await (await this.db).getAll(STORE)) as ProjectBundle[];
  }

  async get(id: string) {
    return (await (await this.db).get(STORE, id)) as ProjectBundle | undefined;
  }

  async save(bundle: ProjectBundle) {
    // structuredClone: le baseline congelate vengono salvate come copia
    await (await this.db).put(STORE, structuredClone(bundle));
  }

  async remove(id: string) {
    await (await this.db).delete(STORE, id);
  }
}

/** Repository in memoria: fallback se IndexedDB non è disponibile (es. navigazione privata restrittiva). */
export class MemoryRepository implements Repository {
  readonly kind = 'local' as const;
  private map = new Map<string, ProjectBundle>();
  async list() {
    return [...this.map.values()];
  }
  async get(id: string) {
    return this.map.get(id);
  }
  async save(b: ProjectBundle) {
    this.map.set(b.project.id, structuredClone(b));
  }
  async remove(id: string) {
    this.map.delete(id);
  }
}

export function createRepository(): { repo: Repository; persistent: boolean } {
  try {
    if (typeof indexedDB !== 'undefined') return { repo: new LocalRepository(), persistent: true };
  } catch {
    /* IndexedDB bloccato */
  }
  return { repo: new MemoryRepository(), persistent: false };
}
