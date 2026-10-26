# Controllo finale pre-merge — 26 ottobre 2026

## Esito

**Non pronto per il merge in `master`.** I branch remoti e le suite locali sono stati
verificati, ma tre controlli che richiedono l'ambiente reale restano aperti: limite
manuale sullo staging, prova con screen reader reale e prova finale urbana/agricola
sullo staging. Nessun merge è stato eseguito e nessuna migrazione è stata applicata.

## Stato verificato dei branch

| Riferimento | Commit verificato |
| --- | --- |
| `origin/master` | `95e7bf6f1190cbe673b7958f07e1797dd6e41134` |
| `origin/feat/open-meteo-seven-days` | `de086929f3368af90c8d1f6a085f569d7370f5a6` |
| `origin/feat/open-meteo-seven-days-timestral` | `eeb3d6e95a04b0e7e5ac97d4fec6b58ce8562623` |
| `origin/feat/timestral-docker-real` | `57bd62fdf08651b1156084018d0adb665fd29746` |

`feat/open-meteo-seven-days` è antenato del branch di integrazione Timestral. Il
controllo è stato svolto su checkout locali traccianti i branch remoti; `master` non
è stato modificato.

## Controlli eseguiti

### Solo `feat/open-meteo-seven-days`

- lint: superato;
- typecheck: superato;
- build di produzione: superata;
- Vitest: **421/421** test superati;
- Playwright: tutti i **58** casi sono arrivati a conclusione (**56 superati, 2
  acquisizioni visive saltate intenzionalmente**). Il processo non ha terminato il
  teardown ed è scaduto dopo 10 minuti: i casi sono verdi, ma il comando complessivo
  non può essere registrato come verde finché l'anomalia di chiusura non è riprodotta
  o esclusa in CI.

### `feat/open-meteo-seven-days-timestral`

- lint: superato;
- typecheck: superato;
- build di produzione: superata;
- Vitest: **460/460** test superati;
- Docker non raggiungibile durante la prova; in questa condizione i test confermano
  che l'app mostra un messaggio semplice e usa la previsione di base, senza inventare
  un risultato Timestral;
- il browser controllabile e Python non erano disponibili in questa sessione, quindi
  non sono state ripetute la prova manuale con screen reader e la suite Python.

L'installazione bloccata da `package-lock.json` ha segnalato 4 advisory npm (1
moderato, 3 critici). Il dettaglio non è stato recuperabile dall'endpoint audit in
questa sessione; non è stato applicato `npm audit fix`.

## Controlli reali ancora aperti

| Controllo | Stato | Condizione di chiusura |
| --- | --- | --- |
| Limite manuale di 10 minuti | **Aperto sul reale** | Con un editor e una località temporanea sullo staging, prima richiesta `200`, seconda immediata `429`, evidenza della risposta e successiva pulizia. Il test locale corrispondente passa. |
| Screen reader | **Aperto** | Eseguire almeno NVDA + Edge/Firefox su onboarding, pannello meteo, previsioni, grafico e tabella; registrare ordine di lettura, nomi accessibili, annunci dinamici e blocchi. |
| App/sito senza Docker | **Superato nel codice e nei test; prova manuale reale ancora consigliata** | Il fallback automatico è coperto dai test. Ripetere sul sito/staging con servizio Timestral spento per raccogliere evidenza visiva. |
| Prova urbana e agricola finale | **Aperto sul reale** | Creare una località per ambito, verificare almeno 168 ore complete, provenienza, lacune, fallback senza Docker e poi rimuovere tutti i dati temporanei. |

Le prove sullo staging non sono state avviate perché l'ambiente non esponeva URL e
credenziali Supabase. Questo evita sia modifiche non autorizzate sia una nuova
applicazione accidentale delle migrazioni 0012–0013.

## Valutazione B-176, B-177 e B-178

### B-176 — volume del registro di audit: rischio alto, da correggere prima della scala

Il trigger `audit_weather_obs` è `FOR EACH ROW`: ogni inserimento o aggiornamento di
`weather_observations` crea una riga in `audit_logs`. Con 9 variabili urbane e circa
20 agricole, il recupero iniziale di 168 ore genera circa 1.512 o 3.360 righe di audit
per località; a regime sono circa 78.840 o 175.200 righe/anno per località, senza
contare aggiornamenti e altri eventi.

Raccomandazione: conservare l'audit di `weather_fetch_runs` come evidenza per
acquisizione e rimuovere l'audit riga-per-riga dei dati Open-Meteo; mantenere invece
un audit puntuale per osservazioni manuali/sensore e una metrica aggregata (righe,
intervallo temporale, variabili, hash/run). Definire retention e monitoraggio della
dimensione prima di aggiungere molte località.

### B-177 — `HF_HOME` nello stage test: rischio medio, difetto confermato

Il Dockerfile imposta `HF_HOME=/models` soltanto nello stage `runtime`; lo stage
`test` eredita da `build` e non lo imposta. Di conseguenza il test del modello reale
può non trovare il volume montato in `/models`, pur funzionando nel container di
esercizio/runtime.

Raccomandazione: impostare `HF_HOME=/models` anche nello stage `test`, creare la
directory con permessi coerenti e aggiungere alla documentazione il comando esatto
di build/run del test reale con cache montata e modalità offline. Verificare sia
cache calda sia assenza dichiarata dei pesi.

### B-178 — probabilità di precipitazione storica: rischio medio e degradazione sicura

`precipitation_probability` è richiesta, validata tra 0 e 100 e salvata quando
presente, ma non fa parte delle variabili obbligatorie né del calcolo di completezza.
La verifica dello storico la esclude esplicitamente dall'insieme richiesto. Questo è
coerente con la regola di non stimare valori mancanti e impedisce che l'intero storico
diventi inutilizzabile se il provider non restituisce la probabilità.

Raccomandazione: mantenere il comportamento facoltativo, mostrare sempre
“probabilità non disponibile” quando manca e monitorare la percentuale di ore
disponibili per modello/cella. Non usare la variabile come requisito Timestral finché
la disponibilità non è misurata e garantita per i modelli effettivamente selezionati.

## Decisione pre-merge

Non effettuare il merge. Chiudere prima i tre controlli reali aperti, chiarire il
teardown Playwright e riesaminare almeno B-176 e B-177. Timestral deve restare
presentato come modello sperimentale di supporto, non validato scientificamente e
mai prescrittivo.
