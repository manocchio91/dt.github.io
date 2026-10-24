import type { Polygon } from 'geojson';
import type { AgriWeather, FieldObservation, VineyardZone } from '../agri/agriDemo';
import { createBaseline } from '../baseline/baseline';
import { dataValue, type DataValue, type Lineage } from '../data/dataValue';
import { geodesicAreaM2, polygonFromVertices, STORAGE_CRS, type Aoi } from '../geo/geo';
import { emptyBundle, type ProjectBundle } from '../project/bundle';
import { combineScenarios, createScenario, runScenario } from '../scenario/scenario';
import type { Intervention } from '../scenario/interventions';

/**
 * Seed DEMO. Tutti i valori sono SIMULATI e marcati isDemo; le geometrie sono
 * approssimate e dichiarate dimostrative.
 */

const DEMO_LINEAGE = (acquiredAt: string, note: string, extra: Partial<Lineage> = {}): Lineage => ({
  source: 'Dataset dimostrativo sintetico (DEMO)',
  acquiredAt,
  coordinates: 'area',
  transforms: [],
  quality: 'non valutata',
  limitations: ['Valore sintetico creato per la dimostrazione: non deriva da misure né da modelli.', note],
  usage: 'Baseline dimostrativa per testare interfaccia e comprensione.',
  isDemo: true,
  ...extra,
});

const sim = (key: string, label: string, unit: string, value: number, at: string, note: string, extra: Partial<Lineage> = {}): DataValue =>
  dataValue({ key, label, unit, value, dataClass: 'SIMULATO', lineage: DEMO_LINEAGE(at, note, extra) });

// ------------------------------------------------------------------ Campobasso

export const CAMPOBASSO_AOI: Polygon = polygonFromVertices([
  [14.66276, 41.56033],
  [14.66384, 41.56033],
  [14.66384, 41.56087],
  [14.66276, 41.56087],
]);

export function seedCampobasso(now: Date): ProjectBundle {
  const at = now.toISOString();
  let b = emptyBundle(
    {
      name: 'DEMO — Campobasso, Piazza Vittorio Emanuele II',
      sector: 'urban',
      mode: 'demo',
      isDemoSeed: true,
      description: 'Area campione dichiaratamente dimostrativa: geometria rettangolare approssimata, dati SIMULATI.',
    },
    now,
  );
  const area: Aoi = {
    id: `${b.project.id}-aoi`,
    name: 'Piazza Vittorio Emanuele II (geometria dimostrativa approssimata)',
    geometry: CAMPOBASSO_AOI,
    crs: STORAGE_CRS,
    areaM2: geodesicAreaM2(CAMPOBASSO_AOI),
    source: 'seed',
    isDemonstrativeGeometry: true,
    createdAt: at,
  };
  const baseline = createBaseline(
    {
      projectId: b.project.id,
      areaId: area.id,
      periodStart: '2025-07-15',
      periodEnd: '2025-08-15',
      referenceHourLocal: 15,
      values: [
        sim('t_air_ref_hour', 'Temperatura aria a 2 m, ore 15:00 (media periodo)', '°C', 29, at, 'Ordine di grandezza plausibile per Campobasso (~700 m s.l.m.) in estate.', { height: '2 m' }),
        sim('t_air_max_mean', 'Media delle temperature massime giornaliere', '°C', 29.8, at, 'Valore sintetico.', { height: '2 m' }),
        sim('t_surface_ref_hour', 'Temperatura superficiale pavimentazione soleggiata, ore 15:00', '°C', 47, at, 'Valore sintetico: in un pilota servirebbe LST satellitare o termocamera.'),
        sim('rh_ref_hour', 'Umidità relativa a 2 m, ore 15:00', '%', 38, at, 'Valore sintetico.', { height: '2 m' }),
        sim('wind_10m_ref_hour', 'Vento a 10 m, ore 15:00', 'm/s', 2.4, at, 'Valore sintetico, quota 10 m (non pedone).', { height: '10 m' }),
        sim('sw_radiation_ref_hour', 'Radiazione globale, ore 15:00', 'W/m²', 760, at, 'Valore sintetico.'),
        sim('frac_impervious', 'Quota di superficie impermeabile', 'frazione', 0.85, at, 'Stima visiva sintetica.'),
      ],
      qaNotes: ['Baseline DEMO: nessun controllo QA/QC applicabile a dati sintetici.'],
      sourceSummary: 'Dataset dimostrativo sintetico (DEMO)',
      isDemo: true,
    },
    now,
    `${b.project.id}-bl1`,
  );

  const rowA = 41.56043;
  const rowB = 41.56077;
  const lons = [14.6629, 14.66305, 14.6632, 14.66335, 14.6635, 14.66365];
  const trees: Intervention = {
    id: `${b.project.id}-i-alberi`,
    label: '12 alberi in due filari',
    type: 'albero',
    geometry: { type: 'MultiPoint', coordinates: [...lons.map((x) => [x, rowA]), ...lons.map((x) => [x, rowB])] },
    params: { tipologia: 'latifoglia media grandezza (es. Celtis australis)', diametroChiomaInizialeM: 3, diametroChiomaMaturaM: 8, etaAnni: 4 },
  };
  const sail: Intervention = {
    id: `${b.project.id}-i-vela`,
    label: 'Vela ombreggiante centrale',
    type: 'schermatura',
    geometry: polygonFromVertices([
      [14.66312, 41.56053],
      [14.66348, 41.56053],
      [14.66348, 41.56067],
      [14.66312, 41.56067],
    ]),
    params: { orientamento: 'est-ovest', oreOmbraGiorno: 7, materiale: 'tessuto tecnico microforato', ombraAllOraDiRiferimento: true },
  };
  const depave: Intervention = {
    id: `${b.project.id}-i-depaving`,
    label: 'Depaving lato est con aiuola',
    type: 'depaving',
    geometry: polygonFromVertices([
      [14.66355, 41.5604],
      [14.66379, 41.5604],
      [14.66379, 41.56051],
      [14.66355, 41.56051],
    ]),
    params: { materialeRimosso: 'lastricato su massetto', nuovaSuperficie: 'verde', permeabilitaPct: 90 },
  };

  const scA = createScenario(
    { projectId: b.project.id, label: 'A', description: 'Alberature: 12 alberi in due filari.', baselineId: baseline.id, horizon: 'maturita', interventions: [trees] },
    now,
    `${b.project.id}-scA`,
  );
  const scB = createScenario(
    { projectId: b.project.id, label: 'B', description: 'Ombra + depaving: vela centrale e aiuola sul lato est.', baselineId: baseline.id, horizon: 'maturita', interventions: [sail, depave] },
    now,
    `${b.project.id}-scB`,
  );
  const scAB = combineScenarios(scA, scB, now, `${b.project.id}-scAB`);
  const ctx = { aoi: area, baseline, computedAt: at };
  b = {
    ...b,
    area,
    baselines: [baseline],
    scenarios: [scA, scB, scAB],
    runs: [runScenario(scA, ctx), runScenario(scB, ctx), runScenario(scAB, ctx)],
  };
  b.audit.push({ at, action: 'seed', detail: 'Caricati dati DEMO Campobasso (SIMULATI)' });
  return b;
}

/** Misure ex-post di esempio: SIMULATE, servono solo a dimostrare il flusso. */
export const DEMO_EXPOST_CSV = `# Misure DIMOSTRATIVE SIMULATE — non sono misure reali
punto,fase,variabile,timestamp,valore,unita,sensore,classe
P1,ante,temperatura_superficiale,2025-07-20T15:00:00+02:00,47.5,°C,DEMO-IR-01,SIMULATO
P1,ante,temperatura_superficiale,2025-07-21T15:10:00+02:00,46.8,°C,DEMO-IR-01,SIMULATO
P2,ante,temperatura_superficiale,2025-07-20T15:05:00+02:00,48.1,°C,DEMO-IR-01,SIMULATO
P2,ante,temperatura_superficiale,2025-07-21T09:00:00+02:00,31.0,°C,DEMO-IR-01,SIMULATO
P1,post,temperatura_superficiale,2030-07-19T15:00:00+02:00,44.0,°C,DEMO-IR-01,SIMULATO
P1,post,temperatura_superficiale,2030-07-20T14:50:00+02:00,43.4,°C,DEMO-IR-01,SIMULATO
P2,post,temperatura_superficiale,2030-07-19T15:02:00+02:00,45.2,°C,DEMO-IR-01,SIMULATO
`;

export const DEMO_EXPOST_POINTS = [
  { id: 'P1', label: 'P1 — sotto filare nord', lon: 14.6632, lat: 41.56077 },
  { id: 'P2', label: 'P2 — sotto filare sud', lon: 14.6635, lat: 41.56043 },
];

// ---------------------------------------------------------------- Vigneto

export const VINEYARD_PARCEL: Polygon = polygonFromVertices([
  [14.919, 41.7993],
  [14.92141, 41.7993],
  [14.92141, 41.80065],
  [14.919, 41.80065],
]);

function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

export function seedVineyard(now: Date, today: string): ProjectBundle {
  const at = now.toISOString();
  let b = emptyBundle(
    {
      name: 'DEMO — Vigneto molisano (Tintilia)',
      sector: 'agriculture',
      mode: 'demo',
      isDemoSeed: true,
      description: 'Parcella dimostrativa con due sottozone. Meteo e suolo SIMULATI; fase fenologica da confermare.',
    },
    now,
  );
  const area: Aoi = {
    id: `${b.project.id}-parcel`,
    name: 'Parcella DEMO (geometria dimostrativa approssimata)',
    geometry: VINEYARD_PARCEL,
    crs: STORAGE_CRS,
    areaM2: geodesicAreaM2(VINEYARD_PARCEL),
    source: 'seed',
    isDemonstrativeGeometry: true,
    createdAt: at,
  };
  const zones: VineyardZone[] = [
    {
      id: `${b.project.id}-zA`,
      name: 'Zona A',
      geometry: polygonFromVertices([
        [14.919, 41.7993],
        [14.9202, 41.7993],
        [14.9202, 41.80065],
        [14.919, 41.80065],
      ]),
      soilTexture: 'franco-sabbioso, poco profondo',
      fieldCapacity: 0.25,
      wiltingPoint: 0.12,
      aspectDeg: 210,
      slopePct: 8,
    },
    {
      id: `${b.project.id}-zB`,
      name: 'Zona B',
      geometry: polygonFromVertices([
        [14.9202, 41.7993],
        [14.92141, 41.7993],
        [14.92141, 41.80065],
        [14.9202, 41.80065],
      ]),
      soilTexture: 'franco, profondo',
      fieldCapacity: 0.24,
      wiltingPoint: 0.08,
      aspectDeg: 120,
      slopePct: 4,
    },
  ];
  const tmax = [30, 31, 33, 34, 35.5, 33, 31, 30, 31, 32, 33, 34, 33, 32];
  const weather: AgriWeather = {
    dailyTmax: tmax.map((v, k) => ({ date: addDays(today, k - tmax.length), value: v })),
    dailyTmaxClass: 'SIMULATO',
    dailyTmaxLineage: DEMO_LINEAGE(at, 'Serie sintetica di 14 giorni.', { temporalResolution: 'giornaliera', height: '2 m' }),
    soilMoisture: sim('soil_moisture', 'Umidità volumetrica del suolo 9–27 cm', 'm³/m³', 0.15, at, "Stima riferita all'area, non misurata sul terreno.", { depth: '9–27 cm' }),
    precipitation14d: sim('precipitation_14d', 'Precipitazione cumulata 14 giorni', 'mm', 3.2, at, 'Valore sintetico.'),
  };
  const observations: FieldObservation[] = [
    {
      id: `${b.project.id}-obs1`,
      zoneId: zones[0]!.id,
      date: addDays(today, -2),
      category: 'trappola',
      note: 'catture in trappola a feromoni in aumento — da verificare',
      dataClass: 'SIMULATO',
    },
  ];
  b = {
    ...b,
    area,
    agri: {
      setup: {
        crop: 'vite',
        cultivar: 'Tintilia',
        rootstock: '1103 Paulsen',
        spacing: '2,40 × 1,00 m',
        irrigationSystem: 'soccorso_mobile',
        irrigationCapacityMmDay: 2,
        phenology: { stage: 'invaiatura', confirmed: false, confirmedBy: null, confirmedAt: null },
        heatThresholdC: 35,
      },
      zones,
      observations,
      weather,
      weatherNote: 'Meteo e suolo SIMULATI (seed DEMO). Usa "Aggiorna da Open-Meteo" per stime modellistiche reali.',
      today,
    },
  };
  b.audit.push({ at, action: 'seed', detail: 'Caricati dati DEMO vigneto (SIMULATI)' });
  return b;
}

