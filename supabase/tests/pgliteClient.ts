import type { PGlite } from '@electric-sql/pglite';

/**
 * Doppio minimale del client supabase-js (PostgREST) sopra PGlite: copre solo
 * le chiamate usate da SupabaseRepository (select/eq/maybeSingle, delete/eq/select, rpc).
 * Gli errori riportano code e message come PostgREST.
 */
type Result = { data: unknown; error: { code?: string; message: string } | null };

const ident = (s: string) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw new Error(`identificatore non ammesso: ${s}`);
  return s;
};

async function run(db: PGlite, sql: string, params: unknown[]): Promise<{ rows: Record<string, unknown>[] } | { error: Result['error'] }> {
  try {
    return { rows: (await db.query<Record<string, unknown>>(sql, params)).rows };
  } catch (e) {
    const err = e as { code?: string; message: string };
    return { error: { code: err.code, message: err.message } };
  }
}

class Query implements PromiseLike<Result> {
  private filters: [string, unknown][] = [];
  private single = false;
  private op: 'select' | 'delete' = 'select';
  private cols = '*';
  private returning: string | null = null;

  constructor(
    private db: PGlite,
    private table: string,
  ) {}

  select(cols = '*') {
    if (this.op === 'delete') this.returning = cols;
    else this.cols = cols;
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
    const where = this.filters.length ? ` where ${this.filters.map(([c], i) => `${c} = $${i + 1}`).join(' and ')}` : '';
    const params = this.filters.map(([, v]) => v);
    const cols = () => (this.cols === '*' ? '*' : this.cols.split(',').map((c) => ident(c.trim())).join(', '));
    const sql =
      this.op === 'select'
        ? `select ${cols()} from ${ident(this.table)}${where}`
        : `delete from ${ident(this.table)}${where}${this.returning ? ` returning ${this.returning.split(',').map((c) => ident(c.trim())).join(', ')}` : ''}`;
    const r = await run(this.db, sql, params);
    if ('error' in r) return { data: null, error: r.error };
    return { data: this.single ? (r.rows[0] ?? null) : r.rows, error: null };
  }

  then<A, B>(ok?: ((v: Result) => A | PromiseLike<A>) | null, ko?: ((e: unknown) => B | PromiseLike<B>) | null) {
    return this.exec().then(ok, ko);
  }
}

export function pgliteClient(db: PGlite) {
  return {
    from: (table: string) => new Query(db, table),
    async rpc(fn: string, args: Record<string, unknown>): Promise<Result> {
      const keys = Object.keys(args).map(ident);
      const sql = `select public.${ident(fn)}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')}) as r`;
      const r = await run(db, sql, keys.map((k) => (typeof args[k] === 'object' && args[k] !== null ? JSON.stringify(args[k]) : args[k])));
      if ('error' in r) return { data: null, error: r.error };
      return { data: r.rows[0]!.r, error: null };
    },
    storage: {},
  };
}
