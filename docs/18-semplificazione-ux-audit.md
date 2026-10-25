# 18 — Semplificazione dell’interfaccia (Audit Anno Luce)

Regola: **complessità tecnica dietro le quinte, semplicità davanti all’utente.**
Branch `feat/ux-semplificazione-audit`, partito da `master` 4dfc7f7 (tag `staging-db-0010`).
Nessuna modifica a database, migrazioni, Edge Function o servizi esterni.

## 1. Problemi di usabilità individuati (prima)

Schermate di riferimento in `docs/ux/schermate/prima/` (desktop 1280 px e smartphone 375 px).

| # | Dove | Problema | Effetto per un tecnico comunale o un viticoltore |
|---|---|---|---|
| P1 | Guida iniziale | Domande formulate diversamente dal testo concordato; pulsanti “Avanti →”, “Inizia”, “Salva e apri” cambiavano a ogni passo; “Indietro” poco visibile (stile testuale) | Non è chiaro quale sia l’azione da fare |
| P2 | Guida iniziale | Le risposte si perdevano uscendo dalla guida | Chi viene interrotto deve ricominciare |
| P3 | Guida iniziale | Decisioni agricole come “Capire se serve acqua” / “irrigazione di soccorso” | Può far credere che l’app prescriva un’irrigazione |
| P4 | Guida iniziale | Decisioni urbane senza “zone più esposte al caldo” e “soglia da monitorare”; agricole senza fase fenologica, soglia dell’agronomo, confronto scenari | Il percorso non rispecchia le decisioni reali dei due profili |
| P5 | Home | Tre pulsanti con lo stesso peso (Inizia + due demo) e collegamenti ripetuti del menu; testo superato “Accesso autenticato: roadmap” | Nessuna azione principale evidente; informazione non vera |
| P6 | Pannello meteo | In apertura: metadati tecnici (modello `best_match`, cella 41.5861, 14.6614, quota), griglia di 6–10 valori e tabella di 24–72 righe × 8 colonne | Informazione da sviluppatore in primo piano, nessuna sintesi né prossimo passo |
| P7 | Pannello meteo | Messaggio “Archivio meteo non collegato” con “Open-Meteo → Supabase” | Nomi di servizi interni nel percorso ordinario |
| P8 | Pannello meteo | Codici di errore (es. `TIMEOUT`) e “job pianificato” | Linguaggio tecnico |
| P9 | Previsioni | Sei impostazioni in apertura (emissione, “q0,10–q0,90”, confronto ex-post…) | Troppe scelte prima di vedere il risultato |
| P10 | Previsioni | Nota sui “21 quantili”, tabella di backtest con MAE/WQL, impronta dell’input e revisione del modello sempre visibili | Dettagli di audit in primo piano |
| P11 | Previsioni | “Timestral 5M (Beta)”, “Timestral 28M” e “Motore Timestral non configurato” nel percorso guidato | Nomi interni; non si capisce cosa fare |
| P12 | Previsioni | Nessuna sintesi: per sapere “che cosa succede e quando” bisognava leggere il grafico | Il messaggio essenziale non è immediato |
| P13 | Etichette di fonte | “DATO DA SENSORE” diverso dalla dicitura concordata; descrizione disponibile solo come testo visivo | Fonte meno chiara per chi usa uno screen reader |
| P14 | Decision Lab urbano | Impronte (hash) di baseline e calcolo e riferimenti dei modelli sempre visibili | Dettagli da sviluppatore nella modalità guidata |
| P15 | Pagine del progetto | Nessuna indicazione comune di “dove sono” nei 7 passi del percorso; sigla “AOI” nel menu e nel titolo; “IndexedDB” nella pagina Progetti | Orientamento affidato all’utente; sigle non spiegate |

## 2. Modifiche effettuate

| Area | Modifica | Commit |
|---|---|---|
| Guida iniziale | Testo delle 6 domande concordato; “Continua” unica azione primaria; “Indietro” secondario; “Domanda n di 6” anche sulla barra di avanzamento; bozza salvata a ogni risposta e “Esci e riprendi dopo”; opzioni adattate all’ambito; decisioni allineate ai due percorsi; decisioni salvate in precedenza rimappate | onboarding |
| Home | “Inizia” unica azione principale, demo come azioni secondarie, testo sull’accesso corretto, collegamenti duplicati rimossi | onboarding |
| Pannello meteo | Sintesi guidata (stato Regolare/Attenzione/Critico con simbolo e testo, valore principale, previsione in una frase, soglia dimostrativa, momento previsto, ultimo aggiornamento, fonte, prossimo passo); avviso “Dato territoriale modellato…” sempre visibile; “Dettagli della fonte” e “Tutti i valori ora per ora” espandibili; nuovo messaggio quando l’archivio non è collegato; codici di errore solo nei dettagli | pannello meteo |
| Etichette di fonte | MISURATO DA SENSORE, DATO OPEN-METEO, STIMATO DA MODELLO, SIMULATO con testo, simbolo, stile del bordo e descrizione accessibile (`title` + testo per screen reader) | pannello meteo |
| Previsioni | “In sintesi” in parole semplici; impostazioni ridotte a grandezza, orizzonte, modello; “Approfondimento tecnico” chiuso nella guidata; “Modello avanzato” nella guidata con messaggio e pulsante verso la previsione di base; soglia in una frase con modifica a richiesta | Previsioni |
| Percorso | Indicazione “Passo n di 7” con cosa osservi, perché conta e prossimo passo in Progetti, Area, Decision Lab, Previsioni, Confronto, Verifica (solo modalità guidata); impronte e riferimenti dei modelli del Lab urbano nella modalità tecnica; “AOI” e “IndexedDB” sostituiti | percorso guidato |
| Test | Test unitari e E2E di usabilità (sezione 8) | test |

## 3. Conferma delle 6 domande

Le sei domande restano, nello stesso ordine, una per schermata, per entrambi i percorsi:

1. Chi sei?
2. In quale ambito lavori?
3. Quale decisione devi prendere?
4. Su quale area, parcella o progetto lavori?
5. Quali dati possiedi già?
6. Preferisci la modalità guidata o tecnica?

Nessuna domanda eliminata o aggiunta, nessun modulo unico. Il profilo operativo resta separato dal ruolo organizzativo: la bozza e le preferenze accettano solo i campi della guida (un campo `role` iniettato viene scartato, verificato da test) e le risposte non assegnano permessi.

## 4. Differenze fra percorso urbano e agricolo

| Domanda | Urbano (tecnico comunale, gestore del verde) | Agricolo (agricoltore/viticoltore, agronomo) |
|---|---|---|
| Ambito | Città | Campagna |
| Decisione | Individuare le zone più esposte al caldo · Controllare una piazza, una strada o un parco · Confrontare possibili interventi · Tenere d’occhio una soglia di caldo · Verificare gli effetti di un intervento già fatto | Controllare lo stress da caldo o da siccità · Osservare una parcella · Tenere conto della fase della coltura · Verificare una soglia indicata dall’agronomo · Programmare un sopralluogo · Confrontare condizioni e scenari |
| Area | Area dimostrativa di Campobasso · Una mia nuova area (piazza, strada, parco) · Un’area o un progetto che ho già | Vigneto dimostrativo · Una mia nuova parcella o vigneto · Una parcella o un progetto che ho già |
| Dati | confini, temperature delle superfici, sensori dell’aria, costi | confini delle parcelle, sonda del suolo, stazione meteo, osservazioni in campo, analisi del suolo |
| Pannello meteo | temperatura dell’aria rispetto a 32 °C (soglia dimostrativa del tecnico comunale); “Verifica le aree più frequentate e valuta le misure previste dal piano comunale.” | umidità stimata del suolo (9–27 cm) rispetto a 0,16 m³/m³, poi caldo per la coltura rispetto alla soglia del progetto; “Controlla la parcella o consulta l’agronomo prima di intervenire.” |
| Previsioni | verifica sul posto delle aree più frequentate | verifica in campo delle zone segnalate o confronto con l’agronomo |

Nessuna voce prescrive irrigazioni, trattamenti o interventi automatici (verificato da test sul testo).

## 5. Informazioni spostate nei dettagli tecnici (nulla è stato eliminato)

| Schermata | Ora in primo piano (guidata) | Spostato in sezione espandibile (aperta nella modalità tecnica) |
|---|---|---|
| Pannello meteo | stato, valore, frase di previsione, soglia, quando, ultimo aggiornamento, fonte, prossimo passo, avviso di dato modellato, legenda delle fonti | **Dettagli della fonte**: Open-Meteo Forecast API, modello richiesto/restituito, cella e quota, punto richiesto, intervallo temporale, variabili e unità, limiti spaziali, licenza e attribuzione. **Tutti i valori ora per ora**: valori attuali, suolo per profondità, orizzonte 24/72 h, tabella oraria. Codici di errore |
| Previsioni | sintesi, grandezza/orizzonte/modello, grafico, esito della soglia, soglia in una frase, registro ed ex-post | **Approfondimento tecnico**: emissione, intervallo con quantili (q0,10–q0,90 …), confronto ex-post immediato, cella della rianalisi, nota sui 21 quantili, backtest (MAE, WQL, copertura, falsi allarmi, criticità mancate), modello con versione e revisione, licenze, dati in ingresso, covariate, impronta dell’input, tempo di calcolo, avvertenze. Campi di modifica della soglia. Nome e stato di Timestral |
| Decision Lab urbano | baseline, integrità verificata, data di calcolo | impronte di baseline, input e output, riferimenti di modello e costi |

## 6. Elementi rimossi perché duplicati

- Home: pulsanti “Progetti salvati” e “Stato delle funzioni” (già nel menu e nella barra inferiore su smartphone). “Limiti e responsabilità” resta perché su smartphone non è nella barra inferiore.
- Home: testo “Accesso autenticato e progetti condivisi: roadmap”, superato.
- Pannello meteo: attribuzione Open-Meteo ripetuta in fondo al pannello (ora nei dettagli della fonte, insieme alla licenza).
- Previsioni: nota sui 21 quantili ripetuta sotto l’esito della soglia (ora una sola volta nell’approfondimento).
- Guida iniziale: la riga “Circa 1 minuto · le risposte si possono cambiare dopo” è sostituita da “Esci e riprendi dopo” e dalla nota sulla modalità all’ultima domanda.

## 7. Matrice interna: modifica → Audit Anno Luce

| Modifica | Requisito | Bisogno dell’utente | Informazione essenziale | Dettaglio tecnico nascosto | Offline / senza servizi | Criterio di test |
|---|---|---|---|---|---|---|
| Guida in 6 domande con “Continua”, bozza e ripresa | F01, F26, F29 | Iniziare senza formazione e senza perdere il lavoro | domanda corrente, avanzamento n di 6 | — | bozza in `localStorage`; senza archiviazione vale per la visita | `usabilityOnboarding.test.tsx`, `onboarding.test.tsx`, `e2e/usability*.spec.ts`, `e2e/onboarding.spec.ts` |
| Decisioni per percorso, nessuna prescrizione | F01, F12, F13 | Ritrovare le proprie decisioni reali | decisione nel linguaggio del profilo | id interni delle decisioni | — | `onboardingPaths.test.ts`, E2E agricoltore |
| Profilo separato dal ruolo | F26 | Sicurezza: il profilo non dà permessi | ruolo mostrato quando si è in un’organizzazione | — | — | test “la bozza non trasporta permessi”, test esistenti sul ruolo “lettura” |
| Sintesi del pannello meteo | F04, F09, F15 | Sapere subito se c’è una criticità e cosa fare | stato, valore, soglia, quando, aggiornamento, fonte, prossimo passo | modello, cella, quota, unità, tabella oraria | senza rete: ultimi dati scaricati dichiarati; senza archivio: messaggio semplice | `weatherSummary.test.ts`, `weatherPanel.test.tsx`, `e2e/weather.spec.ts` |
| “Dato territoriale modellato…” sempre visibile | F04, F21 | Non confondere modello e misura | avviso fisso | — | anche con dati in cache | `weatherPanel.test.tsx`, `e2e/weather.spec.ts` |
| Quattro etichette di fonte | F05, F15, F21, F29 | Distinguere misurato, Open-Meteo, stimato, simulato | etichetta con testo e simbolo | descrizione completa per screen reader e al passaggio | — | `e2e/usability.spec.ts` (quattro fonti), `weatherPanel.test.tsx` |
| Sintesi delle Previsioni | F15, F31 | Capire cosa, quando, quanto e con quale probabilità | valore centrale, fascia in parole semplici, probabilità, fonte, verifica | quantili, intervalli tecnici, backtest, hash, revisione | funziona senza servizio esterno (previsione di base nel browser) | `forecast.test.tsx`, `e2e/forecast*.spec.ts`, `e2e/usability.spec.ts` |
| Modello avanzato non attivo | F31 | Non credere attivo un modello che non lo è | “Il modello avanzato non è ancora disponibile. Puoi consultare la previsione di base.” | nome Timestral, versione, stato, motivo | nessun risultato sostitutivo; un clic torna alla baseline | `forecast.test.tsx`, `e2e/forecast.spec.ts`, `e2e/usability.spec.ts` |
| Approfondimento tecnico | F21, F25, F27, F30, F31 | Audit e verifica per l’esperto | — | tutto il dettaglio precedente, senza tagli | — | test “dettagli chiusi e apribili”, modalità tecnica aperta |
| Passo n di 7 nelle pagine del progetto | F01, F14, F27, F30 | Sapere dove si è e cosa fare dopo | passo, cosa osservi, perché conta, prossimo passo | — | — | E2E tecnico comunale e agricoltore |
| Impronte del Lab nella modalità tecnica | F21, F25 | Meno rumore nella guidata | integrità verificata | hash e riferimenti dei modelli | — | E2E modalità tecnica (hash visibile), E2E guidata (assente) |
| Home con una sola azione principale | F01 | Iniziare dalla guida o dalla demo senza registrazione | “Inizia” | — | demo con valori SIMULATI senza servizi | `e2e/usability.spec.ts` (demo senza registrazione) |

Restano invariati: registro di audit, tracciabilità e provenienza (lineage), incertezza, versionamento di baseline e previsioni, privacy, separazione reale/stimato/simulato, verifica ex-post.

## 8. Test di usabilità automatizzati

- `apps/web/src/test/usabilityOnboarding.test.tsx`: una domanda per schermata, “Domanda 1 di 6” … “6 di 6”, un solo pulsante primario “Continua”, “Indietro” secondario, risposte conservate tornando indietro, uscita e ripresa, bozza senza permessi, opzioni urbane (5) e agricole (6).
- `packages/domain/src/onboarding/onboardingPaths.test.ts`: decisioni dei due percorsi, nessuna formulazione prescrittiva, rimappatura delle decisioni salvate.
- `apps/web/src/test/weatherSummary.test.ts`: stato regolare/attenzione/critico, finestra “domani tra le 13:00 e le 16:00”, soglia del suolo, nessuna sintesi senza dati futuri, giorni nel fuso di Roma.
- `apps/web/src/test/weatherPanel.test.tsx` e `forecast.test.tsx` (nuovi blocchi): contenuti della sintesi, dettagli chiusi e apribili, modalità tecnica aperta, nessun quantile/WQL/MASE/hash in primo piano, modello avanzato mai attivo senza servizio, nessuna prescrizione agricola.
- `e2e/usability.spec.ts`: tecnico comunale e agricoltore in modalità guidata, cambio di ambito, percorso da tastiera con uscita e ripresa, demo senza Supabase né Open-Meteo, dettagli tecnici chiusi e apribili, modalità tecnica, quattro fonti, zoom al 200%.
- `e2e/usability-mobile.spec.ts`: smartphone a 375 px (6 domande, pannello meteo, previsioni, ripresa della guida).
- Tempo fino al primo scenario: già misurato da `e2e/onboarding.spec.ts` (limite 5 minuti, annotazione con il tempo reale).

## 8 bis. Schermate prima e dopo

Generate con `MDT_CAPTURE=prima|dopo npx playwright test ux-capture --project=desktop` (desktop 1280 × 800, smartphone 375 × 812; Open-Meteo e mappe bloccati, backend simulato per il pannello con dati).

| Schermata | Prima (master 4dfc7f7) | Dopo |
|---|---|---|
| Home | [desktop](ux/schermate/prima/01-home-desktop.png) · [smartphone](ux/schermate/prima/01-home-smartphone.png) | [desktop](ux/schermate/dopo/01-home-desktop.png) · [smartphone](ux/schermate/dopo/01-home-smartphone.png) |
| Guida, domanda 1 | [desktop](ux/schermate/prima/02-onboarding-domanda-1-desktop.png) · [smartphone](ux/schermate/prima/02-onboarding-domanda-1-smartphone.png) | [desktop](ux/schermate/dopo/02-onboarding-domanda-1-desktop.png) · [smartphone](ux/schermate/dopo/02-onboarding-domanda-1-smartphone.png) |
| Decision Lab urbano | [desktop](ux/schermate/prima/03-lab-urbano-desktop.png) · [smartphone](ux/schermate/prima/03-lab-urbano-smartphone.png) | [desktop](ux/schermate/dopo/03-lab-urbano-desktop.png) · [smartphone](ux/schermate/dopo/03-lab-urbano-smartphone.png) |
| Pannello meteo senza archivio | [desktop](ux/schermate/prima/04-meteo-non-collegato-desktop.png) · [smartphone](ux/schermate/prima/04-meteo-non-collegato-smartphone.png) | [desktop](ux/schermate/dopo/04-meteo-non-collegato-desktop.png) · [smartphone](ux/schermate/dopo/04-meteo-non-collegato-smartphone.png) |
| Previsioni urbane | [desktop](ux/schermate/prima/05-previsioni-urbano-desktop.png) · [smartphone](ux/schermate/prima/05-previsioni-urbano-smartphone.png) | [desktop](ux/schermate/dopo/05-previsioni-urbano-desktop.png) · [smartphone](ux/schermate/dopo/05-previsioni-urbano-smartphone.png) |
| Modello avanzato non configurato | [desktop](ux/schermate/prima/06-previsioni-modello-avanzato-desktop.png) · [smartphone](ux/schermate/prima/06-previsioni-modello-avanzato-smartphone.png) | [desktop](ux/schermate/dopo/06-previsioni-modello-avanzato-desktop.png) · [smartphone](ux/schermate/dopo/06-previsioni-modello-avanzato-smartphone.png) |
| Previsioni del vigneto | [desktop](ux/schermate/prima/07-previsioni-agricolo-desktop.png) · [smartphone](ux/schermate/prima/07-previsioni-agricolo-smartphone.png) | [desktop](ux/schermate/dopo/07-previsioni-agricolo-desktop.png) · [smartphone](ux/schermate/dopo/07-previsioni-agricolo-smartphone.png) |
| Pannello meteo con dati (backend simulato) | [desktop](ux/schermate/prima/08-meteo-collegato-desktop.png) · [smartphone](ux/schermate/prima/08-meteo-collegato-smartphone.png) | [desktop](ux/schermate/dopo/08-meteo-collegato-desktop.png) · [smartphone](ux/schermate/dopo/08-meteo-collegato-smartphone.png) |

## 9. Le 8 domande anti-complessità

| Domanda | Risposta |
|---|---|
| Bisogno reale? | Sì: orientarsi, sapere cosa succede e cosa fare, senza nomi interni |
| Richiesto dall’audit? | Sì: F01, F04, F15, F29, F31 (matrice al punto 7) |
| Integrabile in schermate esistenti? | Sì: nessuna nuova voce di menu, nessuna nuova pagina |
| Informazione minima? | Sintesi di 6–8 righe per meteo e previsioni |
| Dettagli nascosti? | In sezioni espandibili, aperte nella modalità tecnica |
| Passaggi in più? | No: 6 domande come prima; “Mostra la previsione di base” evita un passaggio |
| Comprensibile senza formazione? | Frasi brevi, unità e orari in italiano, stato con simbolo e testo |
| Funziona senza servizio? | Sì: demo e previsione di base senza Supabase, Open-Meteo e Timestral (E2E) |

## 9 bis. Validazione manuale (25/10/2026)

Build per GitHub Pages servita da `vite preview` nella sottocartella `/dt.github.io/`, browser integrato (Chromium), archivio del browser svuotato prima di ogni percorso.

| Verifica | Esito |
|---|---|
| Tecnico comunale, modalità guidata | 6 domande con il mouse, “Indietro” dalla domanda 4 conserva la decisione; Lab urbano con “Passo 3 di 7”, cosa osservi, perché conta, prossimo passo; nessuna impronta visibile; Previsioni con sintesi, “previsione di base”, 2 scelte di modello, approfondimento chiuso |
| Agricoltore/viticoltore, modalità guidata | 6 domande solo da tastiera (Tab, Spazio, frecce, Invio); “Passi 3–7 di 7”; “Dati meteo non ancora collegati.”; prima zona da controllare; nessuna formulazione prescrittiva; bozza cancellata a fine guida |
| Tecnico esperto, modalità tecnica | passaggio da “Le mie preferenze” solo da tastiera, apertura diretta della route; impronte visibili, nessuna guida passo-passo; Previsioni con nome e revisione del modello, 4 modelli, WQL, impronta e 21 quantili già aperti |
| Demo senza registrazione | demo urbana e agricola senza accesso, valori SIMULATI dichiarati, nessuna richiesta a Supabase o Open-Meteo |
| Smartphone (375 px) | nessuno scorrimento orizzontale; sintesi leggibile. **Difetto trovato e corretto**: fascia di variazione dell’umidità del suolo “tra 0,15 e 0,15 m³/m³” per arrotondamento (commit `fix(previsioni)`, con test che fallisce senza la correzione) |
| Tastiera | focus visibile (contorno 2,4 px), ordine: domanda → risposta scelta → Indietro → Continua; dettagli apribili con Invio |
| Zoom al 200% (512 px CSS) | nessuno scorrimento orizzontale e nessun testo sovrapposto nel Lab agricolo e nelle Previsioni, con sezioni chiuse e con tutte le sezioni aperte (controllo degli elementi visibili) |
| Console | nessun errore |
| Chiarezza del prossimo passo | presente in tutte le pagine del percorso; nel Lab anche quando le attività sono completate (lacuna trovata dagli E2E e corretta) |

## 10. Rischi residui

Vedi `07-backlog.md` (B-154 … B-158): più pulsanti primari nel Decision Lab urbano, guida “passo n di 7” non ancora estesa a Foto e documenti e alle pagine informative, soglie del pannello meteo dimostrative e fisse, annunci del grafico ancora tecnici per gli screen reader, validazione con utenti reali non ancora svolta (i test sono automatici).
