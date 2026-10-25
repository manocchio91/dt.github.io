# 17 — Conflitti di salvataggio, eliminazione di organizzazioni e utenti (migrazione 0010)

Regola permanente: **complessità tecnica dietro le quinte, semplicità davanti all'utente.**
Le tre correzioni sono quasi tutte nel database; l'unica parte visibile è l'avviso di conflitto.

## 1. Conflitto di salvataggio

| Voce | Contenuto |
| --- | --- |
| Bisogno dell'utente | Due tecnici lavorano sullo stesso progetto: nessuno deve perdere o sovrascrivere il lavoro dell'altro, e chi salva deve capire subito cosa fare. |
| Requisito Audit Anno Luce | F26 (account, organizzazioni, concorrenza), F21 (tracciabilità), F18 (decisione registrata senza perdite). |
| Percorso guidato | Un solo messaggio: “Questo progetto è stato aggiornato da un’altra persona. Ricarica i dati prima di salvare nuovamente.” Azione principale **Ricarica progetto**, secondaria **Annulla**. Nessun codice tecnico, nessun nuovo menu o passaggio. |
| Modalità tecnica | “Dettagli tecnici” (chiusi): data dell’ultima versione salvata, versione attesa, versione trovata, codice `MDT_CONFLITTO_VERSIONE`. |
| Senza connessione o servizio | In modalità locale (browser) il conflitto non può verificarsi; se il server non risponde compare l’errore di salvataggio ordinario e i dati restano nel progetto aperto. |
| Validazione con utenti | Due persone modificano lo stesso progetto: chi riceve l’avviso deve ricaricare senza istruzioni e ritrovare il lavoro dell’altra persona; nessuno deve credere di aver salvato. |

Tecnica: `save_project` segnala il conflitto con SQLSTATE **PT409**. PostgREST lo traduce in **HTTP 409** immediato
(prima: 40001 = errore di serializzazione, ritentato fino al timeout con HTTP 504). Dettagli JSON (`versione_attesa`,
`versione_trovata`, `aggiornato_il`) e hint stabile `MDT_CONFLITTO_VERSIONE`; nessun dettaglio interno del database.
Un'organizzazione diversa riceve lo stesso conflitto senza versione né data (nessuna informazione sul progetto altrui).
Il client non ritenta e non salva automaticamente.

## 2. Ultimo amministratore ed eliminazione dell'organizzazione

| Voce | Contenuto |
| --- | --- |
| Bisogno | Un'organizzazione attiva non deve mai restare senza chi la gestisce; un'organizzazione chiusa deve poter essere eliminata davvero. |
| Requisito Audit | F26, privacy e conservazione (cancellazione completa dei dati di un ente che non usa più il servizio), audit minimo. |
| Percorso guidato | **Nessun cambiamento.** L'eliminazione non è nel percorso ordinario: è una funzione amministrativa. Oggi è disponibile solo come funzione del server (`delete_organization`); un'interfaccia nelle impostazioni amministrative è nel backlog (B-151). |
| Modalità tecnica | `delete_organization(organizzazione, nome)`: solo amministratore o servizio; conferma esplicita con il nome esatto; si ferma se esistono file (vanno rimossi dal gateway, che elimina anche gli oggetti nello storage); restituisce il riepilogo di ciò che è stato eliminato. |
| Senza servizio | Non applicabile (operazione solo sul server). |
| Validazione | Amministratore: elimina un'organizzazione di prova con la conferma; un editor o un lettore non riescono; un'organizzazione attiva non resta mai senza amministratore. |

Tecnica: il controllo “almeno un amministratore” è un **constraint trigger DEFERRABLE INITIALLY DEFERRED**: a fine
transazione verifica solo le organizzazioni **ancora esistenti**. Rimozione o declassamento dell’ultimo amministratore:
negati. Eliminazione dell’intera organizzazione: la cascata su membri, progetti, documenti, link, previsioni, meteo
procede. `audit_logs.organization_id` passa a `ON DELETE SET NULL`; le righe scritte durante la cascata perdono il legame
e conservano solo `organizzazione_eliminata` (identificativo, nessun dato personale). Nessun trigger disattivato.

## 3. Cancellazione dell'utente

| Voce | Contenuto |
| --- | --- |
| Bisogno | Una persona che lascia l'ente deve poter essere cancellata; i progetti dell'ente restano all'ente. |
| Requisito Audit | Privacy (diritto alla cancellazione), F21 (tracciabilità con dati minimi), F26. |
| Percorso guidato | Nessun cambiamento. Il proprietario di un progetto non è mostrato nell'interfaccia attuale; se verrà mostrato, `owner_id` nullo si presenterà come “Utente eliminato” (B-152). |
| Modalità tecnica | Riferimenti personali a nulla, risorse conservate; nessun trasferimento automatico di proprietà. |
| Senza servizio | Non applicabile (Supabase Auth Admin). |
| Validazione | Cancellare un utente proprietario di progetti: i progetti restano visibili ai colleghi; nessun dato personale dell'utente resta nelle tabelle dell'app. |

Riferimenti analizzati: tutti passano da `public.users` (copia di `auth.users`, `ON DELETE CASCADE`).

| Riferimento | Prima | Dopo |
| --- | --- | --- |
| `memberships.user_id`, `user_preferences.user_id` | CASCADE | invariato (eliminati con l'utente) |
| `weather_fetch_runs.requested_by`, `weather_observations.created_by` | SET NULL | invariato |
| `projects.owner_id`, `projects.updated_by`, `project_documents.updated_by`, `areas.owner_id`, `decisions.author_id`, `approval_events.actor_id`, `audit_logs.actor_id`, `shared_links.created_by` / `revoked_by`, `forecast_runs.started_by`, `forecast_alerts.reviewed_by`, `forecast_backtests.executed_by` | NO ACTION (bloccava) | **SET NULL** |
| `forecast_thresholds.set_by`, `media_assets.uploaded_by` | NO ACTION, NOT NULL | **SET NULL**, facoltativi |

Le guardie di immutabilità (documento di progetto, file, esecuzioni e soglie di previsione, dati meteo) restano attive:
il trigger di modifica le salta **solo** se l'unica differenza è l'azzeramento di riferimenti a utenti che non esistono
più (eseguito dal database durante la cancellazione). Un client non può azzerare il riferimento di un utente esistente.
L'unico amministratore di un'organizzazione esistente non può essere cancellato (prima va nominato un altro amministratore
o eliminata l'organizzazione).

## Verifica su Supabase reale (25/10/2026)

S5: HTTP 409 `PT409` in 139 ms, dati invariati. L1–L4 superati. Report: `docs/reports/supabase-0010-2026-10-25.md`.
