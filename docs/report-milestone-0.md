# Report — Milestone 0 (Integrità)

Data: 24/10/2026 · Modalità: Demo · Versione: 0.1.0

## Cosa è stato costruito

**Dominio (`packages/domain`)** — puro, deterministico, testato:

- `DataValue` con le 7 classi obbligatorie e lineage completo; un DATO MANCANTE non può avere un numero.
- Geometria: area geodetica, validazione AOI (chiusura, vertici, auto-intersezione, limiti WGS84, scala 50 m² – 25 km²), import GeoJSON con rifiuto dei CRS proiettati, griglia di celle.
- Baseline immutabili (deep freeze + SHA-256 del contenuto) e versionate con `parentId`.
- Motore a plugin: `ModelRegistry` + adapter DEMO urbano, agricolo, costi, incertezza; il registro rifiuta gli adapter DEMO in modalità Pilota e i modelli "calibrati" senza validazione e revisore.
- Modello urbano a copertura: ΔT aria 2 m e ΔT superficiale separati, ombre non sommabili, non additività dichiarata, nebulizzazione condizionata all’UR, UTCI/WBGT = DATO MANCANTE.
- Modello vigneto: 4 componenti separate, fenologia solo confermata, fiducia ridotta da ogni dato mancante, 5 misure confrontate con testo condizionale.
- Costi: prototipo / CAPEX / OPEX / acqua / tempi separati.
- Scenari: hash di input e output, comparabilità bloccante, combinazione A+B, verifica di riproducibilità.
- Connettore Open-Meteo (archivio + forecast): timeout, cache, 6 codici d’errore espliciti, nessun valore sostitutivo.
- QA/QC serie; ex-post con filtro di omogeneità oraria, scarto, proposta di ricalibrazione non distruttiva.
- Export/import JSON con hash, GeoJSON scenario con metadati ricostruibili.
- Registro F01–F30; seed DEMO Campobasso e vigneto molisano.

**Web (`apps/web`)** — 10 pagine: Landing, Progetti, Area/Parcelle, Decision Lab urbano (8 passi), Confronto e decisione, Verifica ex-post, Decision Lab agricolo (9 passi), Fonti e metodo, Stato funzioni, Limiti e responsabilità. Navigazione laterale su desktop, barra inferiore su mobile.

**Database** — migrazione PostgreSQL/PostGIS con 27 tabelle, trigger di immutabilità della baseline, vincoli su classi dato, validazione modelli, motivazione e consenso alla geolocalizzazione. Non collegata in M0.

**Documenti** — `docs/01`–`10` (requisiti, matrice, architettura, schema, pagine, journey, backlog, piano di test, dati/API, rischi).

## Test eseguiti

| Controllo | Esito |
|---|---|
| `npm run lint` | ✔ nessun errore |
| `npm run typecheck` (strict, `noUncheckedIndexedAccess`) | ✔ |
| `npm test` | ✔ 14 file, 72 test (68 dominio, 4 componenti) |
| `npm run build` | ✔ |
| Journey urbano nel browser (seed → Lab → calcolo → confronto con 3 mappe) | ✔ verificato |
| Journey agricolo nel browser (seed → prima zona → conferma fenologia → fiducia sale, irrigazione sbloccata con testo condizionale) | ✔ verificato |
| Chiamata reale Open-Meteo archivio da browser | ✔ baseline v2 creata con classe STIMATO DA MODELLO |

## Copertura F01–F30

Operativa 8 · Beta 8 · Dimostrativa 4 · Roadmap 9 · Non disponibile 1 — dettaglio in [02-matrice-F01-F30.md](02-matrice-F01-F30.md).

## Classificazione delle funzioni

| Stato | Funzioni |
|---|---|
| **Operativa** | AOI e validazione, griglia, interventi tipizzati e plausibilità, comparabilità scenari, incertezza illustrativa, lineage, vigneto (parcelle/input), regola irrigua non prescrittiva |
| **Beta** | connettore Open-Meteo (chiamata diretta dal client), QA/QC (solo dominio), mappa 2D, export JSON/GeoJSON, registro decisioni, persistenza locale, accessibilità di base, riquadro "prima zona" |
| **Dimostrativa** | modello urbano, modello vigneto, costi, KPI climatici, ex-post (solo misure SIMULATE) |
| **Roadmap** | onboarding, dashboard, casi studio, media/foto, AI fotografica, sensor placement, account e tenant, rifugi climatici, 3D |
| **Non disponibile** | satellite (prodotto e credenziali non definiti), modalità Pilota calibrato (nessun modello validato) |
| **Non verificato** | resa visiva su smartphone reale e al sole; uso con screen reader; tempi utente (≤ 5 / ≤ 10 / ≤ 2 min) |

## Rischi aperti

1. **Coefficienti DEMO** letti come risultati (R1): mitigato da badge, intervallo illustrativo, banner Demo; resta il rischio principale finché manca un modello validato (M-01).
2. **Persistenza solo locale** (R4): i progetti vivono nel browser; export JSON disponibile, Supabase in M1.
3. **Nuova baseline = nuovi scenari**: per correttezza gli scenari restano legati alla baseline su cui sono stati creati; manca un comando "riapplica gli interventi alla nuova versione" (backlog B-119).
4. **Tile OSM** e **Open-Meteo** chiamati dal client: adeguati alla demo, da instradare via proxy/contratto per l’uso pubblico (D6, D8).
5. **Accessibilità** non ancora sottoposta ad audit WCAG 2.2 AA (B-114).

## Prossimo passo proposto — Milestone 1

Supabase (auth, RLS, storage) → onboarding → dashboard → dossier PDF/CSV → workflow a 7 stati → media con EXIF/consenso → PWA → E2E Playwright → audit accessibilità.
