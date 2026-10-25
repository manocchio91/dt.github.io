# 12 — Onboarding per profilo (B-102) e interfaccia per ruolo (B-120)

## Due concetti separati

| | Profilo operativo | Ruolo di autorizzazione |
|---|---|---|
| Cosa descrive | il lavoro dell’utente | cosa può fare nell’organizzazione |
| Valori | tecnico comunale, gestore del verde, agricoltore/viticoltore, agronomo, revisore/approvatore | lettura, modifica, approvazione, amministrazione |
| Chi lo sceglie | l’utente, nell’onboarding | l’amministratore dell’organizzazione |
| Dove vive | `user_preferences` (Supabase) o `localStorage` (ospite) | `memberships` |
| Effetto | testi, ambito suggerito, percorso, modalità guidata/tecnica | comandi visibili nell’interfaccia; **policy RLS** nel database |

Garanzie che il profilo non aumenti i permessi:

- `permissionsFor(archivio, ruolo)` non riceve il profilo (verificato da test sulla firma).
- Le preferenze non contengono ruoli: `parsePreferences()` scarta campi estranei; il database rifiuta con un vincolo `CHECK` le chiavi `role`, `permissions`, `canEdit`, `organization_id`…
- `user_preferences` ha RLS “solo la propria riga”: nemmeno un amministratore legge o scrive le preferenze altrui.
- Un utente non può modificare `memberships` (test DB: aggiornamento a `admin` → 0 righe; inserimento → rifiutato).
- Test componenti ed E2E: un utente in sola lettura che sceglie “Revisore” continua a non vedere comandi di modifica e non invia scritture.

## Le sei domande

1. **Chi sei?** — cinque profili; nota esplicita “il profilo non cambia i permessi” e, se si è in un’organizzazione, il ruolo attuale.
2. **In quale ambito lavori?** — Città o Campagna; preselezionato in base al profilo (il revisore sceglie).
3. **Quale decisione devi prendere?** — elenco diverso per ambito (5 voci urbane, 6 agricole; nessuna voce prescrive irrigazioni, trattamenti o interventi automatici).
4. **Su quale area, parcella o progetto lavori?** — area dimostrativa; nuova area o parcella (solo con ruolo modifica); progetto esistente dello stesso ambito.
5. **Quali dati possiedi già?** — elenco diverso per ambito, con spiegazione semplice di cosa cambia senza quei dati.
6. **Preferisci la modalità guidata o tecnica?** — guidata (un passo alla volta, dettagli chiusi) o tecnica (dettagli aperti).

Una domanda per schermata, “Domanda n di 6”, “Continua” come unica azione primaria e “Indietro” secondaria. Le risposte sono salvate come bozza a ogni passo (`mdt:onboarding:bozza`, solo campi della guida): “Esci e riprendi dopo” riprende dalla stessa domanda. Dettagli e verifica in `18-semplificazione-ux-audit.md`.

Cambiare ambito azzera decisione, dati e progetto scelti: nessuna voce urbana può restare in un percorso agricolo e viceversa (liste disgiunte, verificate da test).

## Instradamento

| Scelta area | Destinazione |
|---|---|
| Demo | Lab dell’ambito con il progetto dimostrativo (creato se manca) |
| Nuovo progetto | pagina Area/Parcelle del nuovo progetto |
| Progetto esistente | Lab dell’ambito (o pagina Area se l’area manca); un progetto dell’altro ambito non viene mai aperto |

## Modalità guidata e tecnica

- **Guidata:** riquadro “Guida” in testa ai due Lab con il prossimo passo e il collegamento alla sezione; dettagli tecnici chiusi.
- **Tecnica:** niente riquadro; “Come è calcolato” e l’inserimento coordinate sono già aperti.
- Per arrivare al primo scenario anche senza rete, i progetti Demo offrono “Usa valori dimostrativi (SIMULATI)” per la baseline: scelta esplicita, valori marcati SIMULATO.
- Interventi e aree si possono inserire anche **da tastiera** (coordinate), non solo cliccando sulla mappa.

## B-120 — comandi nascosti a chi ha solo la lettura

Con ruolo “lettura” nell’archivio dell’organizzazione non compaiono: creazione e import progetti, caricamento demo, disegno/import aree e sottozone, nuove baseline, scenari, interventi, calcolo, decisioni, invio a revisione, piano ex-post e import misure, proposte di ricalibrazione, input agronomici (mostrati come testo), conferma fenologia, aggiornamento meteo, osservazioni. “Elimina” compare solo agli amministratori. Lo store rifiuta in anticipo le scritture (`readOnly`), ma la protezione principale resta RLS: un test E2E chiama direttamente l’RPC con il token di un utente in sola lettura e riceve 403.

## Test

| Livello | File | Cosa copre |
|---|---|---|
| Dominio | `packages/domain/src/onboarding/onboarding.test.ts` (14) | passi, validazione, liste disgiunte, cambio ambito, instradamento, preferenze manomesse, permessi solo dal ruolo |
| Database | `supabase/tests/preferences.test.ts` (7) | propria riga, aggiornamento, “Revisore” non cambia il ruolo, chiavi di permesso rifiutate, coerenza colonne/documento, nessun accesso altrui, nessuna auto-promozione |
| Componenti | `apps/web/src/test/onboarding.test.tsx` (12), `readOnly.test.tsx` (14) | percorsi urbano/agricolo, solo tastiera, errori, salto, modifica, nuovo progetto, lettura, persistenza account, cambio organizzazione; B-120 su 6 pagine nei due versi |
| E2E (Edge) | `e2e/onboarding.spec.ts` (5), `e2e/supabase.spec.ts` (4), `e2e/mobile.spec.ts` (1) | build di produzione: tempi, primo scenario da zero, tastiera, demo senza registrazione, preferenze, backend Supabase simulato (login, ruoli, cambio organizzazione, persistenza, 403 lato server), smartphone |

Tempi misurati dagli E2E (browser automatico): onboarding ≈ 2–3 s, primo scenario da un progetto nuovo ≈ 4–5 s. **Non sono tempi umani**: dimostrano che il flusso non ha passaggi bloccanti; le soglie (< 2 min, < 5 min) vanno verificate con utenti reali negli Sprint 2–3.

## Limiti

- Gli E2E autenticati usano un backend Supabase **simulato** nel test (Auth e PostgREST minimi con le stesse regole di permesso): non sostituiscono la verifica su un progetto reale.
- Le preferenze di un ospite non vengono copiate automaticamente nell’account al primo accesso (scelta prudente; si rifà l’onboarding in meno di un minuto).
- Audit WCAG 2.2 AA e prova con screen reader non ancora eseguiti (B-114).
