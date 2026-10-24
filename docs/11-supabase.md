# 11 — Supabase: auth, tenant, RLS, storage (Milestone 1, passo 1)

## Cosa è stato implementato

| Area | Implementazione | Dove |
|---|---|---|
| Autenticazione | Supabase Auth: email+password, link via email (OTP), registrazione con nome visualizzato; profilo `public.users` creato da trigger su `auth.users` | `apps/web/src/state/auth.tsx`, pagina **/accesso**, migrazione 0002 |
| Tenant | Organizzazioni con membri e ruoli `viewer < editor < approver < admin`; creazione organizzazione via RPC (il creatore diventa admin); aggiunta membri per email solo da admin; ultimo admin non rimovibile | migrazione 0002 |
| RLS | Abilitata su **tutte** le tabelle di `public`; policy per organizzazione e per progetto; tabelle di riferimento in sola lettura; `audit_logs` leggibile solo dagli admin, scrivibile solo dai trigger | migrazione 0002 |
| Documento di progetto | `project_documents` (ProjectBundle) + `projects` (metadati, geometria PostGIS, superficie). Salvataggio con `save_project()`: ruolo editor, concorrenza ottimistica (versione), geometria validata con `ST_IsValid` | migrazione 0002, `supabaseRepository.ts` |
| Integrità lato server | Trigger: baseline immutabili anche dentro il documento, decisioni non modificabili con storico append-only, registro di audit append-only, versione incrementale obbligatoria | `app.guard_project_document()` |
| Link condivisi (F26) | Token casuale mostrato una volta, salvato come SHA-256; scadenza 1–90 giorni; revoca; lettura anonima in sola lettura via `get_shared_project()`; ogni accesso registrato | migrazione 0002, `SharePanel.tsx`, route **/condiviso/:token** |
| Storage | Bucket privato `project-media` (20 MB; JPEG, PNG, WebP, PDF); percorso `{org}/{progetto}/{uuid}.{ext}` verificato dalle policy; oggetti immutabili; EXIF/GPS rimossi da JPEG/PNG prima del caricamento; URL firmati temporanei | migrazione 0002, `media.ts` |
| Scelta dell’archivio | Non autenticato o senza organizzazione → IndexedDB locale; con organizzazione selezionata → Supabase. Copia dei progetti locali nell’organizzazione | `DataScope.tsx`, /accesso |

## Decisione di progetto (D9)

In M1 il progetto è salvato come **documento JSONB versionato** più una riga `projects` con i metadati e la geometria PostGIS. Le tabelle normalizzate (baselines, scenarios, outputs…) restano nello schema, con RLS, per i report e le dashboard trasversali di M2. Motivo: il dominio lavora già su `ProjectBundle` riproducibile e firmato da hash; le regole che devono essere garantite dal server (immutabilità, append-only, permessi, geometria) sono imposte da trigger e RPC.

## Come è stato verificato

Docker non era attivo, quindi non è stato avviato uno stack Supabase locale. Le migrazioni sono applicate **senza modifiche** a un Postgres reale (PGlite 0.5, PostgreSQL 17 + PostGIS 3.6) con un’emulazione minima di Supabase: ruoli `anon`/`authenticated`, `auth.users` + `auth.uid()` dai claim JWT, `storage.buckets`/`storage.objects` + `storage.foldername()`, privilegi di default di Supabase su `public` (quindi la sola protezione è RLS, come in produzione).

- `supabase/tests/rls.test.ts` — 23 test: provisioning, ruoli, isolamento tra organizzazioni, anonimo, concorrenza, immutabilità, append-only, geometria, link (creazione, revoca, scadenza, token non in chiaro), storage per tenant, audit.
- `supabase/tests/repository.test.ts` — 5 test: il `SupabaseRepository` dell’app contro lo stesso database (salvataggio, conflitto tra sessioni, viewer, eliminazione, utente esterno).
- Mutation check: rendendo permissive la policy di lettura dei progetti e quella di caricamento nello storage, 3 test falliscono.

**Non verificato:** comportamento su un progetto Supabase reale (PostgREST, GoTrue, Storage API), invio email, limiti di frequenza.

## Attivazione su un progetto Supabase

1. Crea il progetto (regione UE consigliata, decisione D1).
2. Applica le migrazioni in ordine: `supabase/migrations/*.sql` (CLI: `npx supabase link` poi `npx supabase db push`), quindi `supabase/seed/demo_seed.sql`.
3. In Authentication → URL configuration aggiungi l’origine dell’app e `/accesso` tra i redirect.
4. Copia `.env.example` in `.env.local` e imposta `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` (mai la service role key nel client).
5. Avvia l’app, registrati, crea l’organizzazione da **/accesso**, poi “Copia qui i progetti di questo browser” o “Carica demo”.

## Limiti noti

- L’interfaccia non nasconde ancora i comandi di modifica ai viewer: il server li rifiuta e l’app mostra un avviso (banner “ruolo lettura” e messaggio d’errore).
- Offline con archivio condiviso: senza rete il salvataggio fallisce in modo esplicito; coda di sincronizzazione nella PWA (B-110).
- La UI di caricamento foto/documenti (B-109) userà `media.ts`; per ora il servizio è pronto ma non esposto.
- `bundle_hash` è calcolato dal client; il server verifica le regole di integrità, non ricalcola l’hash canonico.
