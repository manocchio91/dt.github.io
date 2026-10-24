import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
// @ts-expect-error libreria senza tipi, usata solo nei test
import piexif from 'piexifjs';
import type { SupabaseClient } from '@supabase/supabase-js';
import { seedCampobasso, seedVineyard, type ProjectBundle } from '@mdt/domain';
import MediaPage from '../pages/MediaPage';
import { localMediaStore, resetLocalMediaStore } from '../state/useMedia';
import { fakeAuth, fakeSession, member, ORG_A, ORG_B, remoteRepo, renderApp, localRepo } from './utils';
import type { OrgRole } from '../state/auth';

const TINY = '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';
const bin = (b: Uint8Array) => String.fromCharCode(...b);
const jpegWithGps = () => {
  const exif = piexif.dump({ '0th': { [piexif.ImageIFD.Model]: 'Modello-XYZ' }, GPS: { [piexif.GPSIFD.GPSLatitudeRef]: 'N', [piexif.GPSIFD.GPSLatitude]: [[41, 1], [48, 1], [0, 1]] } });
  return Uint8Array.from(piexif.insert(exif, atob(TINY)), (c: string) => c.charCodeAt(0));
};
const file = (bytes: Uint8Array, name: string, type: string) => new File([bytes as BlobPart], name, { type });

let agri: ProjectBundle;
let urban: ProjectBundle;
let dbCounter = 0;

beforeEach(() => {
  localStorage.clear();
  resetLocalMediaStore(`mdt-media-test-${++dbCounter}`);
  agri = seedVineyard(new Date('2026-08-20T08:00:00Z'), '2026-08-20');
  urban = seedCampobasso(new Date('2026-10-24T08:00:00Z'));
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
});

/** Server simulato per media_assets + storage, con le regole di ruolo essenziali. */
function fakeMediaServer(role: OrgRole, userId: string, org = ORG_A) {
  const rows: Record<string, Record<string, unknown>> = {};
  const objects = new Set<string>();
  const calls: string[] = [];
  const canEdit = role !== 'viewer';
  const from = (table: string) => {
    const q = {
      op: 'select' as 'select' | 'insert' | 'update' | 'delete',
      v: {} as Record<string, unknown>,
      f: [] as [string, unknown][],
      ret: false,
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
      delete() {
        q.op = 'delete';
        return q;
      },
      eq(c: string, v: unknown) {
        q.f.push([c, v]);
        return q;
      },
      single: false,
      maybeSingle() {
        q.single = true;
        return q;
      },
      then(ok: (r: { data: unknown; error: { message: string } | null }) => unknown) {
        if (q.single) return Promise.resolve({ data: null, error: null }).then(ok);
        calls.push(`${table}:${q.op}`);
        const match = (r: Record<string, unknown>) => q.f.every(([c, v]) => r[c] === v);
        let res: { data: unknown; error: { message: string } | null } = { data: null, error: null };
        if (table !== 'media_assets') res = { data: [], error: null };
        else if (q.op === 'select') res = { data: Object.values(rows).filter((r) => r.organization_id === org && match(r)), error: null };
        else if (q.op === 'insert') {
          if (!canEdit) res = { data: null, error: { message: 'new row violates row-level security policy' } };
          else rows[q.v.id as string] = { ...q.v, status: 'caricamento', created_at: new Date().toISOString(), retention_until: '2031-10-24' };
        } else if (q.op === 'update') {
          const hit = Object.values(rows).filter(match).filter((r) => r.uploaded_by === userId || role === 'admin');
          hit.forEach((r) => Object.assign(r, q.v));
          res = { data: q.ret ? hit : null, error: null };
        } else {
          const hit = Object.values(rows).filter(match).filter((r) => !objects.has(r.storage_path as string));
          hit.forEach((r) => delete rows[r.id as string]);
          res = { data: q.ret ? hit : null, error: null };
        }
        return Promise.resolve(res).then(ok);
      },
    };
    return q;
  };
  const client = {
    from,
    rpc: async (fn: string, args: { p_media?: string }) => {
      calls.push(`rpc:${fn}`);
      if (fn === 'media_expiring') return { data: [], error: null };
      const r = rows[args.p_media ?? ''];
      return r && r.status === 'attivo' ? { data: r.storage_path, error: null } : { data: null, error: { message: 'File non disponibile.' } };
    },
    // gateway server-side (Edge Function media-gateway): conferma dopo validazione, firma con audit, eliminazione
    functions: {
      invoke: async (_name: string, { body }: { body: { action: string; mediaId: string } }) => {
        calls.push(`gateway:${body.action}`);
        const r = rows[body.mediaId];
        const fail = (status: number, error: string) => ({ data: null, error: { message: 'non-2xx', context: { status, json: async () => ({ error }) } } });
        if (!r) return fail(404, 'File non trovato.');
        if (body.action === 'complete') {
          if (r.uploaded_by !== userId) return fail(403, 'Non autorizzato.');
          if (!objects.has(r.storage_path as string)) return fail(409, 'Oggetto non presente.');
          r.status = 'attivo';
          return { data: { status: 'attivo', idempotent: false }, error: null };
        }
        if (body.action === 'sign') {
          if (r.status !== 'attivo') return fail(403, 'File non disponibile.');
          return { data: { signedUrl: `https://storage.test/${r.storage_path}?exp=1`, expiresInSeconds: 60 }, error: null };
        }
        if (role !== 'admin') return fail(403, 'Solo un amministratore può eliminare i file.');
        objects.delete(r.storage_path as string);
        delete rows[body.mediaId];
        return { data: { deleted: true }, error: null };
      },
    },
    storage: {
      from: () => ({
        upload: async (path: string) => {
          calls.push('storage:upload');
          objects.add(path);
          return { data: { path }, error: null };
        },
        remove: async (paths: string[]) => {
          calls.push('storage:remove');
          paths.forEach((p) => objects.delete(p));
          return { data: paths.map((name) => ({ name })), error: null };
        },
        createSignedUrl: async (path: string) => ({ data: objects.has(path) ? { signedUrl: `https://storage.test/${path}?exp=1` } : null, error: objects.has(path) ? null : { message: 'Object not found' } }),
      }),
    },
  } as unknown as SupabaseClient;
  return { client, rows, objects, calls };
}

function renderAsMember(role: OrgRole, bundle: ProjectBundle, server = fakeMediaServer(role, 'u-1'), org = ORG_A) {
  const session = fakeSession('u-1');
  const m = member(role, org);
  renderApp(<MediaPage />, {
    auth: fakeAuth({ client: server.client, session, memberships: [m], current: m }),
    repo: remoteRepo([bundle]),
    route: `/progetti/${bundle.project.id}/documenti`,
    path: '/progetti/:id/documenti',
  });
  return server;
}

const pick = (f: File) => fireEvent.change(screen.getByTestId('file-input'), { target: { files: [f] } });

describe('Ospite (Demo senza account): tutto in locale', () => {
  it('controllo → anteprima → collegamento → salvataggio → download → eliminazione', async () => {
    const user = userEvent.setup();
    renderApp(<MediaPage />, { repo: localRepo([agri]), route: `/progetti/${agri.project.id}/documenti`, path: '/progetti/:id/documenti' });
    await screen.findByText('Trascina qui una foto o un documento');
    pick(file(jpegWithGps(), 'Foto Vite.JPG', 'image/jpeg'));
    await screen.findByText('File accettato');
    expect(screen.getByText(/EXIF \(incluse eventuali coordinate GPS/)).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /Anteprima di foto-vite.jpg/ })).toBeInTheDocument();
    expect(screen.getAllByText(/Non costituisce una diagnosi agronomica/).length).toBeGreaterThan(0);
    expect(screen.getByText('nessuna posizione')).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Sottozona'), agri.agri!.zones[0]!.id);
    await user.type(screen.getByLabelText(/^Descrizione/), 'Foglie basali ingiallite');
    await user.clear(screen.getByLabelText('Autore'));
    await user.type(screen.getByLabelText('Autore'), 'Viticoltore');
    await user.click(screen.getByRole('button', { name: 'Salva nel browser' }));

    await screen.findByText('File locale — non sincronizzato con il server.');
    const item = screen.getByRole('listitem', { name: /Immagine del terreno o della coltura/ });
    expect(within(item).getByText(/Sottozona: Zona A/)).toBeInTheDocument();
    const [rec] = await localMediaStore().list(agri.project.id);
    const stored = await localMediaStore().bytesOf(rec!.id);
    expect(bin(stored)).not.toContain('Exif');
    expect(bin(stored)).not.toContain('Modello-XYZ');
    expect(rec).toMatchObject({ organizationId: null, location: null, locationConsent: false, status: 'non_sincronizzato' });

    const spy = vi.spyOn(URL, 'createObjectURL');
    await user.click(within(item).getByRole('button', { name: 'Scarica' }));
    expect(spy).toHaveBeenCalled();

    await user.click(within(item).getByRole('button', { name: 'Elimina' }));
    expect(screen.getByRole('heading', { name: 'Eliminare il file?' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Annulla' })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Elimina definitivamente' }));
    await waitFor(() => expect(screen.queryByText('File locale — non sincronizzato con il server.')).toBeNull());
    expect(await localMediaStore().list(agri.project.id)).toEqual([]);
  });

  it.each([
    ['estensione contraffatta', () => file(new TextEncoder().encode('%PDF-1.7 x'), 'foto.jpg', 'image/jpeg'), /Documento PDF.*\.jpg/],
    ['MIME falso', () => file(new TextEncoder().encode('%PDF-1.7 x'), 'relazione.pdf', 'image/png'), /tipo dichiarato/],
    ['eseguibile', () => file(Uint8Array.from([0x4d, 0x5a, 0x90, 0]), 'setup.jpg', 'image/jpeg'), /Programmi, script/],
    ['HEIC', () => file(Uint8Array.from([0, 0, 0, 24, 102, 116, 121, 112, 104, 101, 105, 99]), 'IMG_1.HEIC', 'image/heic'), /Sul telefono scegli “Più compatibile”/],
    ['troppo grande', () => { const b = new Uint8Array(21 * 1024 * 1024); b.set(jpegWithGps()); return file(b, 'grande.jpg', 'image/jpeg'); }, /troppo grande/],
  ])('rifiuta: %s, con messaggio chiaro e senza salvare nulla', async (_n, make, msg) => {
    renderApp(<MediaPage />, { repo: localRepo([urban]), route: `/progetti/${urban.project.id}/documenti`, path: '/progetti/:id/documenti' });
    await screen.findByText('Trascina qui una foto o un documento');
    pick(make());
    expect(await screen.findByText(msg)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Salva/ })).toBeNull();
    expect(await localMediaStore().list(urban.project.id)).toEqual([]);
  });
});

describe('Organizzazione: ruoli e server', () => {
  it('editor: il file va sul server privato in tre fasi; modifica i propri, non elimina', async () => {
    const user = userEvent.setup();
    const s = renderAsMember('editor', urban);
    await screen.findByText(/Archivio privato di Comune A/);
    pick(file(jpegWithGps(), 'piazza.jpg', 'image/jpeg'));
    await screen.findByText('File accettato');
    await user.click(screen.getByRole('button', { name: 'Salva e carica' }));
    await screen.findByText('Sul server (privato)');
    expect(s.calls.filter((c) => !c.endsWith(':select'))).toEqual(['media_assets:insert', 'storage:upload', 'gateway:complete']);
    expect(screen.getByRole('button', { name: 'Modifica collegamenti' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Elimina' })).toBeNull();
    expect(await localMediaStore().list(urban.project.id)).toEqual([]);
  });

  it('lettura: consulta e scarica, ma non vede caricamento, modifica o eliminazione', async () => {
    const s = fakeMediaServer('viewer', 'u-1');
    s.rows.m1 = { id: 'm1', project_id: urban.project.id, organization_id: ORG_A, storage_path: `${ORG_A}/${urban.project.id}/m1.jpg`, mime: 'image/jpeg', size_bytes: 10, sha256: 'a'.repeat(64), original_name: 'foto.jpg', uploaded_by: 'altro', author_name: 'Tecnico', category: 'foto_sopralluogo', description: 'Pavimentazione', observed_on: '2026-10-20', area_ref: urban.area!.id, workflow_stage: 'bozza', status: 'attivo', created_at: '2026-10-20T10:00:00Z', retention_until: '2031-10-20', metadata_removed: [], metadata_kept: [] };
    s.objects.add(`${ORG_A}/${urban.project.id}/m1.jpg`);
    renderAsMember('viewer', urban, s);
    await screen.findByText('Pavimentazione');
    expect(screen.queryByText('Trascina qui una foto o un documento')).toBeNull();
    expect(screen.getByText(/ruolo “lettura” puoi consultare e scaricare/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Scarica' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Modifica collegamenti|Elimina/ })).toBeNull();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Mostra anteprima' }));
    await waitFor(() => expect(s.calls).toContain('gateway:sign'));
    expect(await screen.findByText('Link temporaneo: scade dopo 60 secondi.')).toBeInTheDocument();
  });

  it('amministratore: elimina con conferma (stato → storage → scheda)', async () => {
    const user = userEvent.setup();
    const s = fakeMediaServer('admin', 'u-1');
    s.rows.m2 = { id: 'm2', project_id: urban.project.id, organization_id: ORG_A, storage_path: 'p/m2.jpg', mime: 'image/jpeg', size_bytes: 10, sha256: 'a'.repeat(64), original_name: 'x.jpg', uploaded_by: 'altro', author_name: 'T', category: 'foto_sopralluogo', description: 'Da eliminare', observed_on: '2026-10-20', area_ref: urban.area!.id, workflow_stage: 'bozza', status: 'attivo', created_at: '2026-10-20T10:00:00Z', retention_until: '2031-10-20', metadata_removed: [], metadata_kept: [] };
    s.objects.add('p/m2.jpg');
    renderAsMember('admin', urban, s);
    await screen.findByText('Da eliminare');
    await user.click(screen.getByRole('button', { name: 'Elimina' }));
    await user.click(screen.getByRole('button', { name: 'Elimina definitivamente' }));
    await waitFor(() => expect(screen.queryByText('Da eliminare')).toBeNull());
    expect(s.calls.filter((c) => !c.endsWith(':select') && c !== 'rpc:media_expiring')).toEqual(['gateway:delete']);
    expect(s.objects.size).toBe(0);
  });
});

describe('Rete e passaggio ospite → organizzazione', () => {
  it('senza rete il file resta “non sincronizzato”; al ritorno della rete si sincronizza solo dopo conferma', async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    const s = renderAsMember('editor', agri);
    await screen.findByText('Connessione assente');
    pick(file(jpegWithGps(), 'campo.jpg', 'image/jpeg'));
    await screen.findByText('File accettato');
    await user.click(screen.getByRole('button', { name: 'Salva nel browser' }));
    await screen.findByText('File locale — non sincronizzato con il server.');
    expect(s.calls.some((c) => c.startsWith('storage'))).toBe(false);
    const [pending] = await localMediaStore().list(agri.project.id);
    expect(pending!.organizationId).toBe(ORG_A);

    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    await screen.findByText('1 file in attesa di sincronizzazione');
    expect(s.calls.some((c) => c.startsWith('storage'))).toBe(false); // nessun invio automatico
    await user.click(screen.getByRole('button', { name: 'Sincronizza ora' }));
    await screen.findByText('Sul server (privato)');
    expect(s.calls).toContain('storage:upload');
    expect(await localMediaStore().list(agri.project.id)).toEqual([]);
  });

  it('i file salvati da ospite non vengono caricati all’accesso senza conferma', async () => {
    const guestFile = await localMediaStore().upload(
      { bytes: Uint8Array.from(atob(TINY), (c) => c.charCodeAt(0)), mime: 'image/jpeg', sizeBytes: 100, sha256: 'a'.repeat(64), originalName: 'ospite.jpg', metadataRemoved: [], metadataKept: [], metadataStripped: true },
      { organizationId: null, projectId: agri.project.id, areaId: agri.area!.id, zoneId: null, cellId: null, scenarioId: null, observationId: null, workflowStage: 'bozza', category: 'foto_sopralluogo', description: 'Scattata da ospite', observedOn: '2026-08-19', author: 'Ospite', authorId: null, location: null, locationConsent: false },
    );
    const s = renderAsMember('editor', agri);
    await screen.findByText('1 file salvati come ospite in questo browser');
    expect(screen.getByText(/Non vengono caricati automaticamente/)).toBeInTheDocument();
    expect(s.calls.some((c) => c.startsWith('storage') || c.endsWith(':insert'))).toBe(false);
    expect(await localMediaStore().list(agri.project.id)).toEqual([expect.objectContaining({ id: guestFile.id })]);
  });

  it('cambio di organizzazione: i file in attesa di un’organizzazione non compaiono nell’altra', async () => {
    await localMediaStore().upload(
      { bytes: new Uint8Array([0xff, 0xd8, 0xff]), mime: 'image/jpeg', sizeBytes: 3, sha256: 'a'.repeat(64), originalName: 'a.jpg', metadataRemoved: [], metadataKept: [], metadataStripped: true },
      { organizationId: ORG_A, projectId: agri.project.id, areaId: agri.area!.id, zoneId: null, cellId: null, scenarioId: null, observationId: null, workflowStage: 'bozza', category: 'foto_sopralluogo', description: 'Solo di A', observedOn: '2026-08-19', author: 'A', authorId: 'u-1', location: null, locationConsent: false },
    );
    renderAsMember('editor', agri, fakeMediaServer('editor', 'u-1', ORG_B), ORG_B);
    await screen.findByText(/Archivio privato di Comune A|Archivio privato/);
    expect(screen.queryByText('Solo di A')).toBeNull();
    expect(screen.getByText('File del progetto (0)')).toBeInTheDocument();
  });
});

describe('Accessibilità', () => {
  it('pulsanti di caricamento raggiungibili da tastiera; la fotocamera usa capture', async () => {
    const user = userEvent.setup();
    renderApp(<MediaPage />, { repo: localRepo([urban]), route: `/progetti/${urban.project.id}/documenti`, path: '/progetti/:id/documenti' });
    await screen.findByText('Trascina qui una foto o un documento');
    const reached: string[] = [];
    for (let i = 0; i < 12; i++) {
      await user.tab();
      reached.push(document.activeElement?.textContent ?? '');
    }
    expect(reached).toEqual(expect.arrayContaining(['Scatta una foto', 'Scegli dal dispositivo']));
    expect(screen.getByLabelText('Fotocamera: scatta una foto')).toHaveAttribute('capture', 'environment');
  });
});
