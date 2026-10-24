/** Registro F01–F31 (§16 + F31 previsioni) con stato visibile e evidenza verificabile. */

export type FeatureStatus = 'operativa' | 'beta' | 'dimostrativa' | 'roadmap' | 'non_disponibile';

export const FEATURE_STATUS_LABEL: Record<FeatureStatus, string> = {
  operativa: 'Operativa',
  beta: 'Beta',
  dimostrativa: 'Dimostrativa',
  roadmap: 'Roadmap',
  non_disponibile: 'Non disponibile per dati mancanti',
};

export interface FeatureEntry {
  id: string;
  title: string;
  criterion: string;
  status: FeatureStatus;
  milestone: 0 | 1 | 2;
  evidence: string[];
  gap: string;
  /** requisiti collegati (tracciabilità) */
  traces?: string[];
}

export const FEATURES: FeatureEntry[] = [
  { id: 'F01', title: 'Onboarding per ruolo', criterion: 'primo scenario ≤ 5 min', status: 'operativa', milestone: 1, evidence: ['packages/domain/src/onboarding/onboarding.test.ts', 'apps/web/src/test/onboarding.test.tsx', 'e2e/onboarding.spec.ts', 'pagina /benvenuto'], gap: 'Tempi misurati con browser automatico (flusso < 2 min / < 5 min); i tempi con utenti reali vanno misurati negli Sprint 2–3.' },
  { id: 'F02', title: 'AOI reale', criterion: 'geometria e superficie salvate', status: 'operativa', milestone: 0, evidence: ['packages/domain/src/geo/geo.test.ts', 'pagina /progetti/:id/area'], gap: 'Ricerca località (geocodifica) in M1.' },
  { id: 'F03', title: 'Mappa 2D/3D', criterion: 'coordinate, legenda e layer coerenti; 3D non decorativo', status: 'beta', milestone: 1, evidence: ['apps/web/src/components/MapView.tsx'], gap: '2D operativa con legenda e coordinate; 3D non implementato (B-116).' },
  { id: 'F04', title: 'Meteo', criterion: 'fonte, timestamp, timezone, coordinate e fallback visibili', status: 'beta', milestone: 0, evidence: ['packages/domain/src/connectors/openMeteo.test.ts', 'packages/domain/src/connectors/openMeteoForecast.test.ts', 'supabase/tests/weather.test.ts', 'apps/web/src/test/weatherPanel.test.tsx', 'e2e/weather.spec.ts', 'scripts/open-meteo-smoke.mjs', 'docs/16-open-meteo-supabase.md'], gap: 'Acquisizione ufficiale server-side (Edge Function open-meteo-ingest, pg_cron ogni 3 h, tabelle weather_* con RLS) implementata e testata in locale; smoke test reale verso Open-Meteo superato. Non ancora pubblicata né verificata su Supabase reale. Il connettore diretto dal client resta per la baseline del Decision Lab.' },
  { id: 'F05', title: 'Sensori', criterion: 'fonte, timestamp, unità e flag qualità', status: 'beta', milestone: 1, evidence: ['packages/domain/src/data/qa.test.ts'], gap: 'QA/QC nel dominio; anagrafica e import sensori in UI in M1 (B-105).' },
  { id: 'F06', title: 'Satellite', criterion: 'prodotto, data, risoluzione, nuvolosità e limiti', status: 'non_disponibile', milestone: 1, evidence: [], gap: 'Nessun prodotto/credenziale Copernicus definito (M-06).' },
  { id: 'F07', title: 'Griglia', criterion: 'ogni cella collegata a geometria, input e modello', status: 'operativa', milestone: 0, evidence: ['packages/domain/src/geo/geo.test.ts', 'packages/domain/src/models/urbanDemo.test.ts'], gap: '' },
  { id: 'F08', title: 'Interventi urbani', criterion: 'quantità fisiche plausibili e coerenti con l’AOI', status: 'operativa', milestone: 0, evidence: ['packages/domain/src/scenario/interventions.test.ts'], gap: '' },
  { id: 'F09', title: 'KPI climatici', criterion: 'definizione, formula, unità, quota, ora e soglia', status: 'dimostrativa', milestone: 0, evidence: ['packages/domain/src/models/urbanDemo.test.ts', 'pagina /metodo'], gap: 'Coefficienti illustrativi; UTCI/WBGT non calcolati (M-02).' },
  { id: 'F10', title: 'Rifugi climatici', criterion: 'rete pedonale, accessibilità e copertura reale', status: 'roadmap', milestone: 1, evidence: [], gap: 'Non implementato (B-118).' },
  { id: 'F11', title: 'Vigneto', criterion: 'parcelle georiferite e input espliciti', status: 'operativa', milestone: 0, evidence: ['packages/domain/src/agri/agriDemo.test.ts', 'pagina /progetti/:id/agricolo'], gap: '' },
  { id: 'F12', title: 'Stress/fenologia', criterion: 'componenti separate, formula/versione e validazione', status: 'dimostrativa', milestone: 0, evidence: ['packages/domain/src/agri/agriDemo.test.ts'], gap: 'Soglie DEMO non validate (M-03).' },
  { id: 'F13', title: 'Irrigazione', criterion: 'nessun consiglio senza input minimo e livello di fiducia', status: 'operativa', milestone: 0, evidence: ['packages/domain/src/agri/agriDemo.test.ts'], gap: '' },
  { id: 'F14', title: 'Scenari', criterion: 'A/B con stessi presupposti e confronto ≤ 10 min', status: 'operativa', milestone: 0, evidence: ['packages/domain/src/scenario/scenario.test.ts', 'pagina /progetti/:id/confronto'], gap: 'Tempo ≤ 10 min da verificare con utenti (Sprint 2).' },
  { id: 'F15', title: 'Incertezza', criterion: 'significato compreso, nessuna falsa precisione', status: 'operativa', milestone: 0, evidence: ['packages/domain/src/models/uncertainty.test.ts'], gap: 'Comprensione da verificare con utenti (soglia ≥ 90%).' },
  { id: 'F16', title: 'Costi', criterion: 'prototipo, CAPEX e OPEX separati', status: 'dimostrativa', milestone: 0, evidence: ['packages/domain/src/models/costDemo.test.ts'], gap: 'Costi unitari illustrativi (M-04).' },
  { id: 'F17', title: 'Dashboard urbana', criterion: 'sincronizzazione verificata col Lab', status: 'roadmap', milestone: 1, evidence: [], gap: 'B-106.' },
  { id: 'F18', title: 'Dashboard agricola', criterion: 'prima zona da controllare ≤ 2 min', status: 'beta', milestone: 1, evidence: ['pagina /progetti/:id/agricolo (riepilogo zone ordinate per priorità)'], gap: 'Riepilogo nel Lab; dashboard dedicata in M1.' },
  { id: 'F19', title: 'Dashboard esecutiva', criterion: 'ranking motivabile', status: 'roadmap', milestone: 1, evidence: [], gap: 'B-106.' },
  { id: 'F20', title: 'Casi studio', criterion: 'nessun valore esterno scambiato per output locale', status: 'roadmap', milestone: 1, evidence: [], gap: 'B-111.' },
  { id: 'F21', title: 'Lineage', criterion: 'ogni KPI risale alla catena di provenienza', status: 'operativa', milestone: 0, evidence: ['packages/domain/src/data/dataValue.test.ts', 'apps/web/src/components/DataBadge.test.tsx'], gap: '' },
  { id: 'F22', title: 'Media', criterion: 'upload, associazione, export ed eliminazione completi', status: 'beta', milestone: 1, evidence: ['packages/domain/src/media/files.test.ts', 'supabase/tests/media.test.ts', 'supabase/tests/gateway.test.ts', 'supabase/tests/mediaStore.test.ts', 'apps/web/src/test/media.test.tsx', 'apps/web/src/test/guestImport.test.tsx', 'e2e/media.spec.ts', 'pagina /progetti/:id/documenti'], gap: 'Flusso completo con quarantena e validazione server-side (B-124), conservazione (B-125), importazione da ospite su conferma (B-121): testati su PGlite e backend simulato. Resta Beta fino alla verifica su Supabase reale (docs/14). Nessun antivirus (B-123); metadati PDF non rimossi (B-127).' },
  { id: 'F23', title: 'AI fotografica', criterion: 'non attiva senza benchmark e supervisione', status: 'roadmap', milestone: 2, evidence: [], gap: 'Volutamente non attiva (B-201).' },
  { id: 'F24', title: 'Sensor placement', criterion: 'suggerimento spiegabile e approvazione umana', status: 'roadmap', milestone: 2, evidence: [], gap: 'B-202.' },
  { id: 'F25', title: 'Export', criterion: 'PDF/CSV/GeoJSON coerenti e reimportabili', status: 'beta', milestone: 1, evidence: ['packages/domain/src/project/bundle.test.ts'], gap: 'JSON progetto + GeoJSON reimportabili con hash; PDF e CSV in M1 (B-107).' },
  { id: 'F26', title: 'Account', criterion: 'isolamento tenant e revoca link testati', status: 'beta', milestone: 1, evidence: ['supabase/tests/rls.test.ts', 'supabase/tests/repository.test.ts', 'pagina /accesso'], gap: 'RLS, ruoli e link revocabili testati su Postgres reale (PGlite) con schemi auth/storage emulati; interfaccia per ruolo (B-120) testata con E2E su backend simulato. Da ripetere su un progetto Supabase reale.' },
  { id: 'F27', title: 'Workflow', criterion: 'storico attore-data-motivazione', status: 'beta', milestone: 1, evidence: ['registro decisioni nel Lab'], gap: 'Decisione motivata con traccia; workflow a 7 stati in M1 (B-108).' },
  { id: 'F28', title: 'PWA', criterion: 'perdita rete senza perdita dati e avviso dati obsoleti', status: 'beta', milestone: 1, evidence: ['persistenza IndexedDB locale', 'e2e/media.spec.ts (offline → sincronizzazione confermata)'], gap: 'Progetti e file restano nel browser senza rete; i file si sincronizzano dopo conferma. Service worker e avviso dati obsoleti in B-110.' },
  { id: 'F29', title: 'Accessibilità', criterion: 'nessun blocco critico da tastiera/mobile', status: 'beta', milestone: 1, evidence: ['e2e/onboarding.spec.ts (percorso solo tastiera)', 'e2e/mobile.spec.ts', 'coordinate da tastiera per aree e interventi'], gap: 'Onboarding e primo scenario completabili da tastiera e su smartphone; audit WCAG 2.2 AA e screen reader ancora da fare (B-114).' },
  { id: 'F30', title: 'Ex-post', criterion: 'almeno un pilota con confronto previsto/osservato documentato', status: 'dimostrativa', milestone: 0, evidence: ['packages/domain/src/expost/expost.test.ts', 'pagina /progetti/:id/verifica'], gap: 'Funzione operativa; nessun pilota reale: solo misure SIMULATE di esempio.' },
  {
    id: 'F31',
    title: 'Previsioni probabilistiche (Timestral)',
    criterion: 'L’utente distingue una previsione da una misura, comprende l’intervallo probabilistico, conosce modello e dati utilizzati e può confrontare la previsione con una baseline e con l’osservazione successiva.',
    status: 'beta',
    milestone: 1,
    traces: ['F04', 'F05', 'F12', 'F15', 'F17', 'F18', 'F21', 'F30'],
    evidence: ['packages/domain/src/forecast/forecast.test.ts', 'services/forecasting/tests/test_api.py', 'supabase/tests/forecast.test.ts', 'apps/web/src/test/forecast.test.tsx', 'e2e/forecast.spec.ts', 'docs/reports/backtest-previsioni-2026-10-24.md', 'pagina /progetti/:id/previsioni'],
    gap: 'Beta da validare. Contratto, servizio, baseline, backtest, tabelle e interfaccia implementati e testati in locale; input da storico Supabase con previsione Open-Meteo come covariata nota predisposto (weatherSource.ts); Timestral non eseguito (servizio non configurato in questo ambiente: l’interfaccia mostra “Motore Timestral non configurato”). Backtest solo delle baseline su rianalisi; nessuna validazione con utenti o esperti.',
  },
];
