import type { PGlite } from '@electric-sql/pglite';

/**
 * Doppio minimale di supabase-js sopra PGlite: PostgREST (select/insert/update/
 * delete con eq e returning, rpc) e Storage (upload/remove/createSignedUrl sulla
 * tabella storage.objects, quindi con le policy RLS reali).
 * Non riproduce la firma degli URL di Supabase: solo la verifica dei permessi.
 */
type Err = { code?: string; message: string };
type Result = { data: unknown; error: Err | null };

const ident = (s: string) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw new Error(`identificatore non ammesso: ${s}`);
  return s;
};

async function run(db: PGlite, sql: string, params: unknown[]): Promise<{ rows: Record<string, unknown>[] } | { error: Err }> {
  try {
    return { rows: (await db.query<Record<string, unknown>>(sql, params)).rows };
  } catch (e) {
    const err = e as { code?: string; message: string };
    return { error: { code: err.code, message: err.message } };
  }
}

const colList = (cols: string) => (cols.trim() === '*' ? '*' : cols.split(',').map((c) => ident(c.trim())).join(', '));

class Query implements PromiseLike<Result> {
  private filters: [string, unknown][] = [];
  private single = false;
  private op: 'select' | 'delete' | 'insert' | 'update' = 'select';
  private cols = '*';
  private returning: string | null = null;
  private values: Record<string, unknown> = {};

  constructor(
    private db: PGlite,
    private table: string,
  ) {}

  select(cols = '*') {
    if (this.op === 'select') this.cols = cols;
    else this.returning = cols;
    return this;
  }
  insert(v: Record<string, unknown>) {
    this.op = 'insert';
    this.values = v;
    return this;
  }
  update(v: Record<string, unknown>) {
    this.op = 'update';
    this.values = v;
    return this;
  }
  delete() {
    this.op = 'delete';
    return this;
  }
  eq(col: string, val: unknown) {
    this.filters.push([ident(col), val]);
    return this;
  }
  order() {
    return this;
  }
  maybeSingle() {
    this.single = true;
    return this;
  }

  private async exec(): Promise<Result> {
    const params: unknown[] = [];
    const p = (v: unknown) => {
      params.push(v);
      return `$${params.length}`;
    };
    const where = () => (this.filters.length ? ` where ${this.filters.map(([c, v]) => `${c} = ${p(v)}`).join(' and ')}` : '');
    const ret = this.returning ? ` returning ${colList(this.returning)}` : '';
    let sql: string;
    if (this.op === 'select') sql = `select ${colList(this.cols)} from ${ident(this.table)}${where()}`;
    else if (this.op === 'delete') sql = `delete from ${ident(this.table)}${where()}${ret}`;
    else if (this.op === 'insert') {
      const keys = Object.keys(this.values).map(ident);
      sql = `insert into ${ident(this.table)} (${keys.join(', ')}) values (${keys.map((k) => p(this.values[k])).join(', ')})${ret}`;
    } else {
      const sets = Object.keys(this.values)
        .map(ident)
        .map((k) => `${k} = ${p(this.values[k])}`)
        .join(', ');
      sql = `update ${ident(this.table)} set ${sets}${where()}${ret}`;
    }
    const r = await run(this.db, sql, params);
    if ('error' in r) return { data: null, error: r.error };
    if (this.op !== 'select' && !this.returning) return { data: null, error: null };
    return { data: this.single ? (r.rows[0] ?? null) : r.rows, error: null };
  }

  then<A, B>(ok?: ((v: Result) => A | PromiseLike<A>) | null, ko?: ((e: unknown) => B | PromiseLike<B>) | null) {
    return this.exec().then(ok, ko);
  }
}

export interface StorageFaults {
  /** simula un errore dello storage durante la rimozione */
  failRemove?: boolean;
}

export function pgliteClient(db: PGlite, faults: StorageFaults = {}) {
  return {
    from: (table: string) => new Query(db, table),
    async rpc(fn: string, args: Record<string, unknown>): Promise<Result> {
      const keys = Object.keys(args).map(ident);
      const sql = `select public.${ident(fn)}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')}) as r`;
      const r = await run(db, sql, keys.map((k) => (typeof args[k] === 'object' && args[k] !== null ? JSON.stringify(args[k]) : args[k])));
      if ('error' in r) return { data: null, error: r.error };
      return { data: r.rows[0]!.r, error: null };
    },
    storage: {
      from: (bucket: string) => ({
        async upload(path: string): Promise<Result> {
          const r = await run(db, 'insert into storage.objects (bucket_id, name) values ($1, $2)', [bucket, path]);
          return 'error' in r ? { data: null, error: r.error } : { data: { path }, error: null };
        },
        async remove(paths: string[]): Promise<Result> {
          if (faults.failRemove) return { data: null, error: { message: 'Storage non raggiungibile (simulato)' } };
          const r = await run(db, 'delete from storage.objects where bucket_id = $1 and name = any($2) returning name', [bucket, paths]);
          return 'error' in r ? { data: null, error: r.error } : { data: r.rows, error: null };
        },
        async createSignedUrl(path: string, seconds: number): Promise<Result> {
          const r = await run(db, 'select name from storage.objects where bucket_id = $1 and name = $2', [bucket, path]);
          if ('error' in r) return { data: null, error: r.error };
          if (r.rows.length === 0) return { data: null, error: { message: 'Object not found' } };
          return { data: { signedUrl: `https://storage.test/${bucket}/${path}?exp=${Date.now() + seconds * 1000}` }, error: null };
        },
      }),
    },
  };
}
