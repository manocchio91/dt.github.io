# Revisione finale UX pre-merge

Data: 26 ottobre 2026  
Branch: `feat/semplificazione-finale-ux`  
Perimetro: sola interfaccia web, documentazione e test UX. Nessuna modifica a backend, servizi o migrazioni.

## Esito

La revisione rende i due Decision Lab leggibili a colpo d'occhio anche senza aprire i dettagli tecnici. Ogni Lab espone ora un riepilogo iniziale con stato, oggetto osservato, parametro principale, orizzonte, fonte, aggiornamento e prossimo passo. La guida completa resta disponibile e il percorso non prescrive azioni operative.

La matrice completa delle schermate e delle decisioni è in [matrice-revisione-finale-ux-2026-10-26.md](./matrice-revisione-finale-ux-2026-10-26.md).

## 1. Elementi eliminati

- Riferimenti a Supabase e al database nel testo principale di accesso e progetti.
- Evidenza primaria concorrente sui comandi intermedi di Lab, area, meteo e media.
- Formulazione tecnica duplicata nel messaggio di indisponibilità del modello avanzato.
- Aspetto da azione primaria sui selettori dell'orizzonte 24/72 ore.

Non sono stati eliminati dati, fonti, categorie di provenienza o informazioni necessarie all'audit.

## 2. Elementi semplificati

- Decision Lab urbano e agricolo: introdotto un unico riepilogo decisionale prima dei dettagli.
- Gerarchia delle azioni: una sola azione primaria visibile per schermata nei due Lab.
- Accesso e progetti: linguaggio orientato all'utente (`archivio condiviso`, `registro attività`).
- Fallback Timestral: testo breve e uniforme: “Il modello avanzato non è disponibile. Puoi continuare con la previsione di base.”
- Percorso Media: aggiunto il posizionamento nella guida esistente senza creare nuove pagine o voci di menu.

## 3. Elementi mantenuti nei dettagli

- Metadati, qualità, provenienza e dati tecnici restano nelle sezioni già dedicate all'approfondimento.
- Le quattro categorie di fonte restano preservate: dati inseriti dall'utente, sensori/osservazioni, fonti esterne e risultati di modello.
- La previsione di base resta sempre utilizzabile quando il modello avanzato non è disponibile.
- La guida completa conserva le sei domande; il riepilogo iniziale non la sostituisce.

## 4. Confronto prima/dopo

La baseline precedente è conservata in [`docs/ux/schermate/dopo`](../ux/schermate/dopo). La revisione finale è in [`docs/ux/schermate/finale`](../ux/schermate/finale), con nove stati sia desktop sia smartphone.

Confronti principali:

- Lab urbano: `dopo/03-lab-urbano-*` → `finale/03-lab-urbano-*`.
- Previsioni urbane: `dopo/05-previsioni-urbano-*` → `finale/05-previsioni-urbano-*`.
- Lab agricolo: nuova evidenza diretta `finale/07-lab-agricolo-*`; la baseline aveva documentato il relativo percorso previsionale.
- Previsioni agricole: `dopo/07-previsioni-agricolo-*` → `finale/08-previsioni-agricolo-*`.
- Meteo collegato: `dopo/08-meteo-collegato-*` → `finale/09-meteo-collegato-*`.

## 5. Controlli eseguiti

- Pipeline completa `npm run ci`: superata.
- Test unitari/integrati Vitest: 460 su 460 superati.
- Playwright: 72 test superati e 2 catture opzionali saltate nella suite ordinaria.
- Verificati i tre viewport richiesti: 320, 375 e 390 px.
- Verificati assenza di scorrimento orizzontale, zoom, tastiera, semantica automatizzata, sei domande della guida, risultato senza apertura dei dettagli, una sola azione primaria nei Lab, linguaggio guidato, richiesta esplicita dei dettagli, percorsi urbano/agricolo, Docker spento, modello avanzato spento e assenza di formulazioni prescrittive.
- Generate 18 evidenze visive finali: nove stati desktop e nove smartphone.

Il comando Playwright completa tutti i casi ma, nell'ambiente locale, il processo padre non termina autonomamente dopo il teardown e raggiunge il timeout. Le asserzioni risultano concluse e verdi; il difetto di chiusura del runner resta distinto dall'esito dei test.

## 6. Requisiti di audit preservati

- Provenienza essenziale visibile nel riepilogo e metadati completi disponibili nei dettagli.
- Distinzione tra dato osservato, fonte esterna e risultato di modello invariata.
- Nessuna cancellazione o riscrittura della cronologia.
- Stati della cronologia a sette giorni esposti in linguaggio semplice; dettagli disponibili su richiesta.
- Nessuna modifica a contratti API, backend, servizi, schema dati o migrazioni 0012–0013.

## 7. Questioni aperte

- Eseguire una sessione manuale con uno screen reader reale: l'automazione verifica struttura e nomi accessibili, non l'esperienza uditiva completa.
- Correggere in un intervento separato l'hang di teardown del runner Playwright.
- Validare con utenti reali dei due profili (tecnico comunale e agricoltore/viticoltore) il tempo necessario a comprendere stato e prossimo passo.

## Vincolo di consegna

Il lavoro si ferma sul branch `feat/semplificazione-finale-ux`. Nessun merge in `master` è stato eseguito.
