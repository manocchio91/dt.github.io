# 14 — Piano di test su un progetto Supabase reale

Obiettivo: confermare su Supabase reale (Auth, PostgREST, Storage API) ciò che finora è verificato su PostgreSQL/PostGIS in PGlite e su un backend simulato. Fino al completamento **F22 e F26 restano Beta**.

## Preparazione

1. Due progetti Supabase separati: **staging** (test) e, in seguito, produzione. Regione UE (D1).
2. Applicare in ordine `supabase/migrations/*.sql` (CLI: `npx supabase link --project-ref <ref>` poi `npx supabase db push`), quindi `supabase/seed/demo_seed.sql`.
3. Verificare che il bucket `project-media` risulti privato, con limite 20 MB e tipi ammessi.
4. Auth: abilitare email/password e link via email; impostare gli URL di redirect su staging.
5. Creare utenti di prova **dedicati** (mai credenziali personali): `admin-a`, `editor-a`, `viewer-a`, `admin-b`; due organizzazioni A e B.
6. Configurare `.env.local` con URL e anon key di staging. La service role key resta solo nella dashboard/CLI.

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

## Criteri di uscita

- Tutti i casi con esito atteso e evidenza archiviata.
- Nessuna differenza di comportamento rispetto ai test PGlite; ogni differenza diventa un test automatico aggiuntivo.
- Solo allora F22 (Media) e F26 (Account) possono passare da Beta a Operativa nella matrice.

## Dopo il test

- Ripetere `npm run e2e` puntando a staging con utenti di prova (configurazione separata, mai in CI pubblica).
- Valutare Edge Function per firma URL obbligatoria con audit e verifica dei byte (B-124) e job di pulizia a fine conservazione (B-125).
