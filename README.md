# Micro Digital Twin — Climate Decision Lab

**Dai dati alla scelta climatica motivata.** Decision Support System dimostrativo e validabile per due percorsi:

- **Urbano** — tecnici comunali e gestori del verde: AOI, baseline, scenari A/B/A+B (alberature, ombra, depaving, albedo, nebulizzazione, verde tecnico), confronto con costi e incertezza, decisione motivata, verifica ex-post.
- **Agricolo** — viticoltori e agronomi: parcelle e sottozone, input espliciti, fenologia confermata, componenti di stress separate, zona da controllare per prima con livello di fiducia, confronto misure non prescrittivo.

> L’app non prende decisioni al posto delle persone. Rende leggibili dati, ipotesi, limiti e alternative.

Stato attuale: **Milestone 0 (integrità)** completata — [report](docs/report-milestone-0.md). **Milestone 1**: Supabase (auth, tenant, RLS, storage) — [docs/11](docs/11-supabase.md); onboarding per profilo e interfaccia per ruolo — [docs/12](docs/12-onboarding-e-ruoli.md).

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

## Struttura

```
apps/web/            React 19 + TypeScript strict + Vite 7 + Tailwind 4 + MapLibre GL 5
packages/domain/     dominio puro: dati e lineage, geometria, baseline, modelli, scenari, connettori, ex-post
supabase/migrations/ schema PostgreSQL + PostGIS (M1: collegamento)
supabase/seed/       seed DEMO separato dai dati reali
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

## Dati e licenze

- Cartografia © OpenStreetMap contributors (ODbL).
- Meteo: Open-Meteo (CC BY 4.0) — stime modellistiche, non sensori locali.
- Seed Campobasso e vigneto molisano: **dati SIMULATI e geometrie approssimate**, marcati DEMO.
- Nessun logo istituzionale incluso (in attesa degli asset ufficiali).
