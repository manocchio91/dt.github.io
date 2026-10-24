# 10 — Rischi e decisioni ancora da approvare

## Rischi

| # | Rischio | Impatto | Probabilità | Mitigazione |
|---|---|---|---|---|
| R1 | I coefficienti DEMO vengono letti come risultati reali | Alto: decisione pubblica su base errata | Media | badge SIMULATO + "intervallo illustrativo" su ogni output; watermark Demo; adapter demo non attivabile in Pilota |
| R2 | Open-Meteo letto come sensore in loco | Medio | Media | badge STIMATO DA MODELLO, dicitura coordinate e risoluzione; test sul testo |
| R3 | Indice agronomico interpretato come prescrizione irrigua | Alto | Media | nessun indice composito in M0; testo condizionale obbligatorio; nessun consiglio se mancano input minimi |
| R4 | Persistenza solo locale: perdita dati cambiando browser | Medio | Alta in M0 | export/reimport JSON del progetto; Supabase in M1 |
| R5 | Uso intensivo tile OSM viola la tile policy | Basso | Bassa | M1: provider tile dedicato o self-hosted |
| R6 | Campioni di test utente piccoli (6+6) | Medio | Certa | descrizione qualitativa, nessuna inferenza statistica forte |
| R7 | Geometrie demo approssimate scambiate per rilievo ufficiale | Basso | Media | etichetta "geometria dimostrativa approssimata" sull'area |
| R8 | Scope creep verso funzioni spettacolari (3D, AI) prima dell'integrità | Alto | Media | ordine milestone vincolante; F23 e F24 in Roadmap |

## Decisioni da approvare

| # | Decisione | Opzioni | Proposta |
|---|---|---|---|
| D1 | Progetto Supabase e regione di hosting (UE) | Supabase Cloud EU / self-hosted | Supabase Cloud eu-central |
| D2 | Modello microclimatico per la modalità Pilota | regressione locale calibrata con sensori / SOLWEIG / ENVI-met | regressione locale calibrata con 3–5 sensori, perché verificabile ex-post |
| D3 | Soglie stress termico/idrico per Tintilia e Montepulciano | da letteratura + agronomo | revisione agronomo incaricato prima del Pilota |
| D4 | Prezzario costi | Prezzario Regione Molise / preventivi reali | prezzario regionale in vigore |
| D5 | Area pilota reale e responsabile validazione | Comune di Campobasso / altro | da concordare con il Comune |
| D6 | Provider tile e geocodifica in produzione | OSM community / MapTiler / self-hosted | self-hosted o provider con contratto |
| D7 | Licenza del codice | MIT / EUPL-1.2 | EUPL-1.2 (PA europea) |
| D8 | Termini Open-Meteo per uso del Comune (commerciale?) | piano gratuito / API key commerciale | verificare con l'ente |
