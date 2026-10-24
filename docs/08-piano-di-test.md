# 08 — Piano di test

## Livelli

| Livello | Strumento | Copertura M0 |
|---|---|---|
| Unitari dominio | Vitest (`packages/domain`) | geometria e area, validazione AOI, hash deterministico, baseline immutabili, adapter urbano/agricolo/costi/incertezza, comparabilità, QA/QC, connettore Open-Meteo (fetch simulato, errori espliciti), ex-post, registro funzioni |
| Componenti | Vitest + Testing Library (`apps/web`) | `DataBadge` apre il pannello lineage; DATO MANCANTE senza numero |
| Database | Vitest + PGlite (PostgreSQL 17 + PostGIS) con schemi Supabase emulati | RLS, ruoli, integrità documento, link condivisi, storage, preferenze utente (`supabase/tests`) |
| End-to-end | Playwright su Microsoft Edge (build di produzione) | onboarding urbano/agricolo, primo scenario da zero, solo tastiera, Demo senza registrazione, preferenze, backend Supabase simulato (ruoli, cambio organizzazione, persistenza, 403 lato server), smartphone — `npm run e2e` |
| Accessibilità | axe-core + manuale | M1 (B-114); in M0: focus visibile, landmark, etichette, pattern oltre al colore |
| CI | lint + typecheck + test + build | script `npm run ci` |

## Test che codificano i divieti (§21)

| Divieto | Test |
|---|---|
| Stime come misurazioni | il connettore Open-Meteo marca i valori `STIMATO_DA_MODELLO`/`PREVISIONE`, mai `MISURATO` |
| Errori API nascosti | timeout/HTTP 500/JSON malformato → `ok:false`, nessun valore restituito |
| Precisione non calcolata | gli output urbani hanno `range` e `uncertainty.isStatistical === false` con etichetta "intervallo illustrativo"; arrotondamento a 0,5 °C |
| Prototipo gratuito ≠ intervento gratuito | `prototype` separato da `capex`/`opex` nel risultato dei costi |
| Prescrizione agronomica | il testo irriguo contiene "Prima di intervenire verifica"; nessun consiglio se mancano input minimi |
| Fenologia dedotta | senza conferma esplicita la fenologia è `DATO_MANCANTE` e la fiducia scende |
| Confronto non equo | `checkComparability` fallisce con baseline/periodo/modello diversi |
| Adapter demo in Pilota | il registro solleva errore |
| Baseline modificata | `updateBaseline` crea una nuova versione, l'originale resta invariato (oggetto congelato) |

## Sprint (fase Test ITS 4.0)

| Sprint | Obiettivo | Partecipanti | Attività | Metriche |
|---|---|---|---|---|
| 1 Verifica tecnica | inventario F01–F30, log/API, lineage, responsive, accessibilità, persistenza, permessi, export/reimport, errori | team | checklist in `/stato` | requisiti con evidenza / totale |
| 2 Urbano | journey U | ≥6 tecnici municipali | creare AOI, leggere baseline, due alternative, costi/benefici, motivare, esportare | completamento ≥80%, confronto ≤10 min, motivazione ≥80% |
| 3 Agricolo | journey V | ≥6 agricoltori/agronomi | verifica parcella/fenologia, zona prioritaria, perché, confronto misure, osservazione, decisione | zona trovata ≤2 min, zero errori critici |
| 4 A/B | guidata vs tecnica | stessi profili | stesse attività | stesse metriche, tabella feedback unica |

Soglie: completamento ≥80%; comprensione incertezza ≥90%; zero errori critici; ≥80% motiva la scelta; confronto ≤10 min; primo scenario guidato ≤5 min; zona da controllare ≤2 min. **Sono soglie di progetto, non risultati.** Con campioni piccoli si riportano descrizioni qualitative senza inferenze statistiche forti. I risultati dei test con utenti reali vanno archiviati separatamente dai dati simulati.
