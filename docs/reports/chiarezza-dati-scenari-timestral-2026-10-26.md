# Chiarezza dati, scenari e Timestral

Data: 26 ottobre 2026  
Branch: `feat/chiarezza-dati-scenari-timestral`  
Base verificata: `091ef83c676c3201b93a5f522f61223f9e4d2090`

## Esito

Il percorso guidato distingue ora in modo esplicito:

1. **SITUAZIONE ATTUALE**: dati Open-Meteo aggiornati dell'area;
2. **PERIODO STORICO DI RIFERIMENTO**: intervallo usato per confrontare gli scenari, dichiarato come diverso dal meteo di oggi;
3. **SIMULAZIONE DEGLI INTERVENTI**: effetti illustrativi di alberi, superfici e nebulizzazione.

Nessuna pagina o voce di menu è stata aggiunta. Algoritmi, coefficienti, backend, Supabase, migrazioni, Edge Function, cron, forecast-proxy, autenticazione, ruoli e guida iniziale in sei domande non sono stati modificati.

## Testi modificati

- Il banner generico DEMO è diventato: “SCENARI DIMOSTRATIVI — gli effetti degli interventi sono simulati.”
- Il pannello meteo è “SITUAZIONE ATTUALE” e spiega: “Dati meteorologici aggiornati relativi all’area.”
- La scelta del periodo chiede: “Quale periodo vuoi usare per confrontare gli interventi?” e suggerisce un mese estivo caldo.
- La baseline in primo piano è “PERIODO STORICO DI RIFERIMENTO” con periodo, orario, fonte e valore medio principale.
- La simulazione dichiara sempre natura comparativa, illustrativa e non valida come atto tecnico.
- I casi storici nella pagina Previsioni usano “ore successive nel caso dimostrativo” e una data esplicita; “prossime ore” resta riservato ai dati correnti.
- Lo storico sufficiente espone “Previsione avanzata disponibile.” e il collegamento “Apri le previsioni”.
- Timestral è nominato nell’opzione soltanto quando il proxy è configurato per un progetto collegato; l’esecuzione richiede il clic esplicito su “Avvia Timestral-5M”.

## Elementi spostati nei dettagli

- Versione del periodo storico, impronta, integrità, derivazione, QA e tabella completa delle variabili.
- Coordinate della cella, griglia, celle e relativa visualizzazione.
- Parametri avanzati degli interventi, inclusi raggi, portate, orari, giorni e coefficienti.
- Intervalli completi, temperatura superficiale, comfort termico, massimi per cella, modello illustrativo e spiegazione matematica.
- Emissione, quantili, backtest, modello, revisione, licenza, input e vincoli fisici della previsione.

Tutti questi elementi restano accessibili in “Approfondimento tecnico”, “Dettagli della fonte”, “Modifica parametri” o “Fonti e metodo”.

## Elementi eliminati perché duplicati

- Il riepilogo “situazione attuale” derivato dalla baseline storica, che confondeva agosto 2025 con il meteo corrente.
- Le tre schede separate degli indicatori storici, già presenti nella tabella tecnica.
- La legenda completa delle fonti ripetuta in primo piano; resta disponibile in “Fonti e metodo”.
- La soglia dimostrativa dal riepilogo meteo essenziale; resta nel percorso specialistico.
- Le numerose schede “Dato mancante”, sostituite da un solo messaggio con dettaglio apribile.

## Risultati semplificati

- Una frase sintetica descrive la possibile riduzione della temperatura dell’aria rispetto al periodo storico.
- Sono mostrati al massimo tre risultati principali.
- I dati mancanti sono raggruppati in un unico avviso “Vedi dati mancanti”.
- Gli interventi mostrano inizialmente quantità semplici, per esempio “12 alberi”; i parametri sono chiusi.

## Timestral e fonti

- Open-Meteo resta classificato come `DATO OPEN-METEO`, mai come misura locale o simulazione.
- I sensori restano `MISURATO DA SENSORE`.
- Un risultato Timestral reale è `STIMATO DA MODELLO — Timestral-5M`.
- Gli interventi restano `SIMULATO`; l’assenza di un valore resta `DATO MANCANTE`.
- Timestral non parte alla selezione: serve un’azione esplicita.
- Con servizio non raggiungibile compare il fallback richiesto e la previsione di base resta utilizzabile.
- Nessun risultato Timestral simulato è mostrato dall’applicazione. Le prove E2E usano esclusivamente un doppio di test dichiarato.

## Audit Anno Luce preservato

- Provenienza e timestamp.
- Versioni, revisione e impronte.
- Incertezza e intervalli.
- Separazione tra reale, modellato, simulato e mancante.
- Limiti e avvertenze.
- Storico delle decisioni e verifica ex-post.
- Dettagli di qualità e integrità.

## Verifiche

- Lint: superato.
- Typecheck: superato.
- Build standard, E2E e Pages: superate.
- Vitest: 460/460 test superati.
- Playwright: tutti i 77 casi sostanziali superati nella suite completa e nelle riesecuzioni mirate; le quattro catture opzionali sono passate separatamente.
- Responsive: 320, 375 e 390 px senza scorrimento orizzontale.
- Zoom 200%, tastiera e semantica accessibile automatizzata: superati.
- Timestral disponibile, servizio spento e fallback: superati.
- Guida iniziale in sei domande: invariata e superata.
- Scansione segreti: nessuna chiave segreta nei bundle standard, E2E e Pages; nessun pattern segreto nei file modificati.

Il processo padre Playwright continua a non terminare autonomamente dopo il teardown nell’ambiente locale. I singoli casi concludono e riportano l’esito prima del timeout; il problema del runner resta separato dalle asserzioni.

## Evidenze prima/dopo

- Prima: [`docs/ux/schermate/finale`](../ux/schermate/finale).
- Dopo: [`docs/ux/schermate/chiarezza`](../ux/schermate/chiarezza).

Le evidenze dopo includono situazione attuale, scelta e riepilogo del periodo storico, sintesi scenario, risultati, Timestral disponibile e Timestral spento, in formato desktop e smartphone.

## Problemi ancora aperti

- Sessione manuale con screen reader reale, oltre alle verifiche semantiche e da tastiera.
- Correzione separata dell’hang di teardown Playwright.
- Test di comprensione con tecnici comunali e agricoltori/viticoltori reali.

## Vincolo di consegna

Nessun merge in `master` e nessuna modifica al sito pubblico. Il lavoro si ferma sul branch dedicato in attesa di autorizzazione.
