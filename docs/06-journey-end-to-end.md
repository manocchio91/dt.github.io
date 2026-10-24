# 06 — Journey end-to-end

## Journey U — Tecnico comunale, Campobasso (Piazza Vittorio Emanuele II)

| # | Passo | Cosa vede / fa | Dato e badge | Criterio |
|---|---|---|---|---|
| U1 | Apre la Demo dalla landing | Sceglie "Scenario urbano" | — | nessuna registrazione |
| U2 | Carica il seed DEMO Campobasso | AOI disegnata, superficie in m², CRS EPSG:4326 | Superficie: STIMATO DA MODELLO (calcolo geodetico) | F02 |
| U3 | Sceglie periodo (es. 15 lug–15 ago) e ora (15:00 Europe/Rome) | | INSERITO DALL'UTENTE | |
| U4 | Legge la baseline | T aria max media, T superficiale stimata, comfort | SIMULATO (seed) oppure STIMATO DA MODELLO (Open-Meteo); comfort = DATO MANCANTE | F04, F09 |
| U5 | Crea Scenario A: 12 alberi | posiziona punti sulla mappa, sceglie diametro chioma | INSERITO DALL'UTENTE | F08 |
| U6 | Crea Scenario B: vela ombreggiante + depaving | disegna poligoni | INSERITO DALL'UTENTE | F08 |
| U7 | Calcola | ΔT aria e ΔT superficiale separati, con intervallo illustrativo | SIMULATO, modello `demo-urban-illustrative@0.1.0` | F09, F15 |
| U8 | Confronta A, B, A+B | tabella + mappe differenze per cella | SIMULATO | F07, F14 |
| U9 | Valuta costi | prototipo 0 € (separato), CAPEX, OPEX/anno, acqua | STIMATO DA MODELLO (costi DEMO) | F16 |
| U10 | Motiva la scelta | testo obbligatorio, esito "invia a revisione" | INSERITO DALL'UTENTE | F27 (parziale M0) |
| U11 | Definisce il piano ex-post | variabili, punti, periodo, frequenza | INSERITO DALL'UTENTE | F30 |
| U12 | Importa misure ex-post (CSV) | previsto vs osservato, scarto | MISURATO / OSSERVATO DA DATASET | F30 |

## Journey V — Viticoltore e agronomo, vigneto molisano (Tintilia)

| # | Passo | Cosa vede / fa | Dato e badge | Criterio |
|---|---|---|---|---|
| V1 | Carica il seed DEMO vigneto | parcella + 2 sottozone (Zona A, Zona B), superficie in ha | | F11 |
| V2 | Verifica input agronomici | cultivar Tintilia, portinnesto 1103 P, suolo, esposizione, pendenza | INSERITO DALL'UTENTE | F11 |
| V3 | Seleziona e **conferma** fase fenologica | "Invaiatura" + conferma esplicita | INSERITO DALL'UTENTE | F12 |
| V4 | Vede i dati | meteo modellistico, umidità suolo 0–7 cm "stima riferita all'area, non misurata sul terreno" | STIMATO DA MODELLO / SIMULATO (seed) | F04 |
| V5 | Legge le componenti per zona | stress termico, stress idrico, fenologia, segnali fitosanitari — separati | SIMULATO + motivazione | F12 |
| V6 | Identifica la zona da controllare | Zona A priorità alta, fiducia "media" perché manca un sensore suolo | | F18 (≤2 min) |
| V7 | Confronta misure | nessun intervento vs sopralluogo vs irrigazione di soccorso condizionata | testo condizionale, mai prescrittivo | F13 |
| V8 | Registra decisione | "Sopralluogo + consulto agronomo", motivazione, supervisore | INSERITO DALL'UTENTE | |
| V9 | Verifica successiva | misure di campo importate vs indicatore atteso | MISURATO | F30 |

In entrambi i journey l'interfaccia mostra **quali dati mancano** e **come cambiano il livello di fiducia**.
