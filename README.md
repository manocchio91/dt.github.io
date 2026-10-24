# Micro Digital Twin — Climate Decision Lab

**Dai dati alla scelta climatica motivata.** Decision Support System dimostrativo e validabile per due percorsi:

- **Urbano** — tecnici comunali e gestori del verde: AOI, baseline, scenari A/B/A+B (alberature, ombra, depaving, albedo, nebulizzazione, verde tecnico), confronto con costi e incertezza, decisione motivata, verifica ex-post.
- **Agricolo** — viticoltori e agronomi: parcelle e sottozone, input espliciti, fenologia confermata, componenti di stress separate, zona da controllare per prima con livello di fiducia, confronto misure non prescrittivo.

> L’app non prende decisioni al posto delle persone. Rende leggibili dati, ipotesi, limiti e alternative.

Stato attuale: **Milestone 0 (integrità)** completata — [report](docs/report-milestone-0.md). **Milestone 1**: Supabase (auth, tenant, RLS, storage) — [docs/11](docs/11-supabase.md); onboarding per profilo e interfaccia per ruolo — [docs/12](docs/12-onboarding-e-ruoli.md); foto e documenti — [docs/13](docs/13-foto-documenti-storage-privacy.md). Prossimo passo: [test su Supabase reale](docs/14-piano-test-supabase-reale.md).

## Avvio

Requisiti: Node.js ≥ 20 (testato con 24), npm ≥ 10.

```bash
npm install
npm run dev        # http://localhost:5173
```

Comandi:

| Comando | Cosa fa |
|---|---|
| `npm run dev` | server di sviluppo Vite |
| `npm run build` | build di produzione (`apps/web/dist`) |
| `npm run lint` | ESLint (TypeScript + React hooks) |
| `npm run typecheck` | `tsc --noEmit` strict su dominio e web |
| `npm test` | Vitest: dominio (node), web (jsdom), database (Postgres/PostGIS in PGlite con RLS) |
| `npm run ci` | lint → typecheck → test → build |
| `npm run e2e` | build standard + build con Supabase simulato, poi Playwright su Microsoft Edge |

Senza variabili d’ambiente l’app funziona in modalità locale (IndexedDB). Per l’archivio condiviso imposta `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` (vedi [.env.example](.env.example) e [docs/11-supabase.md](docs/11-supabase.md)).

> **Nota Windows / cartelle virtualizzate.** Se il progetto si trova in una cartella virtualizzata (es. sotto `AppData\Roaming` di un’app MSIX) e compare `spawn …esbuild.exe ENOENT`, imposta `ESBUILD_BINARY_PATH` al percorso reale di `node_modules\@esbuild\win32-x64\esbuild.exe`, oppure sposta il progetto in una cartella normale.

## Pubblicazione su GitHub Pages

L’app è pubblicabile come sito statico in **https://manocchio91.github.io/dt.github.io/**.

- Workflow `.github/workflows/ci.yml`: lint, typecheck, test e build a ogni push e pull request.
- Workflow `.github/workflows/pages.yml`: dopo una CI verde su `master` costruisce l’app con `VITE_BASE=/<repository>/` e la pubblica.
- **Prerequisito, una volta sola:** Settings → Pages → Source: **GitHub Actions**. Finché non è attivo, il workflow termina con un avviso e non pubblica nulla; poi va rieseguito (Actions → Pages → Run workflow).
- Il router usa la sottocartella come `basename`; `404.html` è una copia di `index.html`, così la ricarica di una rotta interna funziona anche senza riscrittura lato server.
- Variabili opzionali del repository (Settings → Secrets and variables → Actions → Variables): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (valori pubblici), `VITE_FORECAST_URL`. Senza variabili l’app funziona in modalità locale. Mai la service key. Con Supabase, aggiungere l’URL di Pages tra gli indirizzi di ritorno (Auth → URL Configuration).
- In locale: `npm run build:pages -w @mdt/web` e `npm run preview:pages -w @mdt/web` (verificati da `e2e/pages.spec.ts`).


## Struttura

```
apps/web/            React 19 + TypeScript strict + Vite 7 + Tailwind 4 + MapLibre GL 5
packages/domain/     dominio puro: dati e lineage, geometria, baseline, modelli, scenari, connettori, ex-post
supabase/migrations/ schema PostgreSQL + PostGIS (M1: collegamento)
supabase/seed/       seed DEMO separato dai dati reali
services/forecasting servizio Python (FastAPI, CPU) per Timestral — Beta, pesi mai nel repository
docs/                documenti di progetto 01–10 e report di milestone
```

## Principi implementati

- Ogni numero è un `DataValue` con classe (MISURATO, OSSERVATO DA DATASET, STIMATO DA MODELLO, PREVISIONE, SIMULATO, INSERITO DALL’UTENTE, DATO MANCANTE) e lineage consultabile dal badge.
- Baseline immutabili (oggetti congelati + hash SHA-256 del contenuto); ogni variazione crea una nuova versione.
- Confronto bloccato se baseline, modello, griglia o orizzonte differiscono.
- Calcoli deterministici: stesso input → stesso hash di output; verificato al reimport.
- Incertezza come *intervallo illustrativo* con arrotondamento coerente.
- Costo prototipo separato da CAPEX/OPEX/acqua dell’intervento.
- Errori dei connettori esposti all’utente: mai valori sostitutivi.
- Adapter DEMO non utilizzabili in modalità Pilota calibrato.
- Previsioni (F31, Beta): 21 quantili per ora, banda selezionabile, soglie dell’esperto, confronto con baseline e con l’osservazione successiva. Timestral gira solo nel servizio esterno; senza servizio compare “Motore Timestral non configurato” e nessun valore viene inventato. Vedi [docs/15-previsioni-timestral.md](docs/15-previsioni-timestral.md).
- Meteo ufficiale (F04, Beta): acquisizione server-side Open-Meteo → Supabase ogni 3 ore (Edge Function `open-meteo-ingest`), previsioni mai sovrascritte, pannello “Dati meteorologici” con fonte, modello, cella e avviso “Dato territoriale modellato, non rilevato da sensore locale”. Vedi [docs/16-open-meteo-supabase.md](docs/16-open-meteo-supabase.md).
- Foto e documenti: tipo reale verificato, EXIF/GPS rimossi prima del salvataggio, posizione solo con consenso, storage privato con URL firmati di 60 secondi, nessun file senza contesto. Nessun antivirus (in roadmap).

## Dati e licenze

- Cartografia © OpenStreetMap contributors (ODbL).
- Meteo: Open-Meteo (CC BY 4.0) — stime modellistiche, non sensori locali.
- Serie per previsioni e backtest: rianalisi Open-Meteo ERA5/ERA5-Land (CC BY 4.0), celle di griglia, non misure in campo.
- Timestral (Mistral AI): codice Apache-2.0, pesi Modified MIT; scaricati dalla fonte ufficiale, mai inclusi nel repository.
- Seed Campobasso e vigneto molisano: **dati SIMULATI e geometrie approssimate**, marcati DEMO.
- Nessun logo istituzionale incluso (in attesa degli asset ufficiali).
