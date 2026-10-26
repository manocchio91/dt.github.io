# Matrice prima delle modifiche — revisione finale UX

Data: 26 ottobre 2026  
Branch di partenza: `feat/open-meteo-seven-days-timestral`  
Branch di lavoro: `feat/semplificazione-finale-ux`

Questa matrice fotografa l'interfaccia prima delle modifiche finali. La valutazione
usa la regola «complessità tecnica dietro le quinte, semplicità davanti all'utente»
e distingue il percorso del tecnico comunale da quello dell'agricoltore/viticoltore.

| Schermata | Informazione attuale | Utilità per l'utente | Decisione | Motivazione collegata al bisogno |
| --- | --- | --- | --- | --- |
| Home | Scopo, due percorsi, accesso alla guida e alle demo | Alta per iniziare senza formazione | Mantenere | L'utente sceglie subito città o campagna; la guida resta l'azione principale |
| Guida iniziale | Sei domande, avanzamento, salvataggio e ripresa | Essenziale | Mantenere integralmente | Traduce il profilo e il bisogno in un percorso senza assegnare permessi |
| Progetti | Archivio, creazione, demo, importazione e schede dei progetti | Alta, ma le CTA delle singole schede competono con “Crea progetto” | Semplificare | Deve essere evidente se si crea un progetto o se ne apre uno esistente |
| Area/parcella | Confini, mappa, inserimento accessibile, verifica geometrica e sottozone | Essenziale per il calcolo | Semplificare le CTA; spostare coordinate e controlli specialistici nei dettagli quando non servono | Il confine è necessario, ma CRS, vertici e coordinate non aiutano la decisione quotidiana |
| Decision Lab urbano | Area, meteo, baseline, indicatori, scenari, interventi, calcolo e confronto | Tutto necessario nel flusso, ma manca una sintesi unica e sono presenti più pulsanti primari | Semplificare; aggiungere sintesi decisionale e ridurre il peso delle azioni intermedie | Il tecnico deve capire prima stato, parametro, fonte, aggiornamento, zone da verificare e prossimo passo |
| Decision Lab agricolo | Prima zona, parcella, input agronomici, fenologia, meteo, osservazioni, componenti, decisione ed esito | Necessario, ma disperso in nove sezioni e più CTA primarie | Semplificare; unificare la sintesi e ridurre il peso delle azioni intermedie | L'agricoltore deve vedere subito parcella, stato, parametro, fase, soglia e controllo in campo |
| Meteo | Stato, valore essenziale, aggiornamento, fonte; modello/cella/ore nei dettagli | Alta | Mantenere; uniformare il nome “Approfondimento tecnico” | La sintesi è già orientata alla decisione e conserva la provenienza |
| Previsioni | Sintesi, orizzonte, soglia, probabilità, fonte, grafico; quantili, hash, revisione e metriche nei dettagli | Alta | Semplificare ancora i messaggi di indisponibilità; mantenere i dettagli chiusi | L'utente deve sapere cosa può accadere e cosa verificare, non come gira il modello |
| Confronto e decisione | Scenari, tabella, incertezza, mappe, motivazione, registro ed export | Alta per il tecnico comunale | Mantenere la decisione come unica azione primaria; spostare spiegazioni tecniche ripetute | Serve confrontare alternative senza confondere stima e prescrizione |
| Verifica ex-post | Piano, importazione osservazioni, previsto/osservato | Essenziale per responsabilità e Audit | Mantenere; linguaggio semplice | Chi decide deve poter verificare l'esito senza perdere la tracciabilità |
| Foto e documenti | Caricamento in fasi, metadati, coordinate facoltative, privacy, archivio | Alta come evidenza, ma il percorso guidato non indica posizione e prossimo passo | Semplificare le CTA e aggiungere orientamento | L'utente deve capire quale file sta allegando e a cosa, senza dettagli storage nel percorso |
| Accesso e organizzazione | Login, account, organizzazione, ruoli, membri e conservazione | Necessario per collaborazione e sicurezza | Mantenere; eliminare descrizioni del database dal testo principale | I permessi devono essere chiari senza esporre l'implementazione |
| Vista condivisa | Progetto in sola lettura, baseline, risultati e decisioni | Alta per revisori | Mantenere | Consente verifica senza permettere modifiche |
| Fonti e metodo | Classi di dato, connettori, modelli, parametri | Utile a esperti e audit, non nel percorso decisionale | Mantenere come approfondimento separato già esistente | Conserva provenienza, versioni e limiti senza appesantire i Lab |
| Stato funzioni | Maturità F01–F31 | Utile per trasparenza, non per decidere sul progetto | Mantenere | Evita dichiarazioni di capacità non disponibili |
| Limiti e responsabilità | Cosa fa/non fa, privacy e responsabilità | Essenziale | Mantenere e rendere conciso | Previene prescrizioni automatiche e uso improprio |

## Informazioni da proteggere nei dettagli

Non saranno eliminate: provenienza, classe del dato, data e ora, incertezza,
versione, hash e identificativi necessari alla verifica, permessi, privacy, storico
delle decisioni, confronto ex-post e limiti. Coordinate, cella meteo, nomi dei
servizi, quantili, metriche, covariate, vincoli fisici e dettagli di esecuzione
resteranno disponibili solo nell'Approfondimento tecnico o nelle pagine dedicate.
