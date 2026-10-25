# 02 — Matrice di tracciabilità requisiti – funzioni – test (F01–F31)

Fonte unica in codice: [`packages/domain/src/features/features.ts`](../packages/domain/src/features/features.ts), visibile in app alla pagina **/stato**. Stato al termine della Milestone 0 (24/10/2026).

Legenda stato: **Operativa** · **Beta** · **Dimostrativa** (funziona, ma su modelli/dati illustrativi) · **Roadmap** · **Non disponibile** (dati/credenziali mancanti).

| ID | Requisito | Criterio | Funzione implementata | Test / evidenza | Stato M0 |
|---|---|---|---|---|---|
| F01 | Onboarding per ruolo | primo scenario ≤ 5 min | 6 domande, profilo separato dal ruolo, preferenze su Supabase/locale, instradamento per ambito, modalità guidata/tecnica, salto in Demo | `onboarding.test.ts` (14), `onboarding.test.tsx` (12), `e2e/onboarding.spec.ts` (5), `e2e/supabase.spec.ts` (4), `e2e/mobile.spec.ts` | Operativa (tempi umani da misurare) |
| F02 | AOI reale | geometria e superficie salvate | Disegno, import GeoJSON, coordinate da tastiera; area geodetica; blocco su geometria non valida | `geo.test.ts` (6 test), pagina /area | Operativa |
| F03 | Mappa 2D/3D | coordinate, legenda, layer coerenti | MapLibre 2D, scala, coordinate cursore EPSG:4326, legenda a classi | verifica manuale | Beta (3D assente) |
| F04 | Meteo | fonte, timestamp, timezone, coordinate, fallback visibili | Connettore Open-Meteo archivio + forecast, cache, timeout, errori espliciti; **acquisizione ufficiale server-side** (Edge Function `open-meteo-ingest`, pg_cron ogni 3 h, tabelle `weather_*` con RLS, previsioni mai sovrascritte), pannello “Dati meteorologici” | `openMeteo.test.ts`, `openMeteoForecast.test.ts`, `weather.test.ts` (PGlite), `weatherPanel.test.tsx`, `e2e/weather.spec.ts`; smoke test reale Open-Meteo 24/10/2026 | Beta (Supabase reale non verificato) |
| F05 | Sensori | fonte, timestamp, unità, flag qualità | QA/QC serie (unità, futuro, duplicati, range, gap, fuori area, obsolescenza) | `qa.test.ts` | Beta (manca UI sensori) |
| F06 | Satellite | prodotto, data, risoluzione, nuvolosità | — | — | Non disponibile |
| F07 | Griglia | cella ↔ geometria, input, modello | Griglia regolare con id, poligono, area; risultati per cella; mappa differenze | `geo.test.ts`, `urbanDemo.test.ts` | Operativa |
| F08 | Interventi urbani | quantità plausibili e coerenti con AOI | 6 tipi tipizzati, quantità dalla geometria, controlli di plausibilità bloccanti | `scenario.test.ts` | Operativa |
| F09 | KPI climatici | definizione, formula, unità, quota, ora, soglia | ΔT aria 2 m, ΔT superficiale, area ≥ 2 °C, comfort = DATO MANCANTE | `urbanDemo.test.ts`, /metodo | Dimostrativa |
| F10 | Rifugi climatici | rete pedonale e copertura | — | — | Roadmap |
| F11 | Vigneto | parcelle georiferite, input espliciti | Parcella + sottozone, input agronomici e suolo per zona | `agriDemo.test.ts` | Operativa |
| F12 | Stress/fenologia | componenti separate, formula/versione | 4 componenti separate, fenologia solo confermata, regola di priorità dichiarata | `agriDemo.test.ts` (9 test) | Dimostrativa |
| F13 | Irrigazione | nessun consiglio senza input minimo e fiducia | Misura "non valutabile" con elenco mancanti; testo condizionale | `agriDemo.test.ts` | Operativa |
| F14 | Scenari | A/B stessi presupposti, ≤ 10 min | Comparabilità bloccante (baseline, modello, griglia, orizzonte), combinazione A+B | `scenario.test.ts`, /confronto | Operativa (tempo da misurare con utenti) |
| F15 | Incertezza | nessuna falsa precisione | Intervallo illustrativo, arrotondamento per ampiezza, grafico a intervalli | `uncertainty.test.ts` | Operativa (comprensione da misurare) |
| F16 | Costi | prototipo, CAPEX, OPEX separati | Prototipo / CAPEX / OPEX / acqua / tempi separati | `costDemo.test.ts` | Dimostrativa |
| F17 | Dashboard urbana | sincronizzazione col Lab | — | — | Roadmap |
| F18 | Dashboard agricola | prima zona ≤ 2 min | Riquadro "Prima zona da controllare" in testa al Lab | verifica manuale | Beta |
| F19 | Dashboard esecutiva | ranking motivabile | — | — | Roadmap |
| F20 | Casi studio | nessun valore esterno come output locale | — | — | Roadmap |
| F21 | Lineage | ogni KPI → catena di provenienza | `DataValue` obbligatorio + pannello lineage dal badge | `dataValue.test.ts`, `DataBadge.test.tsx` | Operativa |
| F22 | Media | upload, associazione, export, eliminazione | Pagina Foto e documenti per urbano e agricolo: tipo reale, rimozione EXIF/GPS, anteprima, contesto obbligatorio (area/parcella, zona o cella, scenario, osservazione, fase, data, autore), URL firmati 60 s con audit, CSV, eliminazione in tre passi; ospite e offline in locale | `files.test.ts` (12), `media.test.ts` dominio (7), DB `media.test.ts` (24) e `mediaStore.test.ts` (7), `media.test.tsx` (13), `e2e/media.spec.ts` (8) + mobile | Beta (da verificare su Supabase reale) |
| F23 | AI fotografica | non attiva senza benchmark | Volutamente assente | — | Roadmap |
| F24 | Sensor placement | spiegabile, approvazione umana | — | — | Roadmap |
| F25 | Export | PDF/CSV/GeoJSON coerenti e reimportabili | JSON progetto con hash + verifica riproducibilità; GeoJSON scenario reimportabile | `bundle.test.ts` | Beta (PDF/CSV M1) |
| F26 | Account | tenant, revoca link | Supabase Auth, organizzazioni e ruoli, RLS su tutte le tabelle, link con scadenza e revoca, interfaccia per ruolo (B-120) | `rls.test.ts` (23), `repository.test.ts` (5), `preferences.test.ts` (7), `readOnly.test.tsx` (14), `e2e/supabase.spec.ts` | Beta (non provato su istanza reale) |
| F27 | Workflow | storico attore-data-motivazione | Decisione con alternative, motivazione, autore, storico; invio a revisione | `bundle.test.ts` (validazione) | Beta |
| F28 | PWA | offline senza perdita dati | Persistenza IndexedDB di progetti e file; file creati senza rete marcati “non sincronizzato” e caricati dopo conferma | E2E offline → online | Beta (no service worker) |
| F29 | Accessibilità | nessun blocco critico tastiera/mobile | Focus visibile, skip link, landmark, tabelle equivalenti alle mappe, coordinate da tastiera per aree e interventi, onboarding con focus gestito, simboli oltre al colore | E2E solo tastiera e smartphone; non verificato con screen reader | Beta |
| F30 | Ex-post | ≥ 1 pilota previsto/osservato | Piano, import CSV, filtro omogeneità, scarto, lezioni, proposta di nuova versione | `expost.test.ts` | Dimostrativa (nessun pilota reale) |

Riepilogo (dopo M1, B-102 e B-120): Operativa 9 · Beta 10 · Dimostrativa 4 · Roadmap 6 · Non disponibile 1.

## F31 — Previsioni probabilistiche (aggiunta del 24/10/2026)

| ID | Requisito | Criterio di accettazione | Funzione implementata | Test / evidenza | Stato |
|---|---|---|---|---|---|
| F31 | Previsioni probabilistiche (Timestral) | L’utente distingue una previsione da una misura, comprende l’intervallo probabilistico, conosce modello e dati utilizzati e può confrontare la previsione con una baseline e con l’osservazione successiva. | Contratto `TimeSeriesForecastAdapter`, baseline persistenza/stagionale, adapter e servizio Timestral, backtest walk-forward, tabelle forecast_* con RLS e audit, sezione **Previsioni** con badge, banda, soglie, confronto baseline ed ex-post | `forecast.test.ts` (dominio), `services/forecasting/tests` (non eseguiti: Python assente), `supabase/tests/forecast.test.ts`, `apps/web/src/test/forecast.test.tsx`, `e2e/forecast*.spec.ts`, `docs/reports/backtest-previsioni-2026-10-24.md` | **Beta** (Timestral non eseguito) |

Tracciabilità: F04 (meteo: fonte e timestamp delle serie), F05 (QA: mancanti e flag), F12 (incertezza: quantili e copertura), F15 (confronto: baseline), F17/F18 (decisione umana motivata, soglie dell’esperto), F21 (lineage), F30 (ex-post: osservazione successiva).

Aggiornamento F31 (24/10/2026): predisposto l’input di Timestral dallo storico registrato su Supabase con la previsione Open-Meteo come covariata nota (`weatherSource.ts`, `weatherSource.test.ts`). Il significato di F31 e il suo stato (Beta, Timestral non eseguito) non cambiano.

## Semplificazione dell’interfaccia (aggiornamento del 25/10/2026)

Le funzioni F01, F04, F05, F15, F21, F29 e F31 hanno ora una presentazione a due livelli: sintesi
nella modalità guidata, dettagli completi in sezioni espandibili (aperte nella modalità tecnica).
Nessun requisito è stato rimosso; la matrice modifica → requisito → bisogno → informazione
essenziale → dettaglio nascosto → comportamento offline → test è in
`18-semplificazione-ux-audit.md` (sezione 7). Test aggiunti: `usabilityOnboarding.test.tsx`,
`onboardingPaths.test.ts`, `weatherSummary.test.ts`, nuovi blocchi in `weatherPanel.test.tsx` e
`forecast.test.tsx`, `e2e/usability.spec.ts`, `e2e/usability-mobile.spec.ts`.
