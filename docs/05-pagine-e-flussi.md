# 05 — Mappa delle pagine e dei flussi

## Navigazione

- **Smartphone (<768 px):** barra inferiore con 5 voci — Home, Progetti, Lab, Confronto, Metodo.
- **Desktop:** barra laterale con tutte le voci + indicatore di modalità (Demo / Pilota) sempre visibile.
- Banner di modalità persistente: "Modalità Demo — stime illustrative, non validate".

## Pagine

| Route | Pagina | Milestone | Contenuto principale |
|---|---|---|---|
| `/` | Landing | M0 | Promessa, scelta urbano/agricolo, processo in 5 passi, avviso maturità, accesso Demo |
| `/progetti` | Progetti | M0 | Elenco, creazione (urbano/agricolo), carica seed DEMO |
| `/progetti/:id/area` | Area / parcelle | M0 | Ricerca località (M1), disegno poligono, import GeoJSON, CRS, superficie, validazione |
| `/progetti/:id/urbano` | Decision Lab urbano | M0 | 10 passi del §5.4 in stepper |
| `/progetti/:id/agricolo` | Decision Lab agricolo | M0 | 9 passi del §5.5 in stepper |
| `/progetti/:id/confronto` | Confronto scenari | M0 | Tabella baseline/A/B/A+B + mappe delle differenze affiancate |
| `/progetti/:id/verifica` | Verifica ex-post | M0 | Piano, import misure, previsto vs osservato, lezioni, ricalibrazione |
| `/metodo` | Fonti e metodo | M0 | Registro adapter, lineage, classi di dato |
| `/stato` | Stato funzioni | M0 | F01–F30 con stato e evidenza |
| `/limiti` | Limiti e responsabilità | M0 | Disclaimer, cosa l'app non fa |
| `/benvenuto` | Onboarding | M1 ✔ | 6 domande, profilo ≠ ruolo, modalità guidata/tecnica, salto in Demo; `?modifica=1` per cambiare le preferenze |
| `/accesso` | Accesso e organizzazione | M1 ✔ | login, scelta organizzazione, membri |
| `/condiviso/:token` | Vista condivisa | M1 ✔ | sola lettura via link con scadenza |
| `/dashboard/*` | Dashboard urbana / agricola / esecutiva | M1 | |
| `/progetti/:id/dossier` | Dossier e workflow | M1 | |
| `/progetti/:id/osservazioni` | Foto e documenti | M1 | |
| `/progetti/:id/previsioni` | Previsioni (Beta) | M1 | F31: storico, “ora”, mediana, banda selezionabile, soglie, confronto baseline, ex-post, tabella alternativa |
| `/casi-studio` | Casi studio | M1 | |

## Flusso urbano (M0)

```
Area valida? ──no──► blocco simulazione con motivo
   │sì
Periodo + ora di riferimento
   │
Baseline (seed DEMO oppure Open-Meteo archivio) ──► salvata immutabile v1
   │                                            └─► modifica = nuova versione v2
Indicatori separati: T aria | T superficiale | Comfort (DATO MANCANTE se non calcolabile)
   │
Scenario A, Scenario B (stessa baseline, stesso modello) ──► interventi geometrici
   │
Calcolo deterministico (hash input) ──► output con intervallo illustrativo
   │
Confronto (bloccato se presupposti diversi) ──► costi, acqua, manutenzione, vincoli
   │
Decisione motivata (accetta/modifica/rifiuta/esperto) ──► piano di verifica ex-post
```

## Flusso agricolo (M0)

```
Parcella + sottozone valide
   │
Input agronomici (coltura, cultivar, portinnesto, sesto, suolo, esposizione, pendenza, irriguo)
   │
Fase fenologica: selezione + conferma esplicita (mai dedotta)
   │
Dati: meteo modellistico, suolo (stima riferita all'area), osservazioni utente
   │
Componenti separate per zona: stress termico | stress idrico | fenologia | segnali fitosanitari
   │
Zone da controllare: priorità + motivazione + livello di fiducia (ridotto dai dati mancanti)
   │
Confronto misure (nessun intervento, sopralluogo, irrigazione condizionata, cover crop, ombreggiamento)
   │
Decisione registrata sotto supervisione ──► verifica della risposta del vigneto
```
