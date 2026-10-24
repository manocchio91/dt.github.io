import { useCallback, useEffect, useId, useMemo, useRef, useState, type DragEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  AGRI_PHOTO_NOTICE,
  ALLOWED_MEDIA,
  buildGrid,
  categoriesFor,
  DEFAULT_MAX_BYTES,
  describeContext,
  formatBytes,
  MEDIA_CATEGORY_LABEL,
  mediaToCsv,
  pointInPolygon,
  suggestedCellSize,
  validateMediaContext,
  WORKFLOW_STAGE_LABEL,
  WORKFLOW_STAGES,
  type FileCheck,
  type MediaCategory,
  type MediaRecord,
  type WorkflowStage,
} from '@mdt/domain';
import { MapView, type MapPoint, type MapPolygon } from '../components/MapView';
import { Alert, Field, Section } from '../components/ui';
import { ProjectMissing, useProject } from '../state/useProject';
import { usePermissions } from '../state/permissions';
import { useAuth } from '../state/auth';
import { downloadText } from '../state/store';
import { useMediaStores, useOnline } from '../state/useMedia';
import { PartialDeletionError, prepareUpload, STAGE_LABEL, UploadCancelled, type PreparedUpload, type UploadStage } from '../state/mediaStore';
import { uploadLocalRecords } from '../state/mediaSync';
import { RetentionPanel } from '../components/RetentionPanel';

const LOCAL_BADGE = 'File locale — non sincronizzato con il server.';
const ACCEPT = Object.keys(ALLOWED_MEDIA).join(',') + ',.jpg,.jpeg,.png,.webp,.pdf';
const STAGES: UploadStage[] = ['controllo', 'pulizia', 'registrazione', 'invio', 'conferma', 'fatto'];
const todayIso = () => new Date().toISOString().slice(0, 10);
const AUTHOR_KEY = 'mdt:media:author';

interface Pending {
  name: string;
  previewUrl: string | null;
  check: FileCheck;
  prepared: PreparedUpload | null;
}

interface Form {
  category: MediaCategory;
  description: string;
  observedOn: string;
  zoneId: string;
  cellId: string;
  scenarioId: string;
  observationId: string;
  workflowStage: WorkflowStage;
  author: string;
  locationConsent: boolean;
  location: { lat: number; lon: number } | null;
}

/** Legge il file come byte (FileReader come ripiego per i browser senza Blob.arrayBuffer). */
function readBytes(f: File): Promise<Uint8Array> {
  if (typeof f.arrayBuffer === 'function') return f.arrayBuffer().then((b) => new Uint8Array(b));
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(new Uint8Array(r.result as ArrayBuffer));
    r.onerror = () => reject(new Error('Impossibile leggere il file dal dispositivo.'));
    r.readAsArrayBuffer(f);
  });
}

function readAuthor() {
  try {
    return localStorage.getItem(AUTHOR_KEY) ?? '';
  } catch {
    return '';
  }
}

export default function MediaPage() {
  const { bundle, ready } = useProject();
  const [params] = useSearchParams();
  const perms = usePermissions();
  const { session, current } = useAuth();
  const { local, remote, organizationId, userId } = useMediaStores();
  const online = useOnline();
  const [records, setRecords] = useState<MediaRecord[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [stage, setStage] = useState<UploadStage | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [formErrors, setFormErrors] = useState<string[]>([]);
  const [picking, setPicking] = useState(false);
  const [opened, setOpened] = useState<Record<string, { url: string; expiresAt: number | null }>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<MediaRecord | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const statusId = useId();

  const sector = bundle?.project.sector ?? 'urban';
  const defaultCategory = (mime: string | null): MediaCategory =>
    (params.get('categoria') as MediaCategory | null) && categoriesFor(sector).includes(params.get('categoria') as MediaCategory)
      ? (params.get('categoria') as MediaCategory)
      : mime === 'application/pdf'
        ? 'documento_tecnico'
        : sector === 'agriculture'
          ? 'immagine_terreno_coltura'
          : 'foto_sopralluogo';

  const [form, setForm] = useState<Form>(() => ({
    category: defaultCategory(null),
    description: '',
    observedOn: todayIso(),
    zoneId: '',
    cellId: '',
    scenarioId: params.get('scenario') ?? '',
    observationId: '',
    workflowStage: params.get('categoria') === 'verifica_ex_post' ? 'monitoraggio' : 'bozza',
    author: session?.user.email ?? readAuthor(),
    locationConsent: false,
    location: null,
  }));

  const grid = useMemo(() => (bundle?.area && sector === 'urban' ? buildGrid(bundle.area.geometry, suggestedCellSize(bundle.area.areaM2)) : null), [bundle?.area, sector]);
  const projectId = bundle?.project.id;

  const refresh = useCallback(async () => {
    if (!projectId) return;
    setListError(null);
    const locals = await local.list(projectId).catch(() => [] as MediaRecord[]);
    let server: MediaRecord[] = [];
    if (remote && online) {
      try {
        server = await remote.list(projectId);
      } catch (e) {
        setListError((e as Error).message);
      }
    }
    // nell'archivio di un'organizzazione si mostrano solo i file locali di quell'organizzazione o da ospite
    const visibleLocal = locals.filter((r) => (organizationId ? r.organizationId === organizationId || r.organizationId === null : r.organizationId === null));
    setRecords([...visibleLocal, ...server]);
  }, [projectId, local, remote, online, organizationId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => () => Object.values(opened).forEach((o) => o.url.startsWith('blob:') && URL.revokeObjectURL(o.url)), [opened]);

  if (!bundle) return <ProjectMissing ready={ready} />;
  if (!bundle.area) {
    return (
      <Alert tone="warn" title="Prima definisci l’area">
        Ogni file va collegato a un’area o a una parcella. <Link to={`/progetti/${bundle.project.id}/area`} className="underline">Vai all’area</Link>
      </Alert>
    );
  }
  const area = bundle.area;
  const zones = bundle.agri?.zones ?? [];
  const observations = bundle.agri?.observations ?? [];
  const isAgri = sector === 'agriculture';
  const useRemote = !!remote && online;
  const offlineInOrg = !!remote && !online;

  // ------------------------------------------------------------ selezione file
  const onFiles = async (files: FileList | File[] | null) => {
    const file = files?.[0];
    if (!file) return;
    setUploadError(null);
    setNotice(null);
    setStage('controllo');
    let bytes: Uint8Array;
    try {
      bytes = await readBytes(file);
    } catch (e) {
      setStage(null);
      setUploadError((e as Error).message);
      return;
    }
    setStage('pulizia');
    const { check, prepared } = prepareUpload(file, bytes, DEFAULT_MAX_BYTES);
    const previewUrl = prepared && ALLOWED_MEDIA[prepared.mime]?.image ? URL.createObjectURL(new Blob([prepared.bytes as BlobPart], { type: prepared.mime })) : null;
    if (pending?.previewUrl) URL.revokeObjectURL(pending.previewUrl);
    setPending({ name: file.name, previewUrl, check, prepared });
    setForm((f) => ({ ...f, category: defaultCategory(prepared?.mime ?? null) }));
    setStage(null);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (perms.canEdit) void onFiles(e.dataTransfer.files);
  };

  const pickOnMap = (v: number[][]) => {
    setPicking(false);
    const last = v.at(-1);
    if (!last) return;
    const [lon, lat] = last as [number, number];
    if (!pointInPolygon(lon, lat, area.geometry)) {
      setNotice('Il punto scelto è fuori dall’area del progetto.');
      return;
    }
    const zone = zones.find((z) => pointInPolygon(lon, lat, z.geometry));
    const cell = grid?.cells.find((c) => pointInPolygon(lon, lat, c.polygon));
    setForm((f) => ({
      ...f,
      zoneId: isAgri ? (zone?.id ?? '') : '',
      cellId: !isAgri ? (cell?.id ?? '') : '',
      location: f.locationConsent ? { lat: Number(lat.toFixed(6)), lon: Number(lon.toFixed(6)) } : null,
    }));
    setNotice(isAgri ? (zone ? `Associato alla ${zone.name}.` : 'Punto nella parcella, fuori dalle sottozone.') : cell ? `Associato alla cella ${cell.id}.` : 'Punto nell’area.');
  };

  const useMyPosition = () => {
    if (!form.locationConsent || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => setForm((f) => ({ ...f, location: { lat: Number(pos.coords.latitude.toFixed(6)), lon: Number(pos.coords.longitude.toFixed(6)) } })),
      () => setNotice('Posizione non disponibile: il permesso è stato negato o il segnale è assente.'),
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  };

  const details = () => ({
    organizationId: useRemote ? organizationId : offlineInOrg ? organizationId : null,
    projectId: bundle.project.id,
    areaId: area.id,
    zoneId: form.zoneId || null,
    cellId: form.cellId || null,
    scenarioId: form.scenarioId || null,
    observationId: form.observationId || null,
    workflowStage: form.workflowStage,
    category: form.category,
    description: form.description,
    observedOn: form.observedOn,
    author: form.author,
    authorId: userId,
    location: form.locationConsent ? form.location : null,
    locationConsent: form.locationConsent && !!form.location,
  });

  const save = async () => {
    if (!pending?.prepared) return;
    const d = details();
    const errs = validateMediaContext({ ...d }, bundle, todayIso());
    setFormErrors(errs);
    if (errs.length) return;
    try {
      localStorage.setItem(AUTHOR_KEY, form.author);
    } catch {
      /* facoltativo */
    }
    const ac = new AbortController();
    abortRef.current = ac;
    setUploadError(null);
    try {
      const store = useRemote ? remote! : local;
      await store.upload(pending.prepared, d, setStage, ac.signal);
      setNotice(
        store.kind === 'server'
          ? 'File caricato e collegato al progetto.'
          : offlineInOrg
            ? 'Connessione assente: il file è salvato solo in questo browser e verrà caricato quando confermerai la sincronizzazione.'
            : 'File salvato in questo browser.',
      );
      if (pending.previewUrl) URL.revokeObjectURL(pending.previewUrl);
      setPending(null);
      setForm((f) => ({ ...f, description: '', zoneId: '', cellId: '', observationId: '', location: null }));
      await refresh();
    } catch (e) {
      setUploadError(e instanceof UploadCancelled ? e.message : `${(e as Error).message}. Puoi riprovare: il file è ancora pronto.`);
    } finally {
      setStage(null);
      abortRef.current = null;
    }
  };

  // ------------------------------------------------------------ consultazione
  const storeOf = (r: MediaRecord) => (r.storage === 'server' ? remote : local);

  const open = async (r: MediaRecord, download = false) => {
    const s = storeOf(r);
    if (!s) return setNotice('Per aprire questo file serve l’accesso all’organizzazione.');
    setBusyId(r.id);
    try {
      const o = await s.open(r);
      if (download) {
        const a = document.createElement('a');
        a.href = o.url;
        a.download = r.originalName;
        a.rel = 'noopener';
        a.click();
        if (r.storage === 'locale') setTimeout(o.release, 2000);
      } else {
        setOpened((x) => ({ ...x, [r.id]: { url: o.url, expiresAt: o.expiresAt } }));
      }
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const saveEdit = async (r: MediaRecord, patch: Partial<MediaRecord>) => {
    const s = storeOf(r);
    if (!s) return;
    const errs = validateMediaContext({ ...r, ...patch }, bundle, todayIso());
    if (errs.length) return setNotice(errs.join(' '));
    try {
      await s.update(r, patch);
      setEditing(null);
      await refresh();
    } catch (e) {
      setNotice((e as Error).message);
    }
  };

  const askDelete = (r: MediaRecord) => {
    setConfirming(r);
    dialogRef.current?.showModal();
    // la scelta prudente riceve il focus all'apertura
    cancelRef.current?.focus();
  };

  const doDelete = async () => {
    const r = confirming;
    dialogRef.current?.close();
    setConfirming(null);
    if (!r) return;
    const s = storeOf(r);
    if (!s) return;
    setBusyId(r.id);
    try {
      await s.remove(r);
      setOpened((x) => {
        const { [r.id]: gone, ...rest } = x;
        if (gone?.url.startsWith('blob:')) URL.revokeObjectURL(gone.url);
        return rest;
      });
      setNotice(r.storage === 'server' ? 'File eliminato dallo storage; nel registro restano solo i dati minimi.' : 'File locale eliminato da questo browser.');
    } catch (e) {
      setNotice(e instanceof PartialDeletionError ? e.message : (e as Error).message);
    } finally {
      setBusyId(null);
      await refresh();
    }
  };

  // ------------------------------------------------------------ sincronizzazione
  const pendingOrg = records.filter((r) => r.storage === 'locale' && organizationId && r.organizationId === organizationId);
  const guestLocal = records.filter((r) => r.storage === 'locale' && organizationId && r.organizationId === null);

  const syncLocal = async (list: MediaRecord[]) => {
    if (!remote) return;
    const { ok, failed } = await uploadLocalRecords(remote, local, list, userId);
    setNotice(`${ok} file caricati sul server.${failed.length ? ` Non caricati: ${failed.join('; ')}` : ''}`);
    await refresh();
  };

  const exportList = () => {
    const { csv, dictionary } = mediaToCsv(records);
    downloadText(`${bundle.project.name.replace(/[^\w-]+/g, '_')}_file.csv`, csv, 'text/csv');
    downloadText(`${bundle.project.name.replace(/[^\w-]+/g, '_')}_file_dizionario.csv`, dictionary, 'text/csv');
  };

  // ------------------------------------------------------------ mappa
  const polygons: MapPolygon[] = [{ id: 'area', geometry: area.geometry, kind: 'aoi' }, ...zones.map((z) => ({ id: z.id, geometry: z.geometry, kind: 'zona' as const }))];
  const selectedCell = grid?.cells.find((c) => c.id === form.cellId);
  if (selectedCell) polygons.push({ id: selectedCell.id, geometry: selectedCell.polygon, kind: 'intervento' });
  const points: MapPoint[] = form.location ? [{ id: 'pos', coordinates: [form.location.lon, form.location.lat], kind: 'punto' }] : [];

  const canEditRecord = (r: MediaRecord) => (r.storage === 'locale' ? true : perms.canEdit && r.authorId === userId);
  const canDeleteRecord = (r: MediaRecord) => (r.storage === 'locale' ? true : perms.canAdmin);
  const stageIndex = stage ? STAGES.indexOf(stage) : -1;

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm text-sand-600">{bundle.project.name}</p>
        <h1 className="text-2xl font-extrabold text-petrol-900">Foto e documenti</h1>
        <p className="text-sm">
          {useRemote ? `Archivio privato di ${current?.organizationName}. ` : offlineInOrg ? '' : 'Modalità ospite: i file restano solo in questo browser. '}
          Ogni file è collegato a progetto, {isAgri ? 'parcella' : 'area'}, data e autore.
        </p>
      </div>

      {offlineInOrg && (
        <Alert tone="warn" title="Connessione assente">
          I nuovi file vengono salvati solo in questo browser (stato “non sincronizzato”). Quando la rete torna ti chiederemo se caricarli.
        </Alert>
      )}
      {notice && (
        <Alert tone="info">
          <span>{notice}</span>
        </Alert>
      )}
      {listError && <Alert tone="error">{listError}</Alert>}

      {remote && online && pendingOrg.length > 0 && perms.canEdit && (
        <Alert tone="warn" title={`${pendingOrg.length} file in attesa di sincronizzazione`}>
          <p>Sono stati salvati mentre la rete non c’era. Vuoi caricarli ora nell’archivio di {current?.organizationName}?</p>
          <button type="button" className="btn-primary mt-2" onClick={() => syncLocal(pendingOrg)}>
            Sincronizza ora
          </button>
        </Alert>
      )}
      {remote && online && guestLocal.length > 0 && perms.canEdit && (
        <Alert tone="info" title={`${guestLocal.length} file salvati come ospite in questo browser`}>
          <p>Non vengono caricati automaticamente. Vuoi caricarli nell’archivio di {current?.organizationName}?</p>
          <button type="button" className="btn-secondary mt-2" onClick={() => syncLocal(guestLocal)}>
            Carica nell’organizzazione
          </button>
        </Alert>
      )}

      {perms.canEdit ? (
        <Section title="1. Carica un file">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            className={`rounded-xl border-2 border-dashed p-6 text-center ${dragOver ? 'border-petrol-700 bg-petrol-100' : 'border-sand-400 bg-sand-50'}`}
            data-testid="drop-zone"
          >
            <p className="font-semibold">Trascina qui una foto o un documento</p>
            <p className="text-sm text-sand-600">
              JPEG, PNG, WebP o PDF, fino a {formatBytes(DEFAULT_MAX_BYTES)}. Le foto HEIC non sono ancora supportate. I dati EXIF e la posizione GPS vengono rimossi prima del salvataggio. Nei PDF i metadati (autore, software) non vengono rimossi; PDF con JavaScript, allegati o cifratura sono rifiutati. Nessuna scansione antivirus.
            </p>
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              <button type="button" className="btn-primary" onClick={() => cameraInput.current?.click()}>
                Scatta una foto
              </button>
              <button type="button" className="btn-secondary" onClick={() => fileInput.current?.click()}>
                Scegli dal dispositivo
              </button>
            </div>
            <input ref={cameraInput} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" className="sr-only" tabIndex={-1} aria-label="Fotocamera: scatta una foto" onChange={(e) => onFiles(e.target.files)} />
            <input ref={fileInput} type="file" accept={ACCEPT} className="sr-only" tabIndex={-1} aria-label="Scegli un file dal dispositivo" data-testid="file-input" onChange={(e) => onFiles(e.target.files)} />
          </div>
        </Section>
      ) : (
        <Section title="Caricamento">
          <p className="text-sm text-sand-600">Con il ruolo “lettura” puoi consultare e scaricare i file, ma non caricarli, modificarli o eliminarli.</p>
        </Section>
      )}

      {pending && (
        <Section title="2. Controllo e anteprima">
          {pending.check.ok && pending.prepared ? (
            <div className="grid gap-4 md:grid-cols-[minmax(0,16rem)_1fr]">
              <div>
                {pending.previewUrl ? (
                  <img src={pending.previewUrl} alt={`Anteprima di ${pending.prepared.originalName}`} className="max-h-64 w-full rounded-lg border border-sand-200 object-contain" />
                ) : (
                  <div className="flex h-40 items-center justify-center rounded-lg border border-sand-200 bg-sand-100 text-sm font-semibold">Documento PDF</div>
                )}
                {isAgri && pending.previewUrl && <p className="mt-2 rounded bg-ochre-100 p-2 text-xs text-ochre-800">{AGRI_PHOTO_NOTICE}</p>}
              </div>
              <div className="space-y-2 text-sm">
                <Alert tone="ok" title="File accettato">
                  <p>
                    {ALLOWED_MEDIA[pending.prepared.mime]!.label} verificato dal contenuto · {formatBytes(pending.prepared.sizeBytes)} · nome salvato: <code>{pending.prepared.originalName}</code>
                  </p>
                </Alert>
                <div>
                  <p className="font-semibold">Metadati rimossi</p>
                  <p>{pending.prepared.metadataRemoved.length ? pending.prepared.metadataRemoved.join('; ') : pending.prepared.metadataStripped ? 'Nessun metadato trovato.' : 'I PDF non vengono modificati.'}</p>
                  <p className="mt-1 font-semibold">Cosa conserviamo</p>
                  <ul className="list-disc pl-5">
                    {pending.prepared.metadataKept.map((m) => (
                      <li key={m}>{m}</li>
                    ))}
                    <li>{form.locationConsent && form.location ? `posizione ${form.location.lat}, ${form.location.lon} (con il tuo consenso)` : 'nessuna posizione'}</li>
                  </ul>
                </div>
              </div>
            </div>
          ) : (
            <Alert tone="error" title={`“${pending.name}” non può essere caricato`}>
              {pending.check.errors.map((e) => (
                <p key={e}>{e}</p>
              ))}
            </Alert>
          )}
          {!pending.check.ok && (
            <button type="button" className="btn-secondary" onClick={() => setPending(null)}>
              Scegli un altro file
            </button>
          )}
        </Section>
      )}

      {pending?.prepared && (
        <Section title="3. Descrizione e collegamenti">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Categoria" htmlFor="m-cat">
              <select id="m-cat" className="input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as MediaCategory })}>
                {categoriesFor(sector).map((c) => (
                  <option key={c} value={c}>
                    {MEDIA_CATEGORY_LABEL[c].title}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Data dell’osservazione" htmlFor="m-date">
              <input id="m-date" type="date" className="input" max={todayIso()} value={form.observedOn} onChange={(e) => setForm({ ...form, observedOn: e.target.value })} />
            </Field>
            <Field label="Descrizione" htmlFor="m-desc" hint="Cosa mostra o contiene il file. Evita dati personali.">
              <textarea id="m-desc" className="input" rows={2} maxLength={2000} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </Field>
            <Field label="Autore" htmlFor="m-author">
              <input id="m-author" className="input" value={form.author} onChange={(e) => setForm({ ...form, author: e.target.value })} autoComplete="name" readOnly={!!session} />
            </Field>
            <Field label={isAgri ? 'Parcella' : 'Area'} htmlFor="m-area">
              <input id="m-area" className="input" value={area.name} readOnly />
            </Field>
            {isAgri ? (
              <Field label="Sottozona" htmlFor="m-zone">
                <select id="m-zone" className="input" value={form.zoneId} onChange={(e) => setForm({ ...form, zoneId: e.target.value })}>
                  <option value="">Tutta la parcella</option>
                  {zones.map((z) => (
                    <option key={z.id} value={z.id}>
                      {z.name}
                    </option>
                  ))}
                </select>
              </Field>
            ) : (
              <Field label="Cella della griglia" htmlFor="m-cell" hint="Scegli il punto sulla mappa per collegare la cella.">
                <input id="m-cell" className="input" value={form.cellId || 'Tutta l’area'} readOnly />
              </Field>
            )}
            {bundle.scenarios.length > 0 && (
              <Field label="Scenario" htmlFor="m-scen">
                <select id="m-scen" className="input" value={form.scenarioId} onChange={(e) => setForm({ ...form, scenarioId: e.target.value })}>
                  <option value="">Nessuno</option>
                  {bundle.scenarios.map((s) => (
                    <option key={s.id} value={s.id}>
                      Scenario {s.label}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            {observations.length > 0 && (
              <Field label="Osservazione sul campo" htmlFor="m-obs">
                <select id="m-obs" className="input" value={form.observationId} onChange={(e) => setForm({ ...form, observationId: e.target.value })}>
                  <option value="">Nessuna</option>
                  {observations.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.date} — {o.note.slice(0, 50)}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <Field label="Fase del workflow" htmlFor="m-stage">
              <select id="m-stage" className="input" value={form.workflowStage} onChange={(e) => setForm({ ...form, workflowStage: e.target.value as WorkflowStage })}>
                {WORKFLOW_STAGES.map((s) => (
                  <option key={s} value={s}>
                    {WORKFLOW_STAGE_LABEL[s]}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <fieldset className="space-y-2 rounded-lg border-2 border-sand-200 p-3">
            <legend className="px-1 font-semibold">Posizione (facoltativa)</legend>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5 size-5"
                checked={form.locationConsent}
                onChange={(e) => setForm({ ...form, locationConsent: e.target.checked, location: e.target.checked ? form.location : null })}
              />
              <span>Acconsento a conservare le coordinate del punto scelto. Senza consenso il file è collegato solo a {isAgri ? 'parcella e sottozona' : 'area e cella'}.</span>
            </label>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn-secondary" onClick={() => setPicking(true)} disabled={picking}>
                Scegli il punto sulla mappa
              </button>
              {form.locationConsent && (
                <button type="button" className="btn-ghost" onClick={useMyPosition}>
                  Usa la mia posizione attuale
                </button>
              )}
            </div>
            <MapView
              ariaLabel="Mappa per collegare il file a un punto dell’area"
              polygons={polygons}
              points={points}
              fitTo={area.geometry}
              drawMode={picking ? 'points' : null}
              onDrawComplete={(v) => pickOnMap(v as number[][])}
              onDrawCancel={() => setPicking(false)}
              height="16rem"
            />
          </fieldset>

          {formErrors.length > 0 && (
            <Alert tone="error" title="Completa i collegamenti">
              {formErrors.map((e) => (
                <p key={e}>{e}</p>
              ))}
            </Alert>
          )}

          <div className="space-y-2" aria-live="polite" id={statusId}>
            {stage && (
              <>
                <progress className="h-2 w-full accent-petrol-700" max={STAGES.length - 1} value={Math.max(0, stageIndex)} aria-label="Avanzamento del caricamento" />
                <p className="text-sm">{STAGE_LABEL[stage]}…</p>
              </>
            )}
            {uploadError && <Alert tone="error">{uploadError}</Alert>}
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-primary" onClick={save} disabled={!!stage} aria-describedby={statusId}>
              {uploadError ? 'Riprova' : useRemote ? 'Salva e carica' : 'Salva nel browser'}
            </button>
            {stage ? (
              <button type="button" className="btn-ghost" onClick={() => abortRef.current?.abort()}>
                Annulla caricamento
              </button>
            ) : (
              <button
                type="button"
                className="btn-ghost"
                onClick={() => {
                  if (pending.previewUrl) URL.revokeObjectURL(pending.previewUrl);
                  setPending(null);
                }}
              >
                Scarta
              </button>
            )}
          </div>
        </Section>
      )}

      <Section
        title={`File del progetto (${records.length})`}
        aside={
          records.length > 0 && (
            <button type="button" className="btn-ghost" onClick={exportList}>
              Esporta elenco (CSV + dizionario)
            </button>
          )
        }
      >
        {records.length === 0 && <p className="text-sm text-sand-600">Nessun file collegato a questo progetto.</p>}
        <ul className="grid gap-3 lg:grid-cols-2">
          {records.map((r) => {
            const o = opened[r.id];
            const isImage = ALLOWED_MEDIA[r.mime]?.image;
            return (
              <li key={r.id} className="rounded-xl border border-sand-200 p-3" aria-label={`${MEDIA_CATEGORY_LABEL[r.category].title}: ${r.originalName}`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-bold">{MEDIA_CATEGORY_LABEL[r.category].title}</p>
                    <p className="text-sm">{r.description || <span className="text-sand-600">Senza descrizione</span>}</p>
                  </div>
                  {r.storage === 'locale' ? (
                    <span className="rounded border-2 border-dashed border-ochre-800 bg-ochre-100 px-2 py-0.5 text-xs font-bold text-ochre-800">{LOCAL_BADGE}</span>
                  ) : r.status === 'caricamento' ? (
                    <span className="rounded bg-ochre-100 px-2 py-0.5 text-xs font-bold text-ochre-800">In quarantena: verifica del server non completata</span>
                  ) : r.status === 'eliminazione_in_corso' ? (
                    <span className="rounded bg-alert-100 px-2 py-0.5 text-xs font-bold text-alert-800">Eliminazione incompleta</span>
                  ) : (
                    <span className="rounded bg-leaf-100 px-2 py-0.5 text-xs font-bold text-leaf-800">Sul server (privato)</span>
                  )}
                </div>
                <p className="mt-1 text-xs text-sand-600">
                  {r.observedOn} · {r.author} · {formatBytes(r.sizeBytes)} · {r.originalName} · conservato fino al {r.retentionUntil}
                </p>
                <p className="text-xs text-sand-600">{describeContext(r, bundle).join(' · ')}</p>
                {r.locationConsent && r.location && <p className="text-xs">Posizione conservata con consenso: {r.location.lat}, {r.location.lon}</p>}
                {o && isImage && <img src={o.url} alt={`${MEDIA_CATEGORY_LABEL[r.category].title}: ${r.description || r.originalName}`} className="mt-2 max-h-72 w-full rounded-lg object-contain" />}
                {o && o.expiresAt && <p className="text-xs text-sand-600">Link temporaneo: scade dopo 60 secondi.</p>}
                {isAgri && isImage && <p className="mt-2 rounded bg-ochre-100 p-2 text-xs text-ochre-800">{AGRI_PHOTO_NOTICE}</p>}

                {editing === r.id ? (
                  <EditForm record={r} sector={sector} zones={zones} onCancel={() => setEditing(null)} onSave={(p) => saveEdit(r, p)} />
                ) : (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {isImage && r.status !== 'eliminazione_in_corso' && (
                      <button type="button" className="btn-ghost" disabled={busyId === r.id} onClick={() => open(r)}>
                        {o ? 'Aggiorna anteprima' : 'Mostra anteprima'}
                      </button>
                    )}
                    {r.status !== 'eliminazione_in_corso' && (
                      <button type="button" className="btn-secondary" disabled={busyId === r.id} onClick={() => open(r, true)}>
                        Scarica
                      </button>
                    )}
                    {canEditRecord(r) && r.status !== 'eliminazione_in_corso' && (
                      <button type="button" className="btn-ghost" onClick={() => setEditing(r.id)}>
                        Modifica collegamenti
                      </button>
                    )}
                    {canDeleteRecord(r) && (
                      <button type="button" className="btn-danger" disabled={busyId === r.id} onClick={() => askDelete(r)}>
                        {r.status === 'eliminazione_in_corso' ? 'Riprova eliminazione' : 'Elimina'}
                      </button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </Section>

      {remote && perms.canAdmin && online && <RetentionPanel organizationId={remote.organizationId} records={records} onChanged={refresh} />}

      <dialog ref={dialogRef} aria-labelledby="del-title" className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-xl p-0 backdrop:bg-sand-900/40" onClose={() => setConfirming(null)}>
        <div className="space-y-3 p-4">
          <h2 id="del-title" className="text-lg font-bold">
            Eliminare il file?
          </h2>
          <p className="text-sm">
            {confirming?.storage === 'server'
              ? 'Il file verrà rimosso dallo storage e dal progetto. I link già generati smetteranno di funzionare. Nel registro restano solo data, autore dell’operazione e categoria.'
              : 'Il file verrà rimosso da questo browser.'}{' '}
            L’operazione non è reversibile.
          </p>
          <div className="flex justify-end gap-2">
            <button ref={cancelRef} type="button" className="btn-ghost" onClick={() => dialogRef.current?.close()}>
              Annulla
            </button>
            <button type="button" className="btn-danger" onClick={doDelete}>
              Elimina definitivamente
            </button>
          </div>
        </div>
      </dialog>
    </div>
  );
}

function EditForm({
  record,
  sector,
  zones,
  onCancel,
  onSave,
}: {
  record: MediaRecord;
  sector: 'urban' | 'agriculture';
  zones: { id: string; name: string }[];
  onCancel: () => void;
  onSave: (p: Partial<MediaRecord>) => void;
}) {
  const [description, setDescription] = useState(record.description);
  const [category, setCategory] = useState<MediaCategory>(record.category);
  const [zoneId, setZoneId] = useState(record.zoneId ?? '');
  const [stage, setStage] = useState<WorkflowStage>(record.workflowStage);
  const id = useId();
  return (
    <div className="mt-2 grid gap-2 rounded-lg bg-sand-100 p-3 sm:grid-cols-2">
      <Field label="Descrizione" htmlFor={`${id}-d`}>
        <textarea id={`${id}-d`} className="input" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <Field label="Categoria" htmlFor={`${id}-c`}>
        <select id={`${id}-c`} className="input" value={category} onChange={(e) => setCategory(e.target.value as MediaCategory)}>
          {categoriesFor(sector).map((c) => (
            <option key={c} value={c}>
              {MEDIA_CATEGORY_LABEL[c].title}
            </option>
          ))}
        </select>
      </Field>
      {sector === 'agriculture' && (
        <Field label="Sottozona" htmlFor={`${id}-z`}>
          <select id={`${id}-z`} className="input" value={zoneId} onChange={(e) => setZoneId(e.target.value)}>
            <option value="">Tutta la parcella</option>
            {zones.map((z) => (
              <option key={z.id} value={z.id}>
                {z.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      <Field label="Fase del workflow" htmlFor={`${id}-s`}>
        <select id={`${id}-s`} className="input" value={stage} onChange={(e) => setStage(e.target.value as WorkflowStage)}>
          {WORKFLOW_STAGES.map((s) => (
            <option key={s} value={s}>
              {WORKFLOW_STAGE_LABEL[s]}
            </option>
          ))}
        </select>
      </Field>
      <div className="flex gap-2 sm:col-span-2">
        <button type="button" className="btn-primary" onClick={() => onSave({ description, category, workflowStage: stage, ...(sector === 'agriculture' ? { zoneId: zoneId || null } : {}) })}>
          Salva modifiche
        </button>
        <button type="button" className="btn-ghost" onClick={onCancel}>
          Annulla
        </button>
      </div>
    </div>
  );
}
