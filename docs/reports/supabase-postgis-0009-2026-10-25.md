# Migrazione 0009 — PostGIS da public a extensions (staging, 25/10/2026)

Progetto di staging (riferimento omesso). Nessuna credenziale in questo file.

## Esito

**Riuscita.** `supabase db push --linked` ha applicato solo `20261024000009_postgis_to_extensions_schema.sql`;
`DROP EXTENSION postgis` (senza CASCADE) è stato consentito e PostGIS 3.3.7 è stato ricreato in `extensions`.

## Backup prima dell'applicazione (fuori dal repository, sola lettura)

`C:\Users\aless\mdt-backups\`: dump dello schema (462.686 byte), dei dati (11.060 byte), dei ruoli (370 byte),
istantanea logica pre-0009, inventario PostGIS. Nessuna credenziale nei dump (scansione: 0 occorrenze).

## Controlli immediati (nuova connessione)

| # | Controllo | Esito |
|---|---|---|
| 1 | Cronologia remota | 0001–0009 |
| 2 | PostGIS | 3.3.7 @ extensions |
| 3–4 | `public.spatial_ref_sys` / `extensions.spatial_ref_sys` | assente / presente |
| 5–6 | Tabelle dell'app con RLS e policy | 41 su 41 (89 policy in public) |
| 7–8 | Colonne geometriche | 9 colonne geometry + `areas.area_m2` generata; tutte SRID 4326, tipi invariati |
| 9 | NOT NULL, vincoli, indici GiST | `areas.geom`, `parcels.geom`, `interventions.geom` NOT NULL; 5 vincoli e 3 indici GiST con i nomi originali |
| 10 | `areas.area_m2` | colonna generata `st_area(geom::geography)` |
| 11 | `save_project` | `search_path = public, extensions` |
| 12 | Bucket e policy Storage | invariati (`project-media` privato, 3 policy) |
| 13 | Catalogo modelli | 4 righe |
| 14 | Dati | 0 utenti, organizzazioni, progetti, file (prima dei test reali) |
| — | Oggetti PostGIS in public | 0 tipi, 0 funzioni `st_*`, 0 viste `geometry_columns` |

## Test geometrici reali (nuova connessione, annullati al termine)

SRID 4326 in scrittura/lettura (EWKT identico), `ST_IsValid` vero (falso per poligono autointersecante),
distanza 583,9 m, intersezione vera, `save_project` come utente autenticato (POLYGON, SRID 4326, 5.403 m²),
indice `projects_area_geom_idx` usato (Index Scan). L'errore `public.spatial_ref_sys does not exist` non si è presentato.

## Confronto istantanee prima/dopo

| Oggetto | Prima | Dopo | Differenze |
|---|---|---|---|
| Migrazioni | 8 | 9 | + 0009 |
| Tabelle (public) | 42 | 41 | − `spatial_ref_sys` (spostata in extensions) |
| Colonne | 441 | 441 | nessuna |
| Vincoli | 195 | 195 | nessuna |
| Indici | 64 | 64 | nessuna |
| Funzioni | 49 | 49 | solo `save_project`: search_path |
| Trigger | 28 | 28 | nessuna |
| Policy (public + storage) | 92 | 92 | nessuna |
| Privilegi anon/authenticated/service_role | 132 | 123 | − privilegi su `spatial_ref_sys`, `geometry_columns`, `geography_columns` (non più in public) |
| Bucket | 1 | 1 | nessuna |

## Security Advisor

| Momento | ERROR | WARN |
|---|---|---|
| Dopo 0008 | 1 | 19 |
| Dopo 0009 | **0** | **12** |

Risolti: `rls_disabled_in_public` (spatial_ref_sys), `extension_in_public` (postgis), 6 avvisi su `st_estimatedextent`.
Restano 12 avvisi voluti: 11 RPC SECURITY DEFINER per utenti autenticati (controllano ruolo e organizzazione) e
`get_shared_project` per anonimi (link condivisi).

## Accesso anonimo

**47/47** (`docs/reports/supabase-anon-check-2026-10-25.md`): i 44 controlli precedenti più 3 nuovi —
`spatial_ref_sys` non leggibile né modificabile via REST (404), `st_estimatedextent` non esposta (404).

## Test sul database reale (`verify.mjs --senza-funzioni`)

20 superati, 1 fallito, 19 non eseguiti (media e Open-Meteo richiedono Edge Function non pubblicate; casi manuali).
Superati tra gli altri: S3 `save_project` via REST da utente reale, F1–F8 previsioni, W1–W3 meteo.

**Problemi esistenti trovati (non causati dalla 0009):**

1. **S5 — conflitto di versione:** `save_project` segnala il conflitto con SQLSTATE `40001`; PostgREST lo tratta come
   errore di serializzazione da ritentare e la richiesta termina con **HTTP 504** dopo il timeout invece di restituire
   subito il conflitto. In locale (PGlite, senza PostgREST) non è visibile.
2. **Organizzazioni non eliminabili:** il trigger “ultimo amministratore” blocca anche la rimozione a cascata delle
   appartenenze quando si elimina l'intera organizzazione.
3. **Utenti proprietari di progetti non eliminabili:** `projects.owner_id` non ha regola `ON DELETE`.

Per i punti 2–3 la pulizia dei dati di prova **non è riuscita** (lo script non controllava gli esiti e lo dichiarava
riuscito: corretto). Restano sullo staging dati di prova riconoscibili (organizzazioni `MDT test …`, email
`…@example.test`): 6 utenti, 4 organizzazioni, 2 progetti, 2 località meteo e le righe collegate. Nessun dato reale.

## Rischi residui

- Dati di prova da rimuovere dopo la correzione dei punti 2–3 (nuova migrazione, non modifica delle 0001–0008).
- Operatori PostGIS (`&&` ecc.) ora in `extensions`: funzionano con il search_path predefinito di Supabase o qualificati.
- Edge Function, segreti, pg_cron e Timestral **non pubblicati**.

## Interfaccia (regola Semplicità e Audit Anno Luce)

Nessuna modifica all'interfaccia in questa attività: migrazione di database e script di verifica.
