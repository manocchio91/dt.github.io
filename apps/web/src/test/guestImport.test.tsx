import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SupabaseClient } from '@supabase/supabase-js';
import { finalizeOnboarding, seedCampobasso, seedVineyard, type ProjectBundle } from '@mdt/domain';
import { GuestImport } from '../components/GuestImport';
import { RetentionPanel } from '../components/RetentionPanel';
import { AuthContext, type AuthValue } from '../state/auth';
import { PreferencesProvider } from '../state/preferences';
import { StoreProvider } from '../state/store';
import { LocalRepository, MemoryRepository, type Repository } from '../state/repository';
import { localMediaStore, resetLocalMediaStore } from '../state/useMedia';
import { fakeAuth, fakeSession, member, ORG_A } from './utils';

/** B-121 (importazione su conferma) e B-125 (conservazione per amministratori). */
const TINY = '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';
let n = 0;

function fakeServer() {
  const calls: string[] = [];
  const rows: Record<string, Record<string, unknown>> = {};
  const prefs: Record<string, unknown> = {};
  const from = (table: string) => {
    const q = {
      op: 'select',
      v: {} as Record<string, unknown>,
      f: [] as [string, unknown][],
      ret: false,
      single: false,
      select() {
        if (q.op !== 'select') q.ret = true;
        return q;
      },
      insert(v: Record<string, unknown>) {
        q.op = 'insert';
        q.v = v;
        return q;
      },
      update(v: Record<string, unknown>) {
        q.op = 'update';
        q.v = v;
        return q;
      },
      upsert(v: Record<string, unknown>) {
        q.op = 'upsert';
        q.v = v;
        return q;
      },
      delete() {
        q.op = 'delete';
        return q;
      },
      eq(c: string, v: unknown) {
        q.f.push([c, v]);
        return q;
      },
      maybeSingle() {
        q.single = true;
        return q;
      },
      then(ok: (r: { data: unknown; error: null }) => unknown) {
        calls.push(`${table}:${q.op}`);
        let data: unknown = q.single ? null : [];
        if (table === 'user_preferences' && q.op === 'upsert') prefs[q.v.user_id as string] = q.v.preferences;
        if (table === 'media_assets' && q.op === 'insert') rows[q.v.id as string] = { ...q.v, status: 'caricamento' };
        if (table === 'media_assets' && q.op === 'update') {
          const hit = Object.values(rows).filter((r) => q.f.every(([c, v]) => r[c] === v));
          hit.forEach((r) => Object.assign(r, q.v));
          data = hit;
        }
        return Promise.resolve({ data, error: null }).then(ok);
      },
    };
    return q;
  };
  const client = {
    from,
    rpc: async (fn: string) => {
      calls.push(`rpc:${fn}`);
      if (fn === 'media_expiring') return { data: Object.values(rows).map((r) => ({ id: r.id, retention_until: '2026-11-10' })), error: null };
      return { data: null, error: null };
    },
    functions: {
      invoke: async (_n: string, { body }: { body: { action: string; mediaId: string } }) => {
        calls.push(`gateway:${body.action}`);
        if (rows[body.mediaId]) rows[body.mediaId]!.status = 'attivo';
        return { data: { status: 'attivo' }, error: null };
      },
    },
    storage: { from: () => ({ upload: async () => (calls.push('storage:upload'), { data: {}, error: null }) }) },
  } as unknown as SupabaseClient;
  return { client, calls, rows, prefs };
}

function remoteRepo(bundles: ProjectBundle[]): Repository & { saved: string[] } {
  const base = new MemoryRepository();
  for (const b of bundles) void base.save(b);
  const saved: string[] = [];
  return { kind: 'supabase', saved, list: () => base.list(), get: (id) => base.get(id), save: async (b) => (saved.push(b.project.id), base.save(b)), remove: (id) => base.remove(id) };
}

function renderImport(auth: AuthValue, repo: Repository, guestRepo: LocalRepository) {
  return render(
    <AuthContext.Provider value={auth}>
      <PreferencesProvider>
        <StoreProvider repository={repo} readOnly={auth.current?.role === 'viewer'}>
          <GuestImport repo={guestRepo} />
        </StoreProvider>
      </PreferencesProvider>
    </AuthContext.Provider>,
  );
}

let guestRepo: LocalRepository;
let agri: ProjectBundle;

beforeEach(async () => {
  localStorage.clear();
  resetLocalMediaStore(`mdt-media-import-${++n}`);
  guestRepo = new LocalRepository(`mdt-guest-${n}`);
  agri = seedVineyard(new Date('2026-08-20T08:00:00Z'), '2026-08-20');
  await guestRepo.save(agri);
  await localMediaStore().upload(
    { bytes: Uint8Array.from(atob(TINY), (c) => c.charCodeAt(0)), mime: 'image/jpeg', sizeBytes: 134, sha256: 'a'.repeat(64), originalName: 'ospite.jpg', metadataRemoved: [], metadataKept: [], metadataStripped: true },
    { organizationId: null, projectId: agri.project.id, areaId: agri.area!.id, zoneId: null, cellId: null, scenarioId: null, observationId: null, workflowStage: 'bozza', category: 'foto_sopralluogo', description: 'da ospite', observedOn: '2026-08-19', author: 'Ospite', authorId: null, location: null, locationConsent: false },
  );
  localStorage.setItem(
    'mdt:onboarding:v1',
    JSON.stringify(finalizeOnboarding({ profile: 'agricoltore', sector: 'agriculture', decision: 'zona_da_controllare', area: { kind: 'demo' }, data: [], mode: 'guidata' }, new Date())),
  );
});

describe('B-121 — importazione dei dati da ospite solo su conferma', () => {
  it('mostra cosa è disponibile, non trasferisce nulla da solo, importa solo la selezione', async () => {
    const user = userEvent.setup();
    const s = fakeServer();
    const repo = remoteRepo([seedCampobasso(new Date())]);
    const auth = fakeAuth({ client: s.client, session: fakeSession('u-9'), memberships: [member('editor')], current: member('editor') });
    renderImport(auth, repo, guestRepo);

    await screen.findByText('Dati salvati come ospite in questo browser');
    expect(screen.getByText(/Nulla viene trasferito automaticamente/)).toBeInTheDocument();
    expect(screen.getByText(/Preferenze: Agricoltore o viticoltore/)).toBeInTheDocument();
    expect(screen.getByText('Nessun elemento selezionato.')).toBeInTheDocument();
    expect(s.calls.filter((c) => /insert|upsert|upload|gateway/.test(c))).toEqual([]);
    expect(repo.saved).toEqual([]);

    // i file si possono scegliere solo insieme al loro progetto
    const filesBox = await screen.findByRole('checkbox', { name: /1 file locali/ });
    expect(filesBox).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: /Progetto “DEMO — Vigneto molisano/ }));
    expect(filesBox).toBeEnabled();
    await user.click(filesBox);
    await user.click(screen.getByRole('checkbox', { name: /Preferenze/ }));
    expect(screen.getByText('Verranno trasferiti: 1 progetti, 1 file, le preferenze.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Importa la selezione' }));
    await screen.findByText(/1 file caricati nell’archivio privato/);
    expect(repo.saved).toEqual([agri.project.id]);
    expect(s.calls).toEqual(expect.arrayContaining(['media_assets:insert', 'storage:upload', 'gateway:complete', 'user_preferences:upsert']));
    expect(s.prefs['u-9']).toMatchObject({ profile: 'agricoltore' });
    expect(await localMediaStore().listAll()).toEqual([]);
  });

  it('“Non ora” annulla senza trasferire nulla', async () => {
    const user = userEvent.setup();
    const s = fakeServer();
    const repo = remoteRepo([]);
    renderImport(fakeAuth({ client: s.client, session: fakeSession('u-9'), memberships: [member('editor')], current: member('editor') }), repo, guestRepo);
    await screen.findByText('Dati salvati come ospite in questo browser');
    await user.click(screen.getByRole('button', { name: 'Non ora' }));
    expect(screen.queryByText('Dati salvati come ospite in questo browser')).toBeNull();
    expect(repo.saved).toEqual([]);
    expect(await localMediaStore().listAll()).toHaveLength(1);
  });

  it('con il ruolo lettura la selezione non è disponibile', async () => {
    const s = fakeServer();
    renderImport(fakeAuth({ client: s.client, session: fakeSession('u-9'), memberships: [member('viewer')], current: member('viewer') }), remoteRepo([]), guestRepo);
    await screen.findByText(/Con il ruolo “lettura” non puoi importare/);
    expect(screen.getByRole('button', { name: 'Importa la selezione' })).toBeDisabled();
  });
});

describe('B-125 — conservazione per gli amministratori', () => {
  it('elenca i file in scadenza e registra la proroga', async () => {
    const user = userEvent.setup();
    const s = fakeServer();
    s.rows.m1 = { id: 'm1', status: 'attivo', retention_until: '2026-11-10' };
    const auth = fakeAuth({ client: s.client, session: fakeSession('u-1'), memberships: [member('admin')], current: member('admin') });
    const rec = { id: 'm1', category: 'foto_sopralluogo', description: 'Piazza', originalName: 'p.jpg' } as never;
    render(
      <AuthContext.Provider value={auth}>
        <PreferencesProvider>
          <StoreProvider repository={remoteRepo([])}>
            <RetentionPanel organizationId={ORG_A} records={[rec]} onChanged={() => {}} />
          </StoreProvider>
        </PreferencesProvider>
      </AuthContext.Provider>,
    );
    await screen.findByText('2026-11-10');
    expect(s.calls).toContain('rpc:media_expiring');
    await user.type(screen.getByLabelText(/Nuova data di fine conservazione/), '2030-01-31');
    await user.click(screen.getByRole('button', { name: 'Proroga' }));
    await waitFor(() => expect(s.rows.m1!.retention_until).toBe('2030-01-31'));
  });
});
