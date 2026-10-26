# Preview Render: preparazione senza deploy

Questa guida prepara due servizi separati dal branch `feat/render-preview`:

1. **Static Site** `micro-digital-twin-preview`: il frontend React/Vite;
2. **Web Service Docker** `micro-digital-twin-timestral`: solo Timestral-5M.

Supabase resta il database e il sistema di autenticazione. Il file `render.yaml`
non crea database Render e disattiva gli auto-deploy. Non applicare il Blueprint
e non premere **Create/Deploy** finche il deploy non viene autorizzato.

## Prima decisione: memoria e piano gratuito

Il 26 ottobre 2026 il listino Render indica **256 MB**, non 512 MB, per il Web
Service gratuito. Il vecchio piano Starter da 512 MB e stato sostituito dai nuovi
identificativi; 512 MB non e oggi l'offerta gratuita.

Misura locale ripetibile sul container gia costruito, Timestral-5M reale e pesi
alla revisione bloccata:

| Limite Docker | CPU | Esito | Massimo osservato durante il campionamento |
| --- | --- | --- | --- |
| 512 MB | 1 CPU | test reale completato, exit 0, nessun OOM | 188,2 MiB |
| 256 MB | 0,1 CPU | test reale completato, exit 0, nessun OOM | 187,9 MiB |

Il test esegue due inferenze reali consecutive su 720 punti. Dimostra che il
modello 5M entra nel limite, ma il margine gratuito e ridotto e non equivale a
un test di carico. Per questo la configurazione abilita un solo modello, un solo
worker e `FORECAST_MAX_CONCURRENCY=1`. L'immagine e circa 1,42 GB: e spazio
immagine, non RAM. Sul piano gratuito la cache locale viene persa a ogni spin-down,
quindi il riavvio deve riscaricare circa 21 MB di pesi e puo essere lento.

Fonti ufficiali: [piani Render](https://render.com/pricing),
[limiti gratuiti](https://render.com/docs/free),
[specifica Blueprint](https://render.com/docs/blueprint-spec).

## Creare l'account (quando il deploy sara autorizzato)

1. Apri [dashboard.render.com](https://dashboard.render.com/) e registrati con
   GitHub.
2. Autorizza Render soltanto per il repository necessario, se GitHub propone la
   scelta dei repository.
3. Verifica in **Billing** che il piano sia Free e imposta un limite di spesa
   coerente con zero costi.
4. Non creare Render Postgres: i dati e l'autenticazione restano su Supabase.

## Servizi da creare

Il modo piu semplice e **New > Blueprint**, repository `dt.github.io`, branch
`feat/render-preview`, file `render.yaml`. Prima di confermare controlla che siano
elencati esattamente uno Static Site e un Web Service Docker e che entrambi abbiano
auto-deploy disattivato. L'importazione del Blueprint avvia un deploy: fermarsi
prima della conferma finche non viene autorizzato.

In alternativa, crearli a mano con questi valori:

| Campo | Static Site | Timestral Web Service |
| --- | --- | --- |
| Branch | `feat/render-preview` | `feat/render-preview` |
| Build | `npm ci && npm run build` | Docker |
| Publish directory | `apps/web/dist` | — |
| Dockerfile | — | `services/forecasting/Dockerfile` |
| Docker context | — | `services/forecasting` |
| Health check | — | `/health` |
| Piano | Static gratuito | Free |

Il frontend deve avere la rewrite `/*` verso `/index.html`, necessaria per le
route React aperte direttamente dal browser.

## Variabili da inserire manualmente

Nel **Static Site**:

- `VITE_SUPABASE_URL`: URL pubblico del progetto Supabase di staging;
- `VITE_SUPABASE_PUBLISHABLE_KEY`: publishable key di staging (non la service role);
- non impostare ancora `VITE_FORECAST_URL`.

Nel **Web Service Timestral**:

- `FORECAST_SERVICE_TOKEN`: genera nel password manager un valore casuale di
  almeno 32 byte; non riusare password o token Supabase;
- `FORECAST_MODELS=mistralai/Timestral-5M`;
- `FORECAST_MAX_CONCURRENCY=1`;
- `HF_HOME=/models`;
- `HF_HUB_DISABLE_TELEMETRY=1`.

Il token protegge `POST /v1/forecast`: senza token configurato il servizio rifiuta
tutte le previsioni, e con token errato risponde 401. `/health` non accetta dati e
non espone credenziali.

## Collegamento sicuro da completare dopo

Non collegare mai il browser all'URL `onrender.com` di Timestral. Il percorso deve
restare:

`browser -> forecast-proxy Supabase -> Timestral Render`

Il proxy gia presente verifica JWT, progetto visibile, organizzazione e ruolo
`editor`/`admin`, applica il limite di frequenza e aggiunge il token di servizio.
Solo dopo che Render avra creato l'URL Timestral:

1. impostare nei secret della Edge Function `FORECAST_SERVICE_URL` con l'URL Render
   e `FORECAST_SERVICE_TOKEN` con lo stesso token;
2. pubblicare `forecast-proxy`;
3. impostare nel frontend `VITE_FORECAST_URL` all'URL **Supabase della Edge
   Function**, mai all'URL Render;
4. restringere `ALLOWED_ORIGIN` all'URL dello Static Site e ricostruire il sito.

Questi quattro passi modificano Supabase o avviano deploy e quindi **non fanno
parte di questo branch**. Se Render e sospeso, il proxy restituisce indisponibilita
e l'app continua a offrire le previsioni di base; senza `VITE_FORECAST_URL` il
fallback e immediato e non viene effettuata alcuna chiamata a Timestral.

## Informazioni da non incollare mai in chat

- `FORECAST_SERVICE_TOKEN`;
- service role key o secret key Supabase;
- access token GitHub o Render;
- password, codici 2FA, recovery code e cookie di sessione;
- contenuto di file `.env` o schermate che mostrino valori segreti.

La publishable key Supabase e destinata al browser, ma va comunque copiata
direttamente dal dashboard al campo Render, senza passarla in chat. Comunicare
solo nomi delle variabili, URL pubblici e messaggi d'errore ripuliti.

## Ottenere il link per il professore

Dopo un deploy autorizzato e riuscito, apri lo Static Site nel Dashboard e copia
l'URL pubblico simile a `https://micro-digital-twin-preview.onrender.com`. Aprilo
in una finestra anonima, verifica login, navigazione e fallback con Timestral
sospeso, quindi condividi **solo questo URL dello Static Site**. Non condividere
l'URL del Web Service Timestral ne pagine del dashboard.
