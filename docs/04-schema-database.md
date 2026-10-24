# 04 — Schema database

Migrazione: [`supabase/migrations/20261024000001_core_schema.sql`](../supabase/migrations/20261024000001_core_schema.sql) — PostgreSQL 15 + PostGIS, timestamp UTC, geometrie EPSG:4326.

**M1:** la migrazione [`20261024000002_tenancy_rls_storage.sql`](../supabase/migrations/20261024000002_tenancy_rls_storage.sql) aggiunge tenant, RLS, documenti di progetto, link condivisi e storage: vedi [11-supabase.md](11-supabase.md).

In M0 lo schema **non era collegato**: l'app usa `LocalRepository` (IndexedDB) con gli stessi tipi del dominio (`packages/domain`). Il collegamento a Supabase è il primo task di M1 (backlog B-101).

**B-109:** la migrazione [`20261024000004_media.sql`](../supabase/migrations/20261024000004_media.sql) estende `media_assets` (contesto obbligatorio, stato `caricamento → attivo → eliminazione_in_corso`, posizione solo con consenso, retention), aggiunge impostazioni per organizzazione (`media_max_bytes`, `media_retention_years`), sostituisce le policy di storage con regole legate alla scheda, audit minimo e RPC `log_media_access` / `media_due_for_deletion`. Dettagli in [13-foto-documenti-storage-privacy.md](13-foto-documenti-storage-privacy.md).

**B-124/B-125:** la migrazione [`20261024000005_media_gateway_retention.sql`](../supabase/migrations/20261024000005_media_gateway_retention.sql) aggiunge `validated_at` e `validation`, riserva al servizio l’uscita dalla quarantena, toglie ai client la lettura diretta degli oggetti, aggiunge le RPC `media_authorize_complete`, `media_authorize_delete`, `media_expiring` e le regole sulla data di conservazione.

## Entità e relazioni

```
organizations 1─* memberships *─1 users
organizations 1─* projects 1─* areas 1─* parcels (sottozone via parent_parcel_id)
areas 1─* baselines (versionate, immutabili: trigger anti-UPDATE, parent_baseline_id)
projects 1─* scenarios *─1 baselines
                       *─1 model_versions (ricalibrazione via parent_version_id)
scenarios 1─* interventions (geom + params + quantità + unità)
scenarios 1─* scenario_outputs 1─* uncertainty_records
model_versions 1─* cost_assumptions (prototipo | capex | opex | acqua)
projects 1─* decisions 1─* approval_events (attore, data, motivazione, allegati)
projects 1─* field_observations 1─* media_assets (EXIF rimosso, retention, deleted_at)
scenarios 1─* verification_campaigns (previsto/osservato/scarto, proposta nuova versione modello)
data_sources 1─* datasets 1─* data_points (data_class, quality_flags)
projects 1─* sensors 1─* sensor_measurements
sources, case_studies, reports, audit_logs
```

## Vincoli che codificano le regole del prompt

| Regola | Vincolo |
|---|---|
| Baseline immutabile | trigger `baselines_immutable` blocca ogni UPDATE |
| Ogni numero ha una classe | `data_points.data_class`, `scenario_outputs.data_class` NOT NULL |
| Modello calibrato solo se validato | `check (maturity = 'demo_illustrative' or (validation_date is not null and reviewer is not null))` |
| Geometria valida | `check (ST_IsValid(geom))`; superficie calcolata in `geography` |
| Motivazione della decisione | `check (length(rationale) >= 20)` |
| Geolocalizzazione solo con consenso | `check (location is null or location_consent)` |
| Incertezza non statistica dichiarata | `uncertainty_records.is_statistical` + `label` |
| Costi separati | `cost_assumptions.cost_category in ('prototipo','capex','opex','acqua')` |
| Tenant | RLS abilitata (politiche in M1) |

## Campi minimi dello scenario (§9) — mappatura

| Blocco | Tabelle / campi |
|---|---|
| Area | `areas.id, geom, crs, area_m2, owner_id` |
| Baseline | `baselines.payload` (meteo, suolo/copertura), `period_*`, `qa`, `version`, `content_hash` |
| Intervento | `interventions.type, geom, quantity, unit, timing, params (costi), constraints` |
| Output | `scenario_outputs.variable, unit, value, range_*, spatial_resolution, data_class, model_version_id` + `uncertainty_records` |
| Decisione | `decisions.alternatives, rationale, author_id, state, decided_at, attachments` |
| Verifica | `verification_campaigns.*` |

## Previsioni (migrazione 20261024000006, F31)

| Tabella | Contenuto | Regole |
|---|---|---|
| `forecast_model_versions` | modello, revisione bloccata dei pesi, tipo (timestral/baseline/demo), licenze codice e pesi | lettura per autenticati; scrittura solo servizio |
| `forecast_runs` | organizzazione, progetto, modello, contesto, orizzonte, emissione, hash input, classe del dato, lineage, avvertenze | Timestral solo dal ruolo di servizio; immutabile; stato in_corso → completata/errore |
| `forecast_series` | variabile, unità, istanti, mediana | scrivibile solo mentre l’esecuzione è in corso; mai modificabile |
| `forecast_quantiles` | livello (uno dei 21), valori | come sopra |
| `forecast_backtests` | caso, contesto, modello, protocollo, periodo, metriche | append-only |
| `forecast_thresholds` | soglia dell’esperto (valore, direzione, probabilità minima, ruolo, motivazione, zona) | versionata: si modifica solo `superseded_by` |
| `forecast_alerts` | avviso, probabilità, primo superamento, stato, valore osservato, nota di verifica | modificabili solo stato ed ex-post |

RLS per organizzazione (viewer legge, editor scrive, admin elimina esecuzioni); audit in `audit_logs` per esecuzioni, soglie, avvisi e backtest.
