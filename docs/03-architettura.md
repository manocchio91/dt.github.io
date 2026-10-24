# 03 — Architettura applicativa

## Monorepo

```
micro-digital-twin/
├─ apps/web/                 React 19 + TypeScript strict + Vite + Tailwind 4 + MapLibre GL
│  └─ src/
│     ├─ app/                router, layout, navigazione (bottom bar mobile / sidebar desktop)
│     ├─ components/         DataBadge, LineagePanel, MapView, FeatureStatusBadge, ...
│     ├─ pages/              Landing, Progetti, Area, UrbanLab, AgriLab, Confronto, Verifica, Metodo, Stato, Limiti
│     └─ state/              repository locale (IndexedDB), hook di accesso
├─ packages/domain/          Dominio puro, senza dipendenze UI né rete implicita
│  └─ src/
│     ├─ data/               DataValue, DataClass, Lineage, QA/QC
│     ├─ geo/                geometria, area geodetica, validazione AOI, griglia
│     ├─ hash/               canonical JSON + SHA-256 (deterministico, sincrono)
│     ├─ baseline/           baseline immutabili e versionate
│     ├─ models/             interfacce adapter + DemoIllustrative (urbano, agricolo, costi, incertezza)
│     ├─ scenario/           scenari, run, comparabilità
│     ├─ connectors/         Open-Meteo (timeout, cache, errori espliciti, metadata)
│     ├─ expost/             campagne di verifica, scarti, proposta di ricalibrazione
│     ├─ forecast/           previsioni probabilistiche: contratto, baseline, Timestral, backtest, record (F31)
│     ├─ features/           registro F01–F31 con stato
│     └─ seeds/              seed DEMO (Campobasso, vigneto molisano)
├─ supabase/
│  ├─ migrations/            SQL versionato PostgreSQL + PostGIS (M1: collegamento)
│  └─ seed/                  seed DEMO separato dai dati reali
└─ docs/                     documenti 01–10, report milestone
```

## Strati e dipendenze

```
UI (apps/web) ──► dominio (packages/domain) ◄── connettori (packages/domain/connectors)
      │                    ▲
      └──► Repository ─────┘   (LocalRepository IndexedDB in M0, SupabaseRepository in M1)
```

- **Il dominio non conosce la UI.** Tutte le funzioni di calcolo sono pure e deterministiche: stesso input → stesso output → stesso hash.
- **I connettori restituiscono `Result<T, ConnectorError>`**: mai un valore di riserva inventato.
- **Ogni numero esce dal dominio come `DataValue`** (valore o range, unità, classe, lineage). La UI non può mostrare un numero "nudo" senza passare da `<DataBadge>`.

## Motore a plugin

```ts
interface ModelAdapterMeta {
  id: string; version: string; kind: 'urban' | 'agriculture' | 'cost' | 'uncertainty';
  validityScope: string; requiredInputs: string[]; outputs: {key; unit; description}[];
  assumptions: string[]; scientificSource: string; uncertaintyMethod: string;
  validationDate: string | null; reviewer: string | null;
  maturity: 'demo-illustrative' | 'calibrated';
}
```

- `UrbanModelAdapter.run(input) → UrbanModelOutput`
- `AgricultureModelAdapter.run(input) → AgricultureModelOutput`
- `CostModelAdapter.estimate(interventions) → CostBreakdown` (prototipo / CAPEX / OPEX / acqua separati)
- `UncertaintyAdapter.interval(low, central, high) → {range, label, rounding}`

In M0 sono registrati solo adapter `maturity: 'demo-illustrative'`. Il registro **rifiuta** l'uso di un adapter demo quando il progetto è in modalità *Pilota calibrato* (test unitario dedicato).

## Modalità

| Modalità | Condizione di attivazione | M0 |
|---|---|---|
| Demo | sempre disponibile | Operativa |
| Pilota calibrato | area reale + dati locali controllati + adapter `calibrated` con validazione e revisore | Bloccata: nessun adapter calibrato registrato (stato "Non disponibile per dati mancanti") |

## Scelte di stack e motivazioni

| Scelta | Motivo |
|---|---|
| React 19 + TS 5.9 strict + Vite 7 | stack preferito dal prompt; TS 7 (port nativo) scartato perché non ancora supportato da typescript-eslint |
| Tailwind 4 | stack preferito; token colore su `@theme` |
| MapLibre GL 5 + tile OSM | open source, nessuna chiave; disegno AOI implementato internamente (no dipendenze draw incompatibili) |
| IndexedDB (`idb`) | persistenza offline-first in M0, precondizione della PWA (F28) |
| Vitest | test di dominio e componenti |
| Grafici | SVG accessibile scritto a mano (tabella equivalente sempre presente) |

## Acquisizione meteo (F04)

Open-Meteo è interrogato dal server: Edge Function `open-meteo-ingest` invocata da `pg_cron` ogni 3 ore (o manualmente da un editor), registrazione nelle tabelle `weather_*` con RLS; il frontend su GitHub Pages legge soltanto. Dettagli in [16-open-meteo-supabase.md](16-open-meteo-supabase.md).

## Servizio di previsione (F31)

`services/forecasting` è un servizio Python separato (FastAPI, CPU) che esegue Timestral. Il browser lo raggiunge solo tramite un proxy autenticato (`VITE_FORECAST_URL`); senza servizio l’interfaccia mostra "Motore Timestral non configurato". Dettagli in [15-previsioni-timestral.md](15-previsioni-timestral.md).
