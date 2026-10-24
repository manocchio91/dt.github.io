# 01 — Sintesi dei requisiti e assunzioni

Documento di riferimento: *Master Prompt — Micro Digital Twin* (audit Annoluce 23/10/2026), percorso Design Thinking ITS 4.0.

## Posizionamento

**Micro Digital Twin — Climate Decision Lab** è un *Decision Support System dimostrativo e validabile*. Non è un Digital Twin predittivo calibrato né un sistema prescrittivo. La catena comune è:

`dati → qualità e provenienza → baseline → modello dichiarato → scenario → confronto → decisione umana → verifica ex-post`

Due percorsi con infrastruttura condivisa ma flussi, linguaggio e indicatori distinti:

| | Percorso urbano | Percorso agricolo |
|---|---|---|
| Utente principale | Tecnico comunale, gestore del verde | Viticoltore, agronomo |
| Domanda | "Quale intervento riduce meglio il calore in quest'area, a che costo?" | "Quale zona devo controllare e perché?" |
| Unità spaziale | AOI + griglia celle (m²) | Parcella + sottozone (ha) |
| Output | ΔT aria, ΔT superficiale (separati), comfort solo se calcolabile | Stress termico, stress idrico, fenologia, segnali fitosanitari (separati) |
| Decisione | Scelta motivata tra scenari A / B / A+B | Sopralluogo, misura condizionata, consulto esperto |

## Requisiti chiave (sintesi)

1. **Classificazione dato obbligatoria** su ogni numero: MISURATO, OSSERVATO DA DATASET, STIMATO DA MODELLO, PREVISIONE, SIMULATO, INSERITO DALL'UTENTE, DATO MANCANTE — con pannello lineage.
2. **Baseline immutabile e versionata**; una variazione crea una nuova versione.
3. **Confronto equo**: A e B solo con stessa baseline, periodo e versione del modello (bloccante, non avviso).
4. **Incertezza**: intervalli illustrativi dove non statistici; arrotondamento coerente.
5. **Costi separati**: costo prototipo/software ≠ CAPEX ≠ OPEX intervento.
6. **Motore a plugin** con adapter che dichiarano ID, versione, validità, input, output, ipotesi, fonte, metodo d'incertezza, validazione, revisore.
7. **Nessun dato fittizio silenzioso**: errori API visibili.
8. **Decisione umana**: accetta / modifica / rifiuta / invia a esperto, con motivazione.
9. **Ex-post obbligatorio**: piano di monitoraggio, previsto vs osservato, scarto, ricalibrazione senza sovrascrittura.
10. **Stato funzioni visibile**: Operativa, Beta, Dimostrativa, Roadmap, Non disponibile per dati mancanti.

## Assunzioni di progetto (Milestone 0)

| # | Assunzione | Motivo | Da confermare |
|---|---|---|---|
| A1 | La persistenza M0 è **locale (IndexedDB)** dietro un'interfaccia `Repository`; lo schema PostgreSQL/PostGIS è pronto in migrazioni ma non collegato | Non sono disponibili credenziali Supabase. Non simuliamo un backend che non esiste | Credenziali e progetto Supabase (M1) |
| A2 | Il CRS di archiviazione è **EPSG:4326 (WGS84)**; le superfici sono calcolate geodeticamente (formula sferica, raggio WGS84 medio) | Standard GeoJSON RFC 7946 | Eventuale CRS di progetto locale (es. EPSG:32633) per export tecnici |
| A3 | Open-Meteo è usato **direttamente dal client** in M0 perché non richiede chiave | Nessuna chiave da proteggere; in M1 passerà da Edge Function con cache | Termini d'uso per uso non commerciale/commerciale |
| A4 | Tutti i coefficienti dei modelli urbano, agricolo e dei costi sono **parametri illustrativi DEMO** | Non esiste un modello validato fornito; il prompt vieta formule universali inventate | Modello validato e revisore scientifico |
| A5 | Timezone di visualizzazione Europe/Rome; timestamp archiviati in UTC ISO 8601 | Requisito §10 | — |
| A6 | Le geometrie delle aree demo (Campobasso, vigneto molisano) sono **approssimate e dichiarate dimostrative** | Nessun rilievo ufficiale fornito | Geometrie reali dal Comune / azienda |
| A7 | Nessun logo istituzionale è incluso | Il prompt richiede solo asset ufficiali forniti; non ne sono stati forniti | Fornitura asset MIM, Ca' Foscari, ITS 4.0, ITS D.E.Mo.S. |
| A8 | UTCI/WBGT **non vengono calcolati** in M0 | Mancano Tmrt, vento a quota adeguata e radiazione locale validata | Input e formula di riferimento |
| A9 | Autenticazione, tenant, workflow, dossier PDF, media, PWA completa sono **Milestone 1** e appaiono come Roadmap | Ordine di sviluppo §19 | — |
