# 02 — Matrice di tracciabilità requisiti – funzioni – test (F01–F30)

Fonte unica in codice: [`packages/domain/src/features/features.ts`](../packages/domain/src/features/features.ts), visibile in app alla pagina **/stato**. Stato al termine della Milestone 0 (24/10/2026).

Legenda stato: **Operativa** · **Beta** · **Dimostrativa** (funziona, ma su modelli/dati illustrativi) · **Roadmap** · **Non disponibile** (dati/credenziali mancanti).

| ID | Requisito | Criterio | Funzione implementata | Test / evidenza | Stato M0 |
|---|---|---|---|---|---|
| F01 | Onboarding per ruolo | primo scenario ≤ 5 min | 6 domande, profilo separato dal ruolo, preferenze su Supabase/locale, instradamento per ambito, modalità guidata/tecnica, salto in Demo | `onboarding.test.ts` (14), `onboarding.test.tsx` (12), `e2e/onboarding.spec.ts` (5), `e2e/supabase.spec.ts` (4), `e2e/mobile.spec.ts` | Operativa (tempi umani da misurare) |
| F02 | AOI reale | geometria e superficie salvate | Disegno, import GeoJSON, coordinate da tastiera; area geodetica; blocco su geometria non valida | `geo.test.ts` (6 test), pagina /area | Operativa |
| F03 | Mappa 2D/3D | coordinate, legenda, layer coerenti | MapLibre 2D, scala, coordinate cursore EPSG:4326, legenda a classi | verifica manuale | Beta (3D assente) |
| F04 | Meteo | fonte, timestamp, timezone, coordinate, fallback visibili | Connettore Open-Meteo archivio + forecast, cache, timeout, errori espliciti | `openMeteo.test.ts` (8 test); chiamata reale verificata in browser | Beta |
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
| F22 | Media | upload, associazione, export, eliminazione | Servizio storage per tenant, rimozione EXIF/GPS, URL firmati, eliminazione verificata | `media.test.ts`, `rls.test.ts` (storage) | Beta (UI in B-109) |
| F23 | AI fotografica | non attiva senza benchmark | Volutamente assente | — | Roadmap |
| F24 | Sensor placement | spiegabile, approvazione umana | — | — | Roadmap |
| F25 | Export | PDF/CSV/GeoJSON coerenti e reimportabili | JSON progetto con hash + verifica riproducibilità; GeoJSON scenario reimportabile | `bundle.test.ts` | Beta (PDF/CSV M1) |
| F26 | Account | tenant, revoca link | Supabase Auth, organizzazioni e ruoli, RLS su tutte le tabelle, link con scadenza e revoca, interfaccia per ruolo (B-120) | `rls.test.ts` (23), `repository.test.ts` (5), `preferences.test.ts` (7), `readOnly.test.tsx` (14), `e2e/supabase.spec.ts` | Beta (non provato su istanza reale) |
| F27 | Workflow | storico attore-data-motivazione | Decisione con alternative, motivazione, autore, storico; invio a revisione | `bundle.test.ts` (validazione) | Beta |
| F28 | PWA | offline senza perdita dati | Persistenza IndexedDB locale | — | Beta (no service worker) |
| F29 | Accessibilità | nessun blocco critico tastiera/mobile | Focus visibile, skip link, landmark, tabelle equivalenti alle mappe, coordinate da tastiera per aree e interventi, onboarding con focus gestito, simboli oltre al colore | E2E solo tastiera e smartphone; non verificato con screen reader | Beta |
| F30 | Ex-post | ≥ 1 pilota previsto/osservato | Piano, import CSV, filtro omogeneità, scarto, lezioni, proposta di nuova versione | `expost.test.ts` | Dimostrativa (nessun pilota reale) |

Riepilogo (dopo M1, B-102 e B-120): Operativa 9 · Beta 10 · Dimostrativa 4 · Roadmap 6 · Non disponibile 1.
