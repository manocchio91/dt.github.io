import type { Polygon } from 'geojson';
import { dataValue, missingValue, type DataValue, type Lineage } from '../data/dataValue';
import type { ModelAdapterMeta } from '../models/adapter';

/**
 * AgricultureModelAdapter DEMO per il vigneto. Nessun indice composito:
 * le componenti (stress termico, stress idrico, fenologia, segnali
 * fitosanitari) restano separate. La priorità è una regola dichiarata
 * (massimo tra i livelli), non un punteggio opaco. Nessuna prescrizione.
 */

export const PHENOLOGY_STAGES = [
  'germogliamento',
  'fioritura',
  'allegagione',
  'chiusura_grappolo',
  'invaiatura',
  'maturazione',
  'post_vendemmia',
] as const;
export type PhenologyStage = (typeof PHENOLOGY_STAGES)[number];

export const PHENOLOGY_LABEL: Record<PhenologyStage, string> = {
  germogliamento: 'Germogliamento',
  fioritura: 'Fioritura',
  allegagione: 'Allegagione',
  chiusura_grappolo: 'Chiusura grappolo',
  invaiatura: 'Invaiatura',
  maturazione: 'Maturazione',
  post_vendemmia: 'Post-vendemmia',
};

export interface VineyardZone {
  id: string;
  name: string;
  geometry: Polygon;
  soilTexture: string;
  /** contenuto idrico volumetrico alla capacità di campo, m³/m³ */
  fieldCapacity: number | null;
  /** contenuto idrico volumetrico al punto di appassimento, m³/m³ */
  wiltingPoint: number | null;
  aspectDeg: number | null;
  slopePct: number | null;
}

export interface VineyardSetup {
  crop: 'vite';
  cultivar: string;
  rootstock: string;
  spacing: string;
  irrigationSystem: 'nessuno' | 'goccia' | 'soccorso_mobile';
  irrigationCapacityMmDay: number | null;
  phenology: { stage: PhenologyStage | null; confirmed: boolean; confirmedBy: string | null; confirmedAt: string | null };
  /** Soglia DEMO modificabile, da validare con l'agronomo */
  heatThresholdC: number;
}

export interface FieldObservation {
  id: string;
  zoneId: string;
  date: string; // YYYY-MM-DD
  category: 'trappola' | 'visivo' | 'misura_suolo' | 'altro';
  note: string;
  value?: number;
  unit?: string;
  dataClass: 'INSERITO_DALL_UTENTE' | 'MISURATO' | 'SIMULATO';
}

export interface AgriWeather {
  dailyTmax: { date: string; value: number }[];
  dailyTmaxClass: DataValue['dataClass'];
  dailyTmaxLineage: Lineage;
  /** Umidità volumetrica del suolo stimata per l'area (con profondità nel lineage) */
  soilMoisture: DataValue;
  precipitation14d: DataValue;
}

export type ComponentLevel = 'basso' | 'moderato' | 'elevato' | 'non determinabile';
export type Priority = 'alta' | 'media' | 'bassa' | 'non determinabile';
export type Confidence = 'alta' | 'media' | 'bassa' | 'molto bassa';

export interface ZoneComponent {
  key: 'stress_termico' | 'stress_idrico' | 'fenologia' | 'fitosanitario';
  label: string;
  level: ComponentLevel;
  value: DataValue;
  explanation: string;
}

export interface MeasureEvaluation {
  id: 'nessun_intervento' | 'sopralluogo' | 'irrigazione_soccorso' | 'gestione_suolo' | 'ombreggiamento';
  label: string;
  availability: 'valutabile' | 'non valutabile';
  missing: string[];
  text: string;
  pros: string[];
  cons: string[];
  timeframe: string;
}

export interface ZoneAssessment {
  zoneId: string;
  zoneName: string;
  components: ZoneComponent[];
  priority: Priority;
  priorityRule: string;
  confidence: Confidence;
  confidenceReasons: string[];
  missingData: string[];
  motivation: string;
  measures: MeasureEvaluation[];
}

export const DEMO_AGRI_META: ModelAdapterMeta = {
  id: 'demo-vineyard-components',
  version: '0.1.0',
  kind: 'agriculture',
  name: 'Componenti di stress del vigneto (illustrativo)',
  maturity: 'demo-illustrative',
  validityScope: 'Vigneto in asciutto o con irrigazione di soccorso, stagione vegetativa. Non per diagnosi fitosanitarie.',
  requiredInputs: [
    'parcella/sottozone georiferite',
    'fase fenologica confermata dall’utente',
    'serie Tmax giornaliera (≥7 giorni)',
    'umidità del suolo (stima o misura) con profondità',
    'capacità di campo e punto di appassimento per zona (per lo stress idrico)',
  ],
  outputs: [
    { key: 'stress_termico', unit: 'giorni', description: 'Giorni con Tmax ≥ soglia negli ultimi 14 giorni' },
    { key: 'stress_idrico', unit: 'frazione', description: 'Frazione di acqua disponibile (θ − θpa)/(θcc − θpa)' },
    { key: 'fenologia', unit: '—', description: 'Fase fenologica confermata' },
    { key: 'fitosanitario', unit: 'segnalazioni', description: 'Segnalazioni da osservazioni in campo (non diagnosi)' },
  ],
  assumptions: [
    'Soglia di stress termico DEMO (default 35 °C) modificabile e da validare con l’agronomo per cultivar e fase.',
    'Soglie di acqua disponibile DEMO: < 0,3 elevato, 0,3–0,5 moderato, > 0,5 basso.',
    'L’umidità del suolo da modello è una stima riferita all’area: non distingue le zone; la differenza tra zone deriva dai parametri del suolo inseriti.',
    'Priorità = livello massimo tra stress termico e idrico; una segnalazione fitosanitaria porta la priorità almeno a "media".',
    'La fase fenologica non viene mai dedotta automaticamente.',
  ],
  scientificSource:
    'Bilancio idrico semplificato (acqua disponibile tra capacità di campo e punto di appassimento, concetto FAO-56). Soglie illustrative DEMO non validate (backlog M-03).',
  uncertaintyMethod: 'Livello di fiducia qualitativo ridotto da ogni dato mancante dichiarato.',
  validationDate: null,
  reviewer: null,
  parameters: [
    { key: 'soglia_tmax', label: 'Soglia Tmax stress termico', unit: '°C', low: 33, central: 35, high: 37, source: 'Parametro DEMO da validare' },
    { key: 'soglia_acqua_elevato', label: 'Acqua disponibile — soglia stress elevato', unit: 'frazione', low: 0.25, central: 0.3, high: 0.35, source: 'Parametro DEMO da validare' },
    { key: 'soglia_acqua_moderato', label: 'Acqua disponibile — soglia stress moderato', unit: 'frazione', low: 0.45, central: 0.5, high: 0.55, source: 'Parametro DEMO da validare' },
  ],
  testFile: 'packages/domain/src/agri/agriDemo.test.ts',
};

export const IRRIGATION_CONDITIONAL_TEXT = (zoneName: string) =>
  `I dati disponibili indicano una possibile criticità idrica nella ${zoneName}. Prima di intervenire verifica umidità del suolo, fase fenologica, disponibilità d'acqua e indicazioni dell'agronomo.`;

const LEVEL_RANK: Record<ComponentLevel, number> = { 'non determinabile': -1, basso: 0, moderato: 1, elevato: 2 };

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
}

export interface AgriModelInput {
  setup: VineyardSetup;
  zones: readonly VineyardZone[];
  weather: AgriWeather | null;
  observations: readonly FieldObservation[];
  today: string; // YYYY-MM-DD
  computedAt: string;
  isDemo: boolean;
}

export function runDemoAgriModel(input: AgriModelInput): ZoneAssessment[] {
  const { setup, weather, today } = input;
  const baseLineage = (formula: string, extra: Partial<Lineage> = {}): Lineage => ({
    source: 'Calcolo delle componenti con modello dichiarato',
    acquiredAt: input.computedAt,
    coordinates: 'area',
    transforms: [],
    formula,
    modelId: DEMO_AGRI_META.id,
    modelVersion: DEMO_AGRI_META.version,
    quality: 'non valutata',
    limitations: ['Soglie DEMO non validate.'],
    isDemo: input.isDemo,
    ...extra,
  });

  return input.zones.map((zone) => {
    const missing: string[] = [];
    const reasons: string[] = [];
    let score = 4;
    const zoneObs = input.observations.filter((o) => o.zoneId === zone.id);

    // Stress termico
    let heat: ZoneComponent;
    // finestra: i 14 giorni precedenti la data di riferimento (oggi escluso, dato parziale)
    const series = weather?.dailyTmax.filter((d) => daysBetween(d.date, today) >= 1 && daysBetween(d.date, today) <= 14) ?? [];
    if (series.length < 7) {
      missing.push('serie Tmax giornaliera di almeno 7 giorni');
      score -= 1;
      reasons.push('Serie meteo insufficiente (< 7 giorni).');
      heat = {
        key: 'stress_termico',
        label: 'Stress termico',
        level: 'non determinabile',
        value: missingValue('stress_termico', 'Giorni con Tmax ≥ soglia (14 gg)', 'giorni', 'Serie Tmax insufficiente.'),
        explanation: 'Non determinabile: mancano dati meteo sufficienti.',
      };
    } else {
      const hot = series.filter((d) => d.value >= setup.heatThresholdC).length;
      const maxT = Math.max(...series.map((d) => d.value));
      const level: ComponentLevel = hot >= 3 ? 'elevato' : hot >= 1 ? 'moderato' : 'basso';
      heat = {
        key: 'stress_termico',
        label: 'Stress termico',
        level,
        value: dataValue({
          key: 'stress_termico',
          label: `Giorni con Tmax ≥ ${setup.heatThresholdC} °C (ultimi ${series.length} gg)`,
          unit: 'giorni',
          value: hot,
          dataClass: weather!.dailyTmaxClass === 'SIMULATO' ? 'SIMULATO' : 'STIMATO_DA_MODELLO',
          lineage: baseLineage(`conteggio giorni con Tmax ≥ ${setup.heatThresholdC} °C`, {
            source: weather!.dailyTmaxLineage.source,
            endpoint: weather!.dailyTmaxLineage.endpoint,
            transforms: ['conteggio su finestra di 14 giorni'],
            limitations: [...weather!.dailyTmaxLineage.limitations, 'Temperatura dell’aria, non della chioma o del grappolo.'],
          }),
        }),
        explanation: `${hot} giorni su ${series.length} con Tmax ≥ ${setup.heatThresholdC} °C (massima ${maxT.toFixed(0)} °C). Soglia DEMO da validare.`,
      };
      if (zone.aspectDeg !== null && zone.aspectDeg >= 135 && zone.aspectDeg <= 255) {
        heat.explanation += ' Esposizione sud/sud-ovest: maggiore radiazione sui grappoli, da verificare in campo.';
      }
    }

    // Stress idrico
    let water: ZoneComponent;
    const fieldSoil = zoneObs
      .filter((o) => o.category === 'misura_suolo' && o.value !== undefined && daysBetween(o.date, today) <= 3 && daysBetween(o.date, today) >= 0)
      .sort((a, b) => b.date.localeCompare(a.date))[0];
    const theta = fieldSoil?.value ?? (weather && weather.soilMoisture.dataClass !== 'DATO_MANCANTE' ? weather.soilMoisture.value : null);
    if (!fieldSoil) {
      score -= 1;
      reasons.push('Umidità del suolo solo stimata dal modello per l’area, non misurata nella zona.');
    }
    if (zone.fieldCapacity === null || zone.wiltingPoint === null || zone.fieldCapacity <= zone.wiltingPoint) {
      score -= 1;
      missing.push('capacità di campo e punto di appassimento della zona');
      reasons.push('Parametri idrologici del suolo mancanti.');
    }
    if (theta === null || zone.fieldCapacity === null || zone.wiltingPoint === null || zone.fieldCapacity <= zone.wiltingPoint) {
      if (theta === null) missing.push('umidità del suolo');
      water = {
        key: 'stress_idrico',
        label: 'Stress idrico',
        level: 'non determinabile',
        value: missingValue('stress_idrico', 'Acqua disponibile nel suolo', 'frazione', 'Mancano umidità del suolo o parametri del suolo della zona.'),
        explanation: 'Non determinabile: servono umidità del suolo e parametri del suolo della zona.',
      };
    } else {
      const fraction = Math.min(1, Math.max(0, (theta - zone.wiltingPoint) / (zone.fieldCapacity - zone.wiltingPoint)));
      const rounded = Math.round(fraction * 20) / 20;
      const level: ComponentLevel = fraction < 0.3 ? 'elevato' : fraction <= 0.5 ? 'moderato' : 'basso';
      const soilSrc = fieldSoil
        ? `misura in campo del ${fieldSoil.date}`
        : `${weather!.soilMoisture.lineage.source} (${weather!.soilMoisture.lineage.depth ?? 'profondità n.d.'}) — stima riferita all'area, non misurata sul terreno`;
      water = {
        key: 'stress_idrico',
        label: 'Stress idrico',
        level,
        value: dataValue({
          key: 'stress_idrico',
          label: 'Acqua disponibile nel suolo (frazione)',
          unit: 'frazione 0–1',
          value: rounded,
          dataClass: fieldSoil ? (fieldSoil.dataClass === 'MISURATO' ? 'MISURATO' : fieldSoil.dataClass) : weather!.soilMoisture.dataClass === 'SIMULATO' ? 'SIMULATO' : 'STIMATO_DA_MODELLO',
          lineage: baseLineage('(θ − θpa) / (θcc − θpa), limitata a [0,1], arrotondata a 0,05', {
            transforms: [`θ = ${theta.toFixed(3)} m³/m³ da ${soilSrc}`, `θcc = ${zone.fieldCapacity}, θpa = ${zone.wiltingPoint} (inseriti dall'utente)`],
            limitations: [
              'Soglie DEMO: < 0,3 elevato, 0,3–0,5 moderato, > 0,5 basso.',
              ...(fieldSoil ? [] : ['Stima riferita all’area, non misurata sul terreno.']),
            ],
          }),
        }),
        explanation: `Acqua disponibile ≈ ${rounded.toLocaleString('it-IT')} (θ ${theta.toLocaleString('it-IT', { maximumFractionDigits: 3 })} m³/m³; suolo ${zone.soilTexture}). Fonte θ: ${soilSrc}.`,
      };
    }

    // Fenologia
    let pheno: ZoneComponent;
    if (!setup.phenology.stage || !setup.phenology.confirmed) {
      score -= 1;
      missing.push('conferma della fase fenologica');
      reasons.push('Fase fenologica non confermata.');
      pheno = {
        key: 'fenologia',
        label: 'Fase fenologica',
        level: 'non determinabile',
        value: missingValue('fenologia', 'Fase fenologica', '—', setup.phenology.stage ? `Selezionata "${PHENOLOGY_LABEL[setup.phenology.stage]}" ma non confermata.` : 'Non selezionata.'),
        explanation: 'La fase non viene dedotta automaticamente: selezionala e confermala.',
      };
    } else {
      const sensitive = ['fioritura', 'allegagione', 'invaiatura'].includes(setup.phenology.stage);
      pheno = {
        key: 'fenologia',
        label: 'Fase fenologica',
        level: 'basso',
        value: dataValue({
          key: 'fenologia',
          label: `Fase: ${PHENOLOGY_LABEL[setup.phenology.stage]}`,
          unit: '—',
          value: PHENOLOGY_STAGES.indexOf(setup.phenology.stage),
          dataClass: 'INSERITO_DALL_UTENTE',
          lineage: baseLineage('selezione e conferma esplicita', {
            source: `Confermata da ${setup.phenology.confirmedBy ?? 'utente'} il ${setup.phenology.confirmedAt?.slice(0, 10) ?? 'n.d.'}`,
            limitations: ['Valore numerico = indice della fase nell’elenco, solo per ordinamento.'],
          }),
        }),
        explanation: sensitive
          ? `Fase ${PHENOLOGY_LABEL[setup.phenology.stage]}: fase sensibile, gli stress vanno interpretati con l'agronomo (un deficit moderato può essere voluto in alcune fasi).`
          : `Fase ${PHENOLOGY_LABEL[setup.phenology.stage]} confermata.`,
      };
    }

    // Segnali fitosanitari
    const phytoObs = zoneObs.filter((o) => (o.category === 'trappola' || o.category === 'visivo') && daysBetween(o.date, today) <= 14);
    const phyto: ZoneComponent = {
      key: 'fitosanitario',
      label: 'Segnali fitosanitari',
      level: phytoObs.length ? 'moderato' : 'basso',
      value: dataValue({
        key: 'fitosanitario',
        label: 'Segnalazioni da osservazioni (14 gg)',
        unit: 'segnalazioni',
        value: phytoObs.length,
        dataClass: phytoObs.some((o) => o.dataClass === 'SIMULATO') ? 'SIMULATO' : 'INSERITO_DALL_UTENTE',
        lineage: baseLineage('conteggio osservazioni trappola/visive degli ultimi 14 giorni', {
          source: 'Osservazioni in campo registrate',
          limitations: ['Conteggio di segnalazioni: non è una diagnosi fitosanitaria.'],
        }),
      }),
      explanation: phytoObs.length
        ? `${phytoObs.length} segnalazioni da verificare: ${phytoObs.map((o) => o.note).join('; ')}. Non costituisce diagnosi.`
        : 'Nessuna segnalazione registrata negli ultimi 14 giorni (assenza di segnalazioni ≠ assenza di problemi).',
    };
    const recentObs = zoneObs.some((o) => daysBetween(o.date, today) <= 7 && daysBetween(o.date, today) >= 0);
    if (!recentObs) {
      score -= 1;
      missing.push('osservazione in campo degli ultimi 7 giorni');
      reasons.push('Nessuna osservazione in campo recente.');
    }

    // Priorità (regola dichiarata)
    const maxRank = Math.max(LEVEL_RANK[heat.level], LEVEL_RANK[water.level]);
    let priority: Priority =
      maxRank === 2 ? 'alta' : maxRank === 1 ? 'media' : maxRank === 0 ? 'bassa' : 'non determinabile';
    if (phyto.level === 'moderato' && (priority === 'bassa' || priority === 'non determinabile')) priority = 'media';

    const confidence: Confidence = score >= 4 ? 'alta' : score === 3 ? 'media' : score === 2 ? 'bassa' : 'molto bassa';

    const drivers = [heat, water, phyto].filter((c) => c.level === 'elevato' || c.level === 'moderato');
    const motivation = drivers.length
      ? `${zone.name}: segnalata per ${drivers.map((c) => `${c.label.toLowerCase()} ${c.level}`).join(', ')}. Fiducia ${confidence}${reasons.length ? ` perché: ${reasons.join(' ').toLowerCase()}` : ''}`
      : `${zone.name}: nessuna componente sopra le soglie DEMO. Fiducia ${confidence}.`;

    const measures = evaluateMeasures(zone, setup, water, heat, priority, confidence);

    return {
      zoneId: zone.id,
      zoneName: zone.name,
      components: [heat, water, pheno, phyto],
      priority,
      priorityRule: DEMO_AGRI_META.assumptions[3]!,
      confidence,
      confidenceReasons: reasons,
      missingData: missing,
      motivation,
      measures,
    };
  });
}

function evaluateMeasures(
  zone: VineyardZone,
  setup: VineyardSetup,
  water: ZoneComponent,
  heat: ZoneComponent,
  priority: Priority,
  confidence: Confidence,
): MeasureEvaluation[] {
  const irrigationMissing: string[] = [];
  if (water.level === 'non determinabile') irrigationMissing.push('stress idrico determinabile');
  if (!setup.phenology.confirmed) irrigationMissing.push('fase fenologica confermata');
  if (setup.irrigationSystem === 'nessuno') irrigationMissing.push('sistema irriguo disponibile');
  if (!setup.irrigationCapacityMmDay) irrigationMissing.push('capacità irrigua disponibile (mm/giorno)');

  return [
    {
      id: 'nessun_intervento',
      label: 'Nessun intervento',
      availability: 'valutabile',
      missing: [],
      text:
        priority === 'alta'
          ? 'Possibile, ma con componenti elevate il rischio di danno non è escluso: valuta almeno un sopralluogo.'
          : 'Coerente con i dati disponibili se il sopralluogo non evidenzia sintomi.',
      pros: ['nessun costo', 'nessun consumo idrico'],
      cons: ['rischio di sottovalutare uno stress reale'],
      timeframe: '—',
    },
    {
      id: 'sopralluogo',
      label: 'Sopralluogo e consulto agronomo',
      availability: 'valutabile',
      missing: [],
      text:
        priority === 'alta' || priority === 'media' || confidence === 'bassa' || confidence === 'molto bassa'
          ? `Consigliato come primo passo: verifica in ${zone.name} sintomi su foglie e grappoli, umidità del suolo con sonda o trivella e stato fenologico.`
          : 'Facoltativo: utile per confermare l’assenza di criticità.',
      pros: ['aumenta la fiducia dei dati', 'nessun consumo idrico'],
      cons: ['tempo dell’operatore'],
      timeframe: 'entro 1–3 giorni',
    },
    {
      id: 'irrigazione_soccorso',
      label: 'Irrigazione di soccorso condizionata',
      availability: irrigationMissing.length ? 'non valutabile' : 'valutabile',
      missing: irrigationMissing,
      text: irrigationMissing.length
        ? `Non valutabile: mancano ${irrigationMissing.join(', ')}. Nessun consiglio irriguo senza input minimi.`
        : water.level === 'elevato' || water.level === 'moderato'
          ? IRRIGATION_CONDITIONAL_TEXT(zone.name)
          : `I dati disponibili non indicano criticità idrica nella ${zone.name}. Un'irrigazione non appare motivata dai dati; verifica comunque con l'agronomo.`,
      pros: ['riduce lo stress idrico se confermato'],
      cons: ['consumo d’acqua', 'possibile effetto su qualità e vigore se non calibrata', 'vincoli di disciplinare'],
      timeframe: 'solo dopo verifica',
    },
    {
      id: 'gestione_suolo',
      label: 'Gestione del suolo / cover crop',
      availability: 'valutabile',
      missing: [],
      text: 'Misura di medio periodo per la ritenzione idrica e la struttura del suolo. In estate una cover crop può competere per l’acqua: valutare tipo e gestione con l’agronomo.',
      pros: ['struttura del suolo', 'infiltrazione', 'riduzione erosione su pendenza'],
      cons: ['possibile competizione idrica estiva', 'effetti non immediati'],
      timeframe: 'stagione successiva',
    },
    {
      id: 'ombreggiamento',
      label: 'Ombreggiamento (reti) o gestione della chioma',
      availability: heat.level === 'non determinabile' ? 'non valutabile' : 'valutabile',
      missing: heat.level === 'non determinabile' ? ['stress termico determinabile'] : [],
      text:
        heat.level === 'elevato'
          ? 'Possibile contro le scottature dei grappoli in giornate molto calde; costi e effetti su maturazione da valutare con l’agronomo.'
          : 'Poco motivato dai dati attuali sullo stress termico.',
      pros: ['protezione dei grappoli da scottature'],
      cons: ['costo di installazione', 'possibile ritardo di maturazione'],
      timeframe: 'settimane',
    },
  ];
}

export const PRIORITY_RANK: Record<Priority, number> = { alta: 3, media: 2, bassa: 1, 'non determinabile': 0 };
