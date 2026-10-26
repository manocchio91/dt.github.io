# Semplificazione UX guidata

## Problema e principi

La precedente interfaccia esponeva subito pipeline, parametri e destinazioni utili all'audit ma difficili da interpretare per tecnici comunali, agricoltori e agronomi. La revisione conserva dati, calcoli e tracciabilità e applica progressive disclosure: la modalità guidata segue **dati → criticità → alternative → confronto → decisione umana → verifica**, mentre la modalità tecnica espone anche strumenti e dettagli avanzati. Non è stata duplicata alcuna logica applicativa.

Una stima non viene presentata come misura. Restano visibili le classi MISURATO, OSSERVATO, PREVISTO, SIMULATO e INSERITO DALL'UTENTE, con fonte, data, qualità, modello e lineage nei dettagli già disponibili. Il sistema supporta la decisione ma non prescrive interventi o diagnosi.

## Modalità e navigazione

La scelta effettuata nelle sei domande iniziali continua a determinare il livello di dettaglio. Nella modalità guidata il progetto espone Area/Parcella, Analisi, Confronto, Decisioni e verifica, Allegati e prove. Previsioni è uno strumento della modalità tecnica; il riepilogo meteo/previsionale resta nel percorso decisionale e conserva il fallback. Fonti e metodo, limiti e stato del prototipo sono raccolti nelle informazioni secondarie. La modalità tecnica mantiene tutte le destinazioni.

La Home guidata presenta quattro azioni: scegliere l'area, analizzare la criticità, provare alternative, confrontare e decidere. Maturità e informazioni tecniche restano in una sezione espandibile.

## Flusso urbano

Area mostra per primi nome, superficie, mappa e stato; CRS, vertici, origine e superficie geodetica sono nei dettagli tecnici. Analisi è organizzata come “Cosa sta succedendo?”, “Cosa vuoi provare?” e “Cosa cambia? Prima → dopo”. Il confronto mostra card sintetiche con effetto, costo, acqua e manutenzione; tabella, intervalli e mappe restano in “Mostra confronto tecnico completo”. La comparabilità preesistente continua a bloccare confronti non equi. La decisione resta motivata e attribuita a un autore. Dopo la registrazione, Verifica presenta un invito semplice a pianificare il confronto tra previsto e osservato senza eliminare il piano tecnico.

## Flusso agricolo

La parcella, la mappa delle sottozone e la prima zona da controllare precedono i dettagli. “Dove devo controllare?” ordina le zone per priorità testuale, motivazione, fiducia e dati mancanti; la matrice delle componenti resta espandibile e non è stato creato alcun indice sintetico. Gli input agronomici completi restano modificabili sotto “Modifica dati agronomici”, senza introdurre valori mancanti o dedurre la fase fenologica.

Le osservazioni mostrano inizialmente la sola azione di aggiunta. Le alternative conservano valutabilità, orizzonte, pro e contro. La decisione richiede almeno due alternative, autore, supervisore e motivazione. “Prima → oggi” confronta lo snapshot con lo stato successivo e dichiara esplicitamente che non prova causalità.

## Elementi nascosti, non eliminati

Sono ridotti di prominenza: previsioni complete, pipeline tecnica, CRS e coordinate, matrice agricola, tabella urbana, incertezza, mappe di differenza, fonti/metodo, limiti, stato F01–F31 e allegati. Non sono stati eliminati contenuti, dati, pagine o funzioni. ForecastPage, Timestral sperimentale, fallback, Open-Meteo, audit trail, lineage, permessi, autenticazione e verifica ex-post restano invariati.

| Elemento | Prima | Dopo | Motivo | Funzione tecnica preservata |
|---|---|---|---|---|
| Home | pipeline completa | quattro passi decisionali | orientamento immediato | pipeline nei dettagli |
| Navigazione | tutte le pagine allo stesso livello | progetto, attività, informazioni | meno destinazioni primarie | pagine tecniche raggiungibili |
| Area | coordinate e CRS in primo piano | nome, superficie, mappa, stato | compito prima dei metadati | geometria e calcoli invariati |
| Analisi urbana | sezioni tecniche | criticità, prova, prima/dopo | linguaggio operativo | modello e output invariati |
| Confronto urbano | tabella estesa | card, poi dettaglio | lettura su mobile | controlli di comparabilità invariati |
| Input agricoli | tutti aperti | sintesi e modifica su richiesta | riduzione del carico | tutti i campi conservati |
| Zone agricole | matrice e lista separate | blocco ordinato unico | priorità leggibile | componenti separate conservate |
| Osservazioni | modulo sempre esposto | apertura volontaria | azione più chiara | categorie e classi dati invariate |
| Verifica | piano tecnico immediato | messaggio e CTA semplice | continuità dopo la decisione | piano e confronto ex-post invariati |

## Audit, backend e limiti

Sono preservati autore, motivazione, timestamp, versioni, snapshot, audit trail, classificazione dei dati, incertezza e messaggi sui limiti. Nessuna modifica backend o di dominio è risultata necessaria. Supabase, migrazioni, RLS, forecast-proxy, configurazione Render e GitHub Pages non sono stati modificati; Timestral non è diventato obbligatorio né accessibile direttamente dal browser.

Limiti residui: i costi e alcuni dati demo restano illustrativi; il PoC non diventa un Digital Twin scientificamente calibrato; priorità agricole e output simulati richiedono verifica umana. Le informazioni avanzate nei pannelli espandibili richiedono un'azione esplicita dell'utente.

## Verifica

Sono previsti lint, typecheck, build, suite Vitest, suite Playwright, controllo di teardown/porte e scansione segreti. Due test E2E coprono i golden path urbano e agricolo, inclusi due scenari/misure, decisione e verifica. La suite esistente continua a coprire tastiera, ruoli, viewport mobili (320/375/390/768), zoom, fallback meteo/Timestral e coerenza dei dati. Le capture automatiche già prodotte dalla suite restano disponibili negli artifact di Playwright; non sono aggiunti screenshot manuali al repository.
