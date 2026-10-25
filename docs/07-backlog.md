# 07 — Backlog P0 / P1 / P2

P0 = Milestone 0 (integrità) · P1 = Milestone 1 (MVP pilota) · P2 = Milestone 2 (evoluzione)

## P0 — Milestone 0

| ID | Elemento | F | Stato |
|---|---|---|---|
| B-001 | `DataValue` + 7 classi di dato + `DataBadge` con pannello lineage | F21 | fatto |
| B-002 | AOI: disegno poligono, import GeoJSON, area geodetica, validazione (auto-intersezione, vertici, superficie) | F02 | fatto |
| B-003 | Baseline immutabile versionata con hash di contenuto | — | fatto |
| B-004 | Indicatori distinti: T aria 2 m, T superficiale, comfort (DATO MANCANTE se non calcolabile) | F09 | fatto |
| B-005 | Motore a plugin: interfacce Urban/Agriculture/Cost/Uncertainty + adapter DEMO illustrativi | — | fatto |
| B-006 | Scenari riproducibili: hash input, run deterministico, comparabilità bloccante | F14 | fatto |
| B-007 | Interventi urbani tipizzati con geometria e controlli di plausibilità | F08 | fatto |
| B-008 | Griglia di celle collegate a geometria, input e modello; mappa delle differenze | F07 | fatto |
| B-009 | Incertezza: intervallo illustrativo + arrotondamento coerente | F15 | fatto |
| B-010 | Costi separati: prototipo / CAPEX / OPEX / acqua | F16 | fatto |
| B-011 | Percorso agricolo: parcelle/sottozone, input espliciti, fenologia confermata, componenti separate, zone prioritarie con fiducia, confronto misure condizionale | F11–F13 | fatto |
| B-012 | Connettore Open-Meteo (archivio + forecast suolo) con timeout, cache, errore esplicito, metadata | F04 | fatto (Beta) |
| B-013 | QA/QC serie: unità, timestamp futuri, duplicati, fuori range, gap, coordinate fuori area, dati obsoleti | F05 | fatto (dominio) |
| B-014 | Verifica ex-post: piano, import CSV, previsto/osservato/scarto, omogeneità, lezioni, proposta nuova versione modello | F30 | fatto (Dimostrativa: nessun pilota reale) |
| B-015 | Registro F01–F30 con stato visibile in app | — | fatto |
| B-016 | Pagine Fonti e metodo, Limiti e responsabilità | F21 | fatto |
| B-017 | Seed DEMO Campobasso + vigneto molisano | — | fatto |
| B-018 | Export/reimport JSON e GeoJSON del progetto con hash | F25 (parziale) | fatto |
| B-019 | Migrazione SQL PostGIS | — | fatto (non collegata) |

## P1 — Milestone 1

| ID | Elemento | F |
|---|---|---|
| B-101 | Collegamento Supabase: auth, `SupabaseRepository`, RLS per tenant, storage — **fatto** (testato su PGlite; da provare su istanza reale), vedi docs/11 | F26 |
| B-102 | Onboarding per profilo (6 domande), modalità guidata/tecnica — **fatto**, vedi docs/12 | F01 |
| B-103 | Geocodifica via proxy (Nominatim con User-Agent / provider a contratto) | F02 |
| B-104 | Edge Function per Open-Meteo — **fatto come acquisizione `open-meteo-ingest` con registrazione su Supabase (Beta, non pubblicata)** | F04 |
| B-105 | Import sensori CSV/API con anagrafica completa e QA/QC in UI | F05 |
| B-106 | Dashboard urbana, agricola, esecutiva con drill-down | F17–F19 |
| B-107 | Dossier PDF + CSV con dizionario campi + stampa | F25 |
| B-108 | Workflow Bozza → … → Chiusura con approval_events | F27 |
| B-109 | Foto e documenti: tipo reale, EXIF/GPS rimossi, consenso posizione, contesto obbligatorio, retention, eliminazione verificabile, audit, offline — **fatto (Beta)**, vedi docs/13; verifica su Supabase reale in docs/14 | F22 |
| B-123 | Scansione malware dei file caricati (nessun antivirus presente oggi) | F22 |
| B-124 | Gateway server-side: quarantena, verifica byte/impronta/metadati, firma con audit obbligatorio, eliminazione — **fatto** (logica testata su PGlite; Edge Function da provare su Supabase reale) | F22 |
| B-125 | Conservazione: data configurabile, anteprima admin, job di eliminazione con ripresa — **fatto** (pianificazione pg_cron da attivare sul progetto) | F22 |
| B-127 | Sanitizzazione verificata dei PDF (metadati, XMP, allegati, JavaScript anche nei flussi compressi) | F22 |
| B-126 | Conversione reale HEIC → JPEG (oggi rifiutato con istruzioni) | F22 |
| B-110 | PWA: service worker, sync differita, avviso dati obsoleti | F28 |
| B-111 | Casi studio strutturati con punteggio di comparabilità | F20 |
| B-112 | Link condivisi revocabili con scadenza — **fatto** (backend + UI) | F26 |
| B-113 | Test E2E Playwright sui due journey — **avviato** (onboarding, primo scenario, ruoli, mobile) | — |
| B-114 | Audit accessibilità WCAG 2.2 AA (axe + verifica manuale screen reader) | F29 |
| B-115 | Modulo test utenti (consenso, attività, osservazioni, feedback, A/B guidata vs tecnica) | — |
| B-116 | Vista 3D non decorativa (estrusione edifici per ombra) | F03 |
| B-117 | Satellite: prodotto LST / Sentinel-2 con data, risoluzione, nuvolosità | F06 |
| B-118 | Rifugi climatici su rete pedonale | F10 |
| B-120 | UI role-aware: nascondere i comandi di modifica ai viewer — **fatto** (RLS resta la protezione principale) | F26 |
| B-121 | Importazione su conferma di preferenze, progetti e file salvati da ospite (selezione, riepilogo, annullamento) — **fatto** | F01 |
| B-122 | Misurare con utenti reali i tempi di onboarding (< 2 min) e primo scenario (< 5 min) | F01 |
| B-119 | Riapplicare gli interventi di uno scenario a una nuova versione della baseline (nuovo scenario, stessi interventi) | F14 |

### Previsioni probabilistiche (F31)

| ID | Elemento | F |
|---|---|---|
| B-130 | Contratto, baseline, adapter e servizio Timestral, backtest, tabelle, sezione Previsioni — **fatto (Beta, Timestral non eseguito)** | F31 |
| B-131 | Proxy autenticato (Edge Function) tra browser e servizio: verifica sessione e organizzazione, aggiunge il token di servizio, registra le esecuzioni Timestral con il ruolo di servizio | F31 |
| B-132 | Eseguire test del servizio e spike 5M/28M su CPU; generare e versionare `uv.lock` | F31 |
| B-133 | Backtest di Timestral contro le baseline (urbano e agricolo separati) e decisione Beta/validato | F31 |
| B-134 | Previsioni da sensori in campo (F05) e covariate meteo previste note in anticipo | F31 |
| B-135 | Salvataggio delle previsioni nelle tabelle `forecast_*` dalla UI (oggi nel documento di progetto) | F31 |
| B-136 | Soglie validate da agronomo e tecnico comunale; test con utenti sulla comprensione degli intervalli | F31 |

### Acquisizione meteo Open-Meteo → Supabase (F04)

| ID | Elemento | F |
|---|---|---|
| B-140 | Tabelle weather_*, Edge Function open-meteo-ingest, pianificazione pg_cron, pannello “Dati meteorologici” — **fatto (Beta, test locali e smoke test Open-Meteo)** | F04 |
| B-141 | Pubblicare migrazione 0007, funzione e job su Supabase di staging; eseguire W1–W8 di docs/14 — **fatto il 25/10/2026 (staging: Edge Function, segreti, Vault, migrazione 0011, job ogni 3 ore; 22/22 controlli reali, `docs/reports/open-meteo-runtime-2026-10-25.md`)** | F04 |
| B-142 | Import di misure da sensori in weather_observations (CSV/API) con QA (F05) | F04, F05 |
| B-143 | Politica di conservazione a tempo per weather_forecast_points (oggi illimitata) | F04 |
| B-144 | Backtest Open-Meteo vs osservazioni successive e uso come covariata nel backtest di Timestral | F31 |

### Account, organizzazioni e concorrenza (migrazione 0010)

| ID | Elemento | F |
|---|---|---|
| B-150 | Conflitto di salvataggio HTTP 409 (PT409) con avviso semplice, ultimo amministratore verificato a fine transazione, eliminazione di organizzazioni e utenti senza blocchi — **fatto (verificato su Supabase di staging)** | F26 |
| B-151 | Interfaccia amministrativa (fuori dal percorso ordinario) per eliminare un’organizzazione con conferma del nome | F26 |
| B-152 | Mostrare “Utente eliminato” dove l’interfaccia indicherà proprietario o autore di una risorsa | F21 |
| B-153 | Pseudonimizzare gli identificativi di utenti eliminati presenti nei dettagli di `audit_logs` (es. appartenenze) | F21 |

### Semplificazione dell’interfaccia (Audit Anno Luce, `docs/18`)

| ID | Elemento | F |
|---|---|---|
| B-154 | Decision Lab urbano: ridurre a una sola azione primaria per schermata (oggi “Confronta e decidi”, “Posiziona” e “Calcola” hanno lo stesso peso) | F01, F29 |
| B-155 | Estendere l’indicazione “Passo n di 7” a Foto e documenti e, dove utile, alle pagine informative | F01 |
| B-156 | Soglie del pannello meteo per progetto, fissate dall’esperto (oggi dimostrative: 32 °C urbano, 0,16 m³/m³ suolo) | F04, F09, F13 |
| B-157 | Annunci del grafico delle previsioni in parole semplici per gli screen reader nella modalità guidata (oggi “mediana”, quantili) | F29, F31 |
| B-158 | Validazione con utenti reali (tecnico comunale, viticoltore, agronomo) del percorso guidato e del tempo al primo scenario | F01 |
| B-159 | Menu nativo “Modello” nelle Previsioni a 320 px: il browser tronca il nome della voce selezionata (testo completo solo aprendo il menu) | F29 |
| B-160 | Messaggio semplice quando si tenta di cancellare l’unico amministratore di un’organizzazione (oggi errore tecnico del database) | F26 |
| B-161 | Stabilità del test lento della pagina Previsioni (tempi vicini al limite su macchine lente) | — |

### Dopo il collegamento Open-Meteo → Supabase (25/10/2026)

| ID | Elemento | F |
|---|---|---|
| B-162 | Calibrazione dei dati Open-Meteo con sensori locali (oggi dato territoriale modellato, cella di alcuni km) | F04, F05, F30 |
| B-163 | Validazione scientifica delle soglie (caldo urbano, umidità del suolo, soglie per coltura) con tecnico comunale e agronomo | F09, F13, F31 |
| B-164 | Timestral reale: servizio eseguito, pesi installati fuori da Git, backtest e decisione (vedi B-131–B-133); fino ad allora “modello avanzato non disponibile” | F31 |
| B-165 | Proxy autenticato per Timestral (B-131) prima di qualunque collegamento dal sito pubblico | F31 |
| B-166 | Politica di conservazione dei dati meteorologici (B-143): durata, aggregazione, cancellazione | F04, F25 |
| B-167 | Decision Lab agricolo robusto a documenti incompleti dal server (un progetto senza fase fenologica blocca la pagina) | F28 |
| B-168 | Tag `ux-audit-semplificata` pubblicato per errore su 4dfc7f7 invece che sul merge 0fb8ca9: correggerlo richiede di eliminare il tag remoto (decisione del responsabile) | — |
| B-169 | Security Advisor: “leaked password protection” di Supabase Auth disattivata (avviso, piano a pagamento) | F26 |
| B-170 | GitHub Pages risponde con stato HTTP 404 (pagina di fallback) alle route interne aperte direttamente: funzionano, ma compaiono come errori di rete in console | — |

## P2 — Milestone 2

| ID | Elemento | F |
|---|---|---|
| B-201 | AI fotografica: solo con dataset, benchmark, OOD, confidenza, supervisione agronomica | F23 |
| B-202 | Suggerimento spiegabile del posizionamento sensori con approvazione umana | F24 |
| B-203 | Modelli calibrati (modalità Pilota) e ricalibrazione da ex-post | F30 |
| B-204 | Offline avanzato e risoluzione conflitti | F28 |

## Elementi mancanti registrati (dati, fonti, credenziali)

| ID | Mancante | Effetto |
|---|---|---|
| M-01 | Modello microclimatico validato + revisore | Modalità Pilota bloccata |
| M-02 | Input UTCI/WBGT (Tmrt, vento pedone) | Comfort = DATO MANCANTE |
| M-03 | Soglie agronomiche validate per cultivar | soglie DEMO "da validare" |
| M-04 | Prezzario costi interventi | costi DEMO con intervallo |
| M-05 | Geometrie ufficiali aree demo | geometrie approssimate |
| M-06 | Credenziali Supabase / Copernicus | persistenza locale, satellite in Roadmap |
| M-07 | Asset istituzionali ufficiali | nessun logo |
