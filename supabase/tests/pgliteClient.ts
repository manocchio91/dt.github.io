import type { PGlite } from '@electric-sql/pglite';
import { actAs, type Actor } from './harness';
import { completeUpload, deleteMedia, GatewayError, signedUrl, type GatewayClient } from '../functions/_shared/mediaGateway.ts';

/**
 * Doppio minimale di supabase-js sopra PGlite: PostgREST (select/insert/update/
 * delete con eq e returning, rpc), Storage (upload/download/remove/createSignedUrl
 * sulla tabella storage.objects, quindi con le policy reali) e functions.invoke
 * instradato verso il gateway media (stesso codice della Edge Function).
 * Ogni client può agire come un attore preciso (utente, servizio, anonimo).
 * Non riproduce la firma crittografica degli URL di Supabase.
 */
type Err = { code?: string; message: string; details?: string | null; hint?: string | null; context?: { status: number; json(): Promise<unknown> } };
type Result = { data: unknown; error: Err | null };

const ident = (s: string) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw new Error(`identificatore non ammesso: ${s}`);
  return s;
};

export interface ClientOptions {
  /** simula un errore dello storage durante la rimozione */
  failRemove?: boolean;
  /** attore con cui eseguire ogni chiamata (default: quello già impostato sulla sessione) */
  as?: Actor;
  /** contenuto degli oggetti (condiviso tra i client dello stesso test) */
  blobs?: Map<string, Uint8Array>;
}
/** compatibilità con i test precedenti */
export type StorageFaults = ClientOptions;

const sharedBlobs = new Map<string, Uint8Array>();

const colList = (cols: string) => (cols.trim() === '*' ? '*' : cols.split(',').map((c) => ident(c.trim())).join(', '));

export function pgliteClient(db: PGlite, opts: ClientOptions = {}) {
  const blobs = opts.blobs ?? sharedBlobs;

  async function run(sql: string, params: unknown[]): Promise<{ rows: Record<string, unknown>[] } | { error: Err }> {
    try {
      if (opts.as) await actAs(db, opts.as);
      return { rows: (await db.query<Record<string, unknown>>(sql, params)).rows };
    } catch (e) {
      const err = e as { code?: string; message: string; detail?: string; hint?: string };
      // come PostgREST: details e hint accanto a code e message
      return { error: { code: err.code, message: err.message, details: err.detail ?? null, hint: err.hint ?? null } };
    }
  }

  class Query implements PromiseLike<Result> {
    private filters: [string, unknown][] = [];
    private single = false;
    private op: 'select' | 'delete' | 'insert' | 'update' = 'select';
    private cols = '*';
    private returning: string | null = null;
    private values: Record<string, unknown> = {};

    constructor(private table: string) {}

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
        params.push(v !== null && typeof v === 'object' && !Array.isArray(v) ? JSON.stringify(v) : v);
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
      const r = await run(sql, params);
      if ('error' in r) return { data: null, error: r.error };
      if (this.op !== 'select' && !this.returning) return { data: null, error: null };
      return { data: this.single ? (r.rows[0] ?? null) : r.rows, error: null };
    }

    then<A, B>(ok?: ((v: Result) => A | PromiseLike<A>) | null, ko?: ((e: unknown) => B | PromiseLike<B>) | null) {
      return this.exec().then(ok, ko);
    }
  }

  const client = {
    from: (table: string) => new Query(table),
    async rpc(fn: string, args: Record<string, unknown>): Promise<Result> {
      const keys = Object.keys(args).map(ident);
      const sql = `select public.${ident(fn)}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')}) as r`;
      const r = await run(sql, keys.map((k) => (typeof args[k] === 'object' && args[k] !== null ? JSON.stringify(args[k]) : args[k])));
      if ('error' in r) return { data: null, error: r.error };
      return { data: r.rows[0]!.r, error: null };
    },
    storage: {
      from: (bucket: string) => ({
        async upload(path: string, body?: Blob | Uint8Array): Promise<Result> {
          const r = await run('insert into storage.objects (bucket_id, name) values ($1, $2)', [bucket, path]);
          if ('error' in r) return { data: null, error: r.error };
          if (body) blobs.set(path, body instanceof Uint8Array ? body : new Uint8Array(await body.arrayBuffer()));
          return { data: { path }, error: null };
        },
        async download(path: string): Promise<{ data: Blob | null; error: Err | null }> {
          const r = await run('select name from storage.objects where bucket_id = $1 and name = $2', [bucket, path]);
          if ('error' in r) return { data: null, error: r.error };
          const b = blobs.get(path);
          if (r.rows.length === 0 || !b) return { data: null, error: { message: 'Object not found' } };
          return { data: new Blob([b as BlobPart]), error: null };
        },
        async remove(paths: string[]): Promise<Result> {
          if (opts.failRemove) return { data: null, error: { message: 'Storage non raggiungibile (simulato)' } };
          const r = await run('delete from storage.objects where bucket_id = $1 and name = any($2) returning name', [bucket, paths]);
          if ('error' in r) return { data: null, error: r.error };
          for (const row of r.rows) blobs.delete(row.name as string);
          return { data: r.rows, error: null };
        },
        async createSignedUrl(path: string, seconds: number): Promise<{ data: { signedUrl: string } | null; error: Err | null }> {
          const r = await run('select name from storage.objects where bucket_id = $1 and name = $2', [bucket, path]);
          if ('error' in r) return { data: null, error: r.error };
          if (r.rows.length === 0) return { data: null, error: { message: 'Object not found' } };
          return { data: { signedUrl: `https://storage.test/${bucket}/${path}?exp=${Date.now() + seconds * 1000}` }, error: null };
        },
      }),
    },
    functions: {
      /** come supabase-js: errori HTTP con `context.status` e `context.json()` */
      async invoke(name: string, { body }: { body: { action: string; mediaId: string; downloadName?: string } }): Promise<Result> {
        if (name !== 'media-gateway') return { data: null, error: { message: `funzione sconosciuta: ${name}` } };
        const user = client as unknown as GatewayClient;
        const admin = pgliteClient(db, { as: 'service', blobs, failRemove: opts.failRemove }) as unknown as GatewayClient;
        // senza attore esplicito: ricorda chi sta usando la sessione per ripristinarlo dopo il gateway
        const saved = opts.as ? null : (await db.query<{ c: string | null; u: string }>(`select current_setting('request.jwt.claims', true) as c, current_user as u`)).rows[0]!;
        const restore = async () => {
          if (opts.as) return actAs(db, opts.as);
          await db.exec('reset role');
          await db.query(`select set_config('request.jwt.claims', $1, false)`, [saved!.c ?? '']);
          if (saved!.u !== 'postgres') await db.exec(`set role ${ident(saved!.u)}`);
        };
        try {
          const data =
            body.action === 'complete'
              ? await completeUpload(user, admin, body.mediaId)
              : body.action === 'sign'
                ? await signedUrl(user, admin, body.mediaId, body.downloadName)
                : await deleteMedia(user, admin, body.mediaId);
          await restore();
          return { data, error: null };
        } catch (e) {
          await restore();
          const g = e instanceof GatewayError ? e : new GatewayError(500, (e as Error).message);
          return { data: null, error: { message: 'Edge Function returned a non-2xx status code', context: { status: g.status, json: async () => ({ error: g.message, details: g.details }) } } };
        }
      },
    },
  };
  return client;
}
