# 14 — Piano di test su un progetto Supabase reale

Obiettivo: confermare su Supabase reale (Auth, PostgREST, Storage API) ciò che finora è verificato su PostgreSQL/PostGIS in PGlite e su un backend simulato. Fino al completamento **F22 e F26 restano Beta**.

## Preparazione

1. Due progetti Supabase separati: **staging** (test) e, in seguito, produzione. Regione UE (D1).
2. Applicare in ordine `supabase/migrations/*.sql` (CLI: `npx supabase link --project-ref <ref>` poi `npx supabase db push`), quindi `supabase/seed/demo_seed.sql`.
3. Verificare che il bucket `project-media` risulti privato, con limite 20 MB e tipi ammessi.
4. Auth: abilitare email/password e link via email; impostare gli URL di redirect su staging.
5. Creare utenti di prova **dedicati** (mai credenziali personali): `admin-a`, `editor-a`, `viewer-a`, `admin-b`; due organizzazioni A e B.
6. Configurare `.env.local` con URL e anon key di staging. La service role key resta solo nella dashboard/CLI.

## Esecuzione automatica

Lo script `scripts/supabase-real/verify.mjs` esegue contro Auth, PostgREST, Storage ed Edge Functions **reali** i controlli S1–S7, M1–M13, A1 e un'osservazione dei limiti di frequenza (R1), poi ripulisce i dati di prova e scrive un report senza credenziali in `docs/reports/`.

1. Crea un file locale `.env.supabase-test` (già escluso da Git) con `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` e `MDT_CONFIRM_TEST_PROJECT=yes`. Non incollare questi valori in chat o in altri file.
2. Collega il progetto e pubblica le funzioni: `npx supabase link --project-ref <ref>`, poi `npx supabase functions deploy media-gateway` e `npx supabase functions deploy media-retention`.
3. Esegui: `node --env-file=.env.supabase-test scripts/supabase-real/verify.mjs` (aggiungi `--slow` per attendere la scadenza reale degli URL, `--keep` per conservare i dati di prova).
4. Archivia il report generato; i casi "non eseguito" (M12 offline, M14 pianificazione, S8 magic link) restano manuali.

Le password degli utenti di prova sono casuali, non vengono stampate né salvate; nel report il riferimento del progetto è oscurato.

## Casi di prova (manuali, con evidenza: screenshot, risposta HTTP, riga di audit)

| # | Caso | Atteso | Esito |
|---|---|---|---|
| S1 | Registrazione e conferma email | profilo in `public.users` | |
| S2 | Creazione organizzazione e aggiunta membri | ruoli corretti in `memberships` | |
| S3 | Viewer A salva un progetto (UI) | comandi nascosti; chiamata diretta `rpc/save_project` → 42501 | |
| S4 | Utente B legge progetti di A (REST con il proprio token) | 0 righe | |
| S5 | Concorrenza: due browser editor sullo stesso progetto | il secondo riceve conflitto | |
| S6 | Modifica di una baseline salvata via REST | rifiutata dal trigger | |
| S7 | Link condiviso: creazione, apertura anonima, revoca, scadenza | revoca e scadenza rendono il link inutilizzabile | |
| M1 | Editor A carica una foto con GPS da smartphone (fotocamera) | upload a fasi; oggetto in `{org}/{progetto}/{uuid}.jpg`; scaricandolo, nessun EXIF (verifica con `exiftool`) | |
| M2 | Upload diretto su Storage API senza scheda | 403 (policy) | |
| M3 | Viewer A: `POST /rest/v1/media_assets` e `POST /storage/v1/object/...` | 403 | |
| M4 | Viewer A apre un file | riga `consultazione` in `audit_logs`; URL firmato funziona | |
| M5 | URL firmato dopo 60 s | rifiutato (scaduto) | |
| M6 | Admin elimina un file; riuso del vecchio URL | 404/400; nessun oggetto residuo nello storage; audit senza nome/descrizione | |
| M7 | Simulare errore storage (es. revocare temporaneamente la policy delete) | file in “eliminazione incompleta”, ripresa riuscita | |
| M8 | Utente B tenta `createSignedUrl` su un percorso di A | rifiutato | |
| M9 | Rimozione di un membro durante la sessione | nuove firme rifiutate subito; URL già emesso valido ≤ 60 s (limite dichiarato) | |
| M10 | File oltre `media_max_bytes` dell’organizzazione | rifiutato dal database; oltre 20 MB rifiutato dal bucket | |
| M11 | MIME falso (PDF rinominato .jpg) inviato aggirando la UI | il server accetta solo tipi ammessi dichiarati; byte non verificati → conferma del limite B-124 | |
| M12 | Offline su smartphone, poi rete | file “non sincronizzato”, sincronizzazione solo dopo conferma | |
| M13 | Eliminazione di un progetto con file | bloccata finché i file esistono | |
| M14 | `media_due_for_deletion` con file scaduto (data forzata da SQL editor) | elencato solo agli admin | |

## Casi F31 — previsioni (migrazione 20261024000006)

| # | Caso | Atteso | Esito |
|---|---|---|---|
| F1 | Editor registra un’esecuzione baseline con serie e 21 quantili | accettata; `started_by` = utente | |
| F2 | Editor prova a registrare un’esecuzione Timestral | rifiutata: “solo dal servizio di previsione” | |
| F3 | Ruolo di servizio registra un’esecuzione Timestral | accettata | |
| F4 | Modifica di lineage o output dopo la conclusione | rifiutata | |
| F5 | Utente di altra organizzazione legge esecuzioni/quantili | zero righe | |
| F6 | Modifica di una soglia esistente | rifiutata; nuova versione + `superseded_by` | |
| F7 | Avviso: modifica probabilità vs registrazione ex-post | rifiutata vs accettata con `reviewed_by` | |
| F8 | Audit `forecast_*` | visibile all’admin, non al viewer | |

## Criteri di uscita

- Tutti i casi con esito atteso e evidenza archiviata.
- Nessuna differenza di comportamento rispetto ai test PGlite; ogni differenza diventa un test automatico aggiuntivo.
- Solo allora F22 (Media) e F26 (Account) possono passare da Beta a Operativa nella matrice.

## Dopo il test

- Ripetere `npm run e2e` puntando a staging con utenti di prova (configurazione separata, mai in CI pubblica).
- Valutare Edge Function per firma URL obbligatoria con audit e verifica dei byte (B-124) e job di pulizia a fine conservazione (B-125).
