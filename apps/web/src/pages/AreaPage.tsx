import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  formatArea,
  geodesicAreaM2,
  newId,
  parseGeoJsonPolygons,
  pointInPolygon,
  polygonFromVertices,
  STORAGE_CRS,
  validateAoi,
  type Polygon,
  type VineyardZone,
} from '@mdt/domain';
import { MapView, type MapPolygon } from '../components/MapView';
import { Alert, Field, Section, Term } from '../components/ui';
import { ProjectMissing, useProject } from '../state/useProject';
import { todayRome } from '../state/store';
import { usePermissions } from '../state/permissions';
import { parseCoordinates, PathGuide } from '../components/guide';


export default function AreaPage() {
  const { bundle, ready, update } = useProject();
  const [draft, setDraft] = useState<Polygon | null>(null);
  const [draftName, setDraftName] = useState('');
  const [drawTarget, setDrawTarget] = useState<'aoi' | 'zona' | null>(null);
  const [coords, setCoords] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [zoneDraft, setZoneDraft] = useState<Polygon | null>(null);
  const [zoneName, setZoneName] = useState('');

  const validation = useMemo(() => (draft ? validateAoi(draft) : null), [draft]);
  const { canEdit } = usePermissions();
  if (!bundle) return <ProjectMissing ready={ready} />;
  const isAgri = bundle.project.sector === 'agriculture';
  const area = bundle.area;
  const locked = bundle.baselines.length > 0 || bundle.scenarios.length > 0;
  const zones = bundle.agri?.zones ?? [];

  const zoneValidation = (() => {
    if (!zoneDraft || !area) return null;
    const v = validateAoi(zoneDraft);
    const outside = (zoneDraft.coordinates[0] ?? []).filter((p) => !pointInPolygon(p[0]!, p[1]!, area.geometry)).length;
    if (outside) v.errors.push(`${outside} vertici fuori dalla parcella.`);
    v.valid = v.errors.length === 0;
    return v;
  })();

  const saveArea = async () => {
    if (!draft || !validation?.valid) return;
    await update(
      (b) => ({
        ...b,
        area: {
          id: newId(),
          name: draftName.trim() || (isAgri ? 'Parcella' : 'Area di interesse'),
          geometry: draft,
          crs: STORAGE_CRS,
          areaM2: geodesicAreaM2(draft),
          source: 'disegno',
          isDemonstrativeGeometry: false,
          createdAt: new Date().toISOString(),
        },
        agri: isAgri
          ? (b.agri ?? {
              setup: {
                crop: 'vite',
                cultivar: '',
                rootstock: '',
                spacing: '',
                irrigationSystem: 'nessuno',
                irrigationCapacityMmDay: null,
                phenology: { stage: null, confirmed: false, confirmedBy: null, confirmedAt: null },
                heatThresholdC: 35,
              },
              zones: [],
              observations: [],
              weather: null,
              weatherNote: 'Nessun dato meteo: usa "Aggiorna da Open-Meteo" nel Lab.',
              today: todayRome(),
            })
          : b.agri,
      }),
      { action: 'area', detail: `Area salvata (${formatArea(geodesicAreaM2(draft))})` },
    );
    setDraft(null);
    setMsg('Area salvata.');
  };

  const saveZone = async () => {
    if (!zoneDraft || !zoneValidation?.valid) return;
    const z: VineyardZone = {
      id: newId(),
      name: zoneName.trim() || `Zona ${String.fromCharCode(65 + zones.length)}`,
      geometry: zoneDraft,
      soilTexture: '',
      fieldCapacity: null,
      wiltingPoint: null,
      aspectDeg: null,
      slopePct: null,
    };
    await update((b) => ({ ...b, agri: b.agri ? { ...b.agri, zones: [...b.agri.zones, z] } : b.agri }), { action: 'zona', detail: `Sottozona "${z.name}" aggiunta` });
    setZoneDraft(null);
    setZoneName('');
  };

  const polygons: MapPolygon[] = [
    ...(area ? [{ id: 'aoi', geometry: area.geometry, kind: 'aoi' as const }] : []),
    ...zones.map((z) => ({ id: z.id, geometry: z.geometry, kind: 'zona' as const })),
    ...(draft ? [{ id: 'draft', geometry: draft, kind: 'intervento' as const }] : []),
    ...(zoneDraft ? [{ id: 'zdraft', geometry: zoneDraft, kind: 'intervento' as const }] : []),
  ];

  const onImport = async (file: File | undefined, target: 'aoi' | 'zona') => {
    if (!file) return;
    const res = parseGeoJsonPolygons(await file.text());
    if (!res.ok) return setMsg(res.errors.join(' '));
    const first = res.polygons[0]!;
    if (target === 'aoi') {
      setDraft(first.geometry);
      setDraftName(first.name);
    } else {
      setZoneDraft(first.geometry);
      setZoneName(first.name);
    }
    setMsg(res.polygons.length > 1 ? `Il file contiene ${res.polygons.length} poligoni: importato il primo ("${first.name}").` : null);
  };

  const labPath = `/progetti/${bundle.project.id}/${isAgri ? 'agricolo' : 'urbano'}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-sm text-sand-600">{bundle.project.name}</p>
          <h1 className="text-2xl font-extrabold text-petrol-900">{isAgri ? 'Parcella e sottozone' : 'Area di interesse'}</h1>
        </div>
        {area && (
          <Link to={labPath} className="btn-primary">
            Vai al Decision Lab →
          </Link>
        )}
      </div>

      <PathGuide
        where={{
          step: 2,
          what: isAgri ? 'i confini della parcella e delle sue sottozone.' : 'i confini dell’area da studiare (piazza, strada o parco).',
          why: 'tutti gli indicatori e i dati meteo si riferiscono a quest’area.',
          next: area ? { label: 'osserva gli indicatori nel Decision Lab', to: labPath } : undefined,
        }}
      />
      {msg && <Alert tone="info">{msg}</Alert>}

      <MapView
        ariaLabel={isAgri ? 'Mappa della parcella e delle sottozone' : "Mappa dell'area di interesse"}
        polygons={polygons}
        fitTo={draft ?? zoneDraft ?? area?.geometry ?? null}
        drawMode={drawTarget ? 'polygon' : null}
        onDrawComplete={(v) => {
          if (drawTarget === 'zona') setZoneDraft(polygonFromVertices(v));
          else setDraft(polygonFromVertices(v));
          setDrawTarget(null);
        }}
        onDrawCancel={() => setDrawTarget(null)}
        height="26rem"
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title={isAgri ? 'Parcella' : 'Area'}>
          {area ? (
            <dl className="grid grid-cols-[9rem_1fr] gap-y-1 text-sm">
              <dt className="font-semibold text-sand-600">Nome</dt>
              <dd>{area.name}</dd>
              <dt className="font-semibold text-sand-600">Superficie</dt>
              <dd>
                {formatArea(area.areaM2)} ({Math.round(area.areaM2).toLocaleString('it-IT')} m², calcolo geodetico)
              </dd>
              <dt className="font-semibold text-sand-600">
                <Term k="crs">CRS</Term>
              </dt>
              <dd>{area.crs} (WGS84)</dd>
              <dt className="font-semibold text-sand-600">Vertici</dt>
              <dd>{(area.geometry.coordinates[0]?.length ?? 1) - 1}</dd>
              <dt className="font-semibold text-sand-600">Origine</dt>
              <dd>{area.source}</dd>
              {area.isDemonstrativeGeometry && (
                <dd className="col-span-2 font-semibold text-ochre-800">Geometria dimostrativa approssimata: non è un rilievo ufficiale.</dd>
              )}
            </dl>
          ) : (
            <p className="text-sm">Nessuna area salvata. Disegnala sulla mappa, importa un GeoJSON o inserisci le coordinate.</p>
          )}

          {!canEdit ? (
            <p className="text-sm text-sand-600">Sola lettura: l’area può essere modificata solo da chi ha il ruolo “modifica”.</p>
          ) : locked ? (
            <Alert tone="warn">
              L’area ha già baseline o scenari collegati: non può essere sostituita senza invalidarli. Crea un nuovo progetto per un’area diversa.
            </Alert>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn-secondary" onClick={() => setDrawTarget('aoi')}>
                  Disegna {isAgri ? 'parcella' : 'area'}
                </button>
                <label className="btn-ghost cursor-pointer">
                  Importa GeoJSON
                  <input type="file" accept=".geojson,.json,application/geo+json" className="sr-only" onChange={(e) => onImport(e.target.files?.[0], 'aoi')} />
                </label>
              </div>
              <Field label="Oppure inserisci le coordinate (una per riga: latitudine, longitudine)" htmlFor="coords" hint="Alternativa accessibile da tastiera al disegno su mappa. Shapefile: conversione lato server in M1.">
                <textarea id="coords" className="input font-mono text-sm" rows={4} value={coords} onChange={(e) => setCoords(e.target.value)} placeholder={'41.56033, 14.66276\n41.56033, 14.66384\n41.56087, 14.66384'} />
              </Field>
              <button
                type="button"
                className="btn-ghost"
                onClick={() => {
                  const r = parseCoordinates(coords);
                  if (r.error) setMsg(r.error);
                  else setDraft(polygonFromVertices(r.vertices));
                }}
              >
                Usa queste coordinate
              </button>
            </div>
          )}
        </Section>

        {validation && draft && (
          <Section title="Verifica della geometria">
            {validation.valid ? <Alert tone="ok">Geometria valida.</Alert> : <Alert tone="error" title="La simulazione resta bloccata finché la geometria non è valida">{validation.errors.map((e) => <p key={e}>{e}</p>)}</Alert>}
            {validation.warnings.map((w) => (
              <Alert key={w} tone="warn">
                {w}
              </Alert>
            ))}
            {validation.areaM2 !== null && (
              <p className="text-sm">
                Superficie: <strong>{formatArea(validation.areaM2)}</strong> · CRS {STORAGE_CRS}
                {validation.centroid && ` · centro ${validation.centroid.lat.toFixed(5)}, ${validation.centroid.lon.toFixed(5)}`}
              </p>
            )}
            <Field label="Nome dell’area" htmlFor="aname">
              <input id="aname" className="input" value={draftName} onChange={(e) => setDraftName(e.target.value)} />
            </Field>
            <div className="flex gap-2">
              <button type="button" className="btn-primary" disabled={!validation.valid} onClick={saveArea}>
                Salva area
              </button>
              <button type="button" className="btn-ghost" onClick={() => setDraft(null)}>
                Scarta
              </button>
            </div>
          </Section>
        )}

        {isAgri && area && (
          <Section title="Sottozone della parcella">
            {zones.length === 0 && <p className="text-sm">Nessuna sottozona. Le zone servono a indicare dove controllare.</p>}
            <ul className="space-y-1 text-sm">
              {zones.map((z) => (
                <li key={z.id} className="flex items-center justify-between gap-2 rounded bg-sand-100 px-3 py-2">
                  <span>
                    <strong>{z.name}</strong> · {formatArea(geodesicAreaM2(z.geometry))}
                  </span>
                  {canEdit && (
                  <button
                    type="button"
                    className="btn-ghost text-alert-800"
                    disabled={bundle.decisions.length > 0}
                    onClick={() => update((b) => ({ ...b, agri: b.agri ? { ...b.agri, zones: b.agri.zones.filter((x) => x.id !== z.id) } : b.agri }), { action: 'zona', detail: `Sottozona "${z.name}" rimossa` })}
                  >
                    Rimuovi
                  </button>
                  )}
                </li>
              ))}
            </ul>
            {canEdit && (
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn-secondary" onClick={() => setDrawTarget('zona')}>
                Disegna sottozona
              </button>
              <label className="btn-ghost cursor-pointer">
                Importa GeoJSON
                <input type="file" accept=".geojson,.json" className="sr-only" onChange={(e) => onImport(e.target.files?.[0], 'zona')} />
              </label>
            </div>
            )}
            {zoneDraft && zoneValidation && (
              <div className="space-y-2">
                {zoneValidation.valid ? <Alert tone="ok">Sottozona valida ({formatArea(zoneValidation.areaM2 ?? 0)}).</Alert> : <Alert tone="error">{zoneValidation.errors.map((e) => <p key={e}>{e}</p>)}</Alert>}
                <Field label="Nome sottozona" htmlFor="zname">
                  <input id="zname" className="input" value={zoneName} onChange={(e) => setZoneName(e.target.value)} placeholder={`Zona ${String.fromCharCode(65 + zones.length)}`} />
                </Field>
                <div className="flex gap-2">
                  <button type="button" className="btn-primary" disabled={!zoneValidation.valid} onClick={saveZone}>
                    Salva sottozona
                  </button>
                  <button type="button" className="btn-ghost" onClick={() => setZoneDraft(null)}>
                    Scarta
                  </button>
                </div>
              </div>
            )}
          </Section>
        )}
      </div>
    </div>
  );
}
