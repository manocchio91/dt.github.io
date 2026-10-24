# 13 — Foto e documenti (B-109): storage, sicurezza e privacy

Pagina: **/progetti/:id/documenti** (“Foto e documenti”), disponibile nei progetti urbani e agricoli; collegamenti anche dalla Verifica ex-post e dalle osservazioni del Lab agricolo.

## Flusso

caricamento → controllo → anteprima → associazione territoriale → salvataggio → consultazione → esportazione → eliminazione

| Passo | Cosa succede | Dove |
|---|---|---|
| Caricamento | fotocamera (`capture="environment"` su smartphone), scelta da dispositivo, trascinamento su desktop | `MediaPage.tsx` |
| Controllo | tipo **reale** dai primi byte (non dall’estensione), coerenza estensione/contenuto/tipo dichiarato, dimensione massima, blocco eseguibili/script/HTML/SVG/archivi, HEIC rifiutato con istruzioni | `packages/domain/src/media/files.ts` |
| Pulizia | rimozione EXIF (incluso GPS, modello, data di scatto), XMP, IPTC, commenti da JPEG; eXIf e testo da PNG; EXIF/XMP da WebP (con flag VP8X e dimensione RIFF corretti). I PDF non vengono modificati e l’app lo dice | `files.ts` |
| Anteprima | immagine ripulita; elenco di cosa è stato rimosso e di cosa si conserva | `MediaPage.tsx` |
| Associazione | progetto e area/parcella (obbligatori), sottozona (agricolo) o cella (urbano) da selettore o dalla mappa, scenario, osservazione, fase del workflow, data, autore | `validateMediaContext()` e trigger `app.check_media_context()` |
| Salvataggio | ospite: IndexedDB del browser; organizzazione: scheda → oggetto → conferma, con indicatore a fasi, annullamento e nuovo tentativo | `mediaStore.ts` |
| Consultazione | anteprima e download su richiesta; per i file del server: RPC `log_media_access` (audit) + URL firmato di **60 secondi** | `SupabaseMediaStore.open()` |
| Esportazione | download del singolo file (nome normalizzato) ed elenco CSV con dizionario dei campi | `mediaToCsv()` |
| Eliminazione | conferma esplicita; tre passi (stato “in eliminazione” → rimozione dallo storage → rimozione della scheda); ripresa se un passo fallisce | `SupabaseMediaStore.remove()` |

Accanto alle immagini agricole compare sempre: *“La fotografia documenta l’osservazione ed è associata ai dati disponibili. Non costituisce una diagnosi agronomica.”* Nessuna analisi automatica delle immagini; nessuna estrazione o uso di volti.

## Modalità ospite e rete

- Senza account i file restano **solo nel browser** con l’etichetta “File locale — non sincronizzato con il server.”
- All’accesso a un’organizzazione i file da ospite **non** vengono caricati: l’app chiede conferma (“Carica nell’organizzazione”).
- Senza rete, in un’organizzazione, i nuovi file vengono salvati in locale come “non sincronizzati”; al ritorno della rete l’app propone “Sincronizza ora” (nessun invio automatico).

## Sicurezza lato server (migrazione `20261024000004_media.sql`)

| Requisito | Implementazione |
|---|---|
| Storage privato | bucket `project-media` con `public = false` (migrazione 0002) |
| Percorso | `{organization_id}/{project_id}/{uuid}.{ext}`, imposto da `CHECK` e coerente con il tipo |
| Nessun oggetto senza contesto | la policy di INSERT su `storage.objects` accetta solo percorsi con una scheda `media_assets` in stato `caricamento` dello stesso autore |
| Contesto valido | trigger: area/parcella, sottozona, cella, scenario, osservazione devono esistere nel documento di progetto e rispettarne l’ambito |
| Tipi e dimensioni | `CHECK` su MIME (JPEG, PNG, WebP, PDF), dimensione ≤ 20 MB e limite **configurabile per organizzazione** (`organizations.media_max_bytes`); bucket con `allowed_mime_types` e `file_size_limit` |
| Nomi | nome originale normalizzato (`[a-z0-9._-]`), l’oggetto è salvato con un UUID |
| Ruoli | lettura: consulta e scarica · modifica: carica e modifica descrizione/collegamenti **dei propri** file · approvazione: come modifica, allega alla revisione · amministrazione: elimina qualsiasi file |
| Immutabilità | file, percorso, tipo, dimensione, impronta, autore non modificabili dopo il caricamento; nessuna policy UPDATE sugli oggetti |
| Isolamento | RLS su `media_assets` e policy su `storage.objects` per organizzazione; un utente rimosso perde subito lettura e firma |
| Eliminazione coerente | la scheda si cancella solo quando l’oggetto non esiste più: un errore dello storage lascia il file nascosto in “eliminazione incompleta”, mai un oggetto orfano |
| Progetti con file | un progetto non si elimina finché ha file nello storage |
| Audit minimo | `caricamento`, `consultazione`, `modifica_contesto`, `eliminazione_avviata`, `eliminazione_completata` con progetto, categoria e tipo; **mai** nome, descrizione o percorso |
| Conservazione | `retention_until` impostato in automatico (default 5 anni, configurabile per organizzazione); `media_due_for_deletion()` elenca i file scaduti agli amministratori |
| Chiavi | nel client solo URL e chiave anon pubblica; nessuna chiave di servizio |

## Privacy

- Posizione **disattivata per impostazione predefinita**; si conserva solo spuntando il consenso (punto scelto sulla mappa o posizione del dispositivo, che il browser chiede a sua volta). Il database rifiuta coordinate senza consenso.
- EXIF e GPS rimossi **prima** dell’upload (anche in modalità ospite, prima del salvataggio locale).
- L’utente vede l’elenco di cosa viene rimosso e conservato.
- Le descrizioni sono libere: l’interfaccia invita a non inserire dati personali.

## Gateway server-side (B-124) — migrazione `20261024000005_media_gateway_retention.sql`

Dalla 0005 il browser **non conferma e non firma più** i file:

| Passo | Chi lo fa | Cosa viene verificato |
|---|---|---|
| Scheda + oggetto | client con il token dell’utente | contesto (trigger), percorso, ruolo (RLS e policy) |
| **Quarantena** | — | l’oggetto è visibile solo al suo autore (per annullare); nessun altro lo vede |
| Conferma | Edge Function `media-gateway` (`complete`) | autorizzazione con il token dell’utente (`media_authorize_complete`), poi con la chiave di servizio: **byte reali** (magic bytes), coerenza con il tipo registrato, dimensione, **impronta SHA-256**, assenza di EXIF/GPS (un client modificato che salta la pulizia viene scartato), controllo PDF. Esito in `validation`; file non conformi rimossi (audit `caricamento_scartato`) |
| Consultazione | `media-gateway` (`sign`) | `log_media_access` con il token dell’utente **prima** della firma; poi firma di 60 s con la chiave di servizio. I client non hanno più policy di lettura sugli oggetti: senza gateway non c’è URL, quindi non si può saltare il registro |
| Eliminazione | `media-gateway` (`delete`) | `media_authorize_delete` (solo admin, audit con l’attore) → rimozione oggetto → rimozione scheda; 503 e ripresa se un passo fallisce |

Tutte le azioni sono **idempotenti** e il client le ritenta con attesa crescente in caso di rete assente o errore 5xx. Solo il servizio può impostare `status = 'attivo'`, `validated_at` e `validation` (trigger).

## Conservazione (B-125)

- Periodo predefinito per organizzazione (`media_retention_years`, modificabile dagli amministratori in /accesso) e data per singolo file modificabile solo dagli amministratori, mai nel passato (trigger, audit `modifica_conservazione`).
- Anteprima per gli amministratori dei file in scadenza entro 30 giorni (`media_expiring`) nella pagina Foto e documenti.
- Job di eliminazione: Edge Function `media-retention` (logica `purgeExpired`), invocata ogni notte da `pg_cron` + `pg_net` con un segreto dedicato; modello in `supabase/sql/schedule-media-retention.sql` (non è una migrazione: richiede URL del progetto e segreto nel Vault). Audit minimo: `eliminazione_per_scadenza`, `eliminazione_completata`. Gli errori parziali lasciano il file nascosto in “eliminazione in corso” e il job successivo riprende.

## PDF

Controllo **euristico** sul testo non compresso, nel client e nel gateway: rifiuta PDF con JavaScript, azioni di avvio, allegati incorporati, contenuti multimediali attivi o cifratura. **Non è una sanitizzazione**: autore, software e XMP restano nel file e oggetti dentro flussi compressi possono sfuggire. La sanitizzazione verificata è in backlog (B-127) e l’interfaccia lo dichiara.

## Limiti dichiarati

- **Nessun antivirus.** La scansione malware è in roadmap (B-123); il gateway registra `antivirus: non disponibile` nell’esito.
- Le Edge Function **non sono state eseguite** in Deno né su Supabase reale: la loro logica (`supabase/functions/_shared/mediaGateway.ts`) è testata su Postgres reale (PGlite) con le policy vere; l’involucro Deno va provato su staging (docs/14).
- Un URL firmato già emesso resta valido fino alla scadenza (**60 secondi**) anche se nel frattempo il ruolo viene revocato; dopo l’eliminazione dell’oggetto non funziona più.
- HEIC non supportato (rifiutato con istruzioni); conversione reale in roadmap (B-126).
- La pianificazione notturna va attivata a mano sul progetto (pg_cron, pg_net, Vault).
- I metadati interni dei PDF non vengono rimossi (B-127).

## Test

| Livello | File | Copertura |
|---|---|---|
| Dominio | `media/files.test.ts` (12), `media/media.test.ts` (7) | EXIF e GPS reali scritti con piexifjs e verificati assenti dopo la pulizia; PNG/WebP; MIME falso, estensione contraffatta, eseguibili, HEIC, archivi, dimensione; nomi; contesto e separazione urbano/agricolo; CSV |
| Database | `supabase/tests/media.test.ts` (24), `mediaStore.test.ts` (7) | ordine scheda→oggetto, lettura che prova a caricare via API, contesto, percorso, isolamento, revoca, eliminazione in tre passi con errore parziale, audit minimo, conservazione, progetto con file; `SupabaseMediaStore` dell’app contro le policy reali |
| Componenti | `apps/web/src/test/media.test.tsx` (13) | ospite completo, rifiuti, ruoli, amministratore, rete assente/ripristinata, file da ospite non caricati senza conferma, cambio organizzazione, tastiera |
| E2E (Edge) | `e2e/media.spec.ts` (8), `e2e/mobile.spec.ts` | flusso completo con download verificato senza EXIF, rifiuti, solo tastiera, associazione da mappa, backend simulato: URL firmato scaduto (400) ed eliminato (404), lettura via API (403), offline→sincronizzazione, cambio organizzazione; smartphone con fotocamera |

**F22 resta Beta** finché questi controlli non sono ripetuti su un progetto Supabase reale (vedi [14-piano-test-supabase-reale.md](14-piano-test-supabase-reale.md)).
