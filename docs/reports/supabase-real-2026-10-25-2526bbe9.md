# Verifica Supabase reale — 2026-10-25

- Ambiente: progetto di TEST su `****.supabase.co` (riferimento oscurato)
- Esecuzione: 2526bbe9, 2026-10-25T07:51:10.966Z → 2026-10-25T07:51:27.811Z
- Esito: 25 superati, 0 falliti, 19 non eseguiti
- Pulizia dei dati di prova: riuscita (ogni eliminazione verificata)

| ID | Controllo | Esito | Evidenza |
|---|---|---|---|
| S1 | Utenti di prova: registrazione e login email/password | ✔ | 4 utenti, profili creati dal trigger |
| S2 | Organizzazioni e ruoli | ✔ | admin, editor, viewer in A; esterno in B |
| S2b | Nessuna auto-promozione (memberships, users.app_role) | ✔ | rifiutato |
| S3 | Ruolo lettura: salvataggio rifiutato dal server | ✔ | editor 200, viewer 42501 |
| S4 | Isolamento: l’esterno non vede progetti né documenti | ✔ | 0 righe |
| S5 | Concorrenza: il secondo salvataggio riceve conflitto | ✔ | HTTP 409 PT409 in 139 ms, dati invariati (versione 2) |
| S6 | Baseline immutabile | ✔ | rifiutata dal trigger |
| S7 | Link condiviso: creazione, lettura anonima, revoca, scadenza | ✔ | revoca e scadenza efficaci |
| M1 | Upload privato, validazione server, URL firmato reale, EXIF/GPS assenti nel file scaricato | non eseguito | richiede la Edge Function media-gateway (non pubblicata) |
| M2 | Upload diretto senza scheda: rifiutato dallo storage | non eseguito | richiede la Edge Function media-gateway (non pubblicata) |
| M3 | Ruolo lettura: scheda e upload via API rifiutati | non eseguito | richiede la Edge Function media-gateway (non pubblicata) |
| M4 | Consultazione registrata nell’audit prima della firma | non eseguito | richiede la Edge Function media-gateway (non pubblicata) |
| M4b | Il client non firma direttamente | non eseguito | richiede la Edge Function media-gateway (non pubblicata) |
| M5 | URL firmato scaduto dopo 60 s | non eseguito | eseguire con --slow |
| M8 | Altra organizzazione: niente firma né lettura | non eseguito | richiede la Edge Function media-gateway (non pubblicata) |
| M11 | Validazione server: PDF dichiarato come JPEG rifiutato e rimosso | non eseguito | richiede la Edge Function media-gateway (non pubblicata) |
| M11b | Validazione server: client che salta la rimozione EXIF rifiutato | non eseguito | richiede la Edge Function media-gateway (non pubblicata) |
| M10 | Limite di dimensione dell’organizzazione | non eseguito | richiede la Edge Function media-gateway (non pubblicata) |
| M6 | Eliminazione amministrativa: oggetto rimosso e link non più valido | non eseguito | richiede la Edge Function media-gateway (non pubblicata) |
| M9 | Revoca dell’utente: nuove firme rifiutate subito | non eseguito | richiede la Edge Function media-gateway (non pubblicata) |
| M13 | Progetto con file non eliminabile | non eseguito | richiede la Edge Function media-gateway (non pubblicata) |
| A1 | Audit leggibile solo dagli amministratori | ✔ | 12 righe per l’admin, 0 per l’editor |
| R1 | Limitazione di frequenza su login errati (osservazione) | ✔ | codici: 400, 400, 400, 400, 400, 400 (429 = limite attivo; i limiti dipendono dalla configurazione del progetto) |
| F1 | Previsioni: l’editor registra una baseline con 21 quantili | ✔ | esecuzione, serie e 21 quantili registrati |
| F2 | Previsioni: un client non registra un’esecuzione Timestral | ✔ | Le esecuzioni Timestral sono registrate solo dal servizio di previsione. |
| F3 | Previsioni: il ruolo di servizio registra un’esecuzione Timestral | ✔ | accettata |
| F4 | Previsioni: esecuzione conclusa immutabile | ✔ | Esecuzione già conclusa: non modificabile. |
| F5 | Previsioni: isolamento tra organizzazioni | ✔ | 0 righe |
| F6 | Previsioni: soglie versionate | ✔ | Le soglie sono versionate: crea una nuova soglia invece di modificarla. |
| F7 | Previsioni: avviso con verifica ex-post | ✔ | probabilità bloccata, ex-post registrato |
| F8 | Previsioni: audit visibile solo all’admin | ✔ | 6 righe per l’admin, 0 per il viewer |
| W1 | Meteo: località creata dall’editor, letta dal viewer, invisibile all’esterno | ✔ | RLS rispettata |
| W2 | Meteo: nessun client si spaccia per Open-Meteo | ✔ | rifiutato |
| W3 | Meteo: funzioni di registrazione riservate al service role | ✔ | permission denied for function weather_begin_fetch |
| W4 | Meteo: aggiornamento manuale via Edge Function | non eseguito | funzione open-meteo-ingest non pubblicata o non raggiungibile (stato 404) |
| W5 | Meteo: limite di frequenza dell’aggiornamento manuale | non eseguito | richiede la funzione pubblicata |
| W6 | Meteo: job pg_cron ogni 3 ore | non eseguito | manuale: verificare cron.job_run_details e una nuova emissione dopo 3 ore (docs/16) |
| L1 | Ultimo amministratore: rimozione negata in un’organizzazione esistente | ✔ | Ogni organizzazione deve avere almeno un amministratore. |
| L2 | Eliminazione completa di un’organizzazione temporanea (amministratore, conferma del nome) | ✔ | eliminata; riepilogo {"membri":1,"progetti":0,"localita_meteo":0,"esecuzioni_previsione":0} |
| L3 | Cancellazione di un utente proprietario di un progetto: progetto conservato, owner_id NULL | ✔ | progetto conservato con owner_id NULL; profilo eliminato |
| L4 | L’unico amministratore di un’organizzazione esistente non può essere cancellato | ✔ | Unexpected failure, please check server logs for more information |
| M12 | Offline su smartphone e sincronizzazione | non eseguito | manuale (docs/14) |
| M14 | Pulizia a fine conservazione pianificata | non eseguito | manuale: richiede pg_cron e segreto (docs/13) |
| S8 | Magic link via email | non eseguito | manuale: verificare la ricezione della mail di test |

Nessuna credenziale è riportata in questo file. Le password di prova sono casuali e non vengono salvate.
