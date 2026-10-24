import { createDefaultRegistry, DATA_CLASSES, DATA_CLASS_DESCRIPTION, modelRef, OPEN_METEO_LICENSE } from '@mdt/domain';
import { ClassChip } from '../components/DataBadge';
import { Term } from '../components/ui';

const registry = createDefaultRegistry();

const CONNECTORS = [
  { name: 'Open-Meteo Historical (archivio)', use: 'Baseline meteo urbana: T aria 2 m, UR, vento 10 m, radiazione', cls: 'STIMATO DA MODELLO', status: 'Beta', license: OPEN_METEO_LICENSE },
  { name: 'Open-Meteo Forecast (giorni passati + suolo)', use: 'Vigneto: Tmax 14 giorni, precipitazione, umidità suolo 9–27 cm', cls: 'STIMATO DA MODELLO / PREVISIONE', status: 'Beta', license: OPEN_METEO_LICENSE },
  { name: 'OpenStreetMap tile', use: 'Cartografia di base', cls: '—', status: 'Operativa', license: 'ODbL, attribuzione obbligatoria' },
  { name: 'GeoJSON (file utente)', use: 'Aree e parcelle in WGS84', cls: "INSERITO DALL'UTENTE", status: 'Operativa', license: '—' },
  { name: 'CSV misure (file utente)', use: 'Verifica ex-post', cls: 'MISURATO / OSSERVATO / SIMULATO dichiarato per riga', status: 'Operativa', license: '—' },
  { name: 'Copernicus / Sentinel-2 / LST', use: 'Temperatura superficiale, vigore', cls: '—', status: 'Non disponibile (credenziali e prodotto non definiti)', license: '—' },
  { name: 'NASA POWER, Sensor.Community, Nominatim', use: 'Serie agroclimatiche, sensori civici, geocodifica', cls: '—', status: 'Roadmap M1', license: '—' },
];

export function MethodPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-extrabold text-petrol-900">Fonti e metodo</h1>
      <p className="max-w-3xl text-sm">
        Ogni numero dell’app risale a una catena di provenienza (<Term k="lineage">lineage</Term>): fonte, endpoint, data di acquisizione, licenza, coordinate, risoluzione, trasformazioni, formula,
        versione, unità, qualità e limiti. Clicca il badge accanto a un numero per aprirla.
      </p>

      <section className="card" aria-labelledby="classi">
        <h2 id="classi" className="h-section">
          Classificazione dei dati
        </h2>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {DATA_CLASSES.map((c) => (
            <li key={c} className="flex items-start gap-2 text-sm">
              <ClassChip dataClass={c} />
              <span>{DATA_CLASS_DESCRIPTION[c]}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="card overflow-x-auto" aria-labelledby="conn">
        <h2 id="conn" className="h-section">
          Connettori dati
        </h2>
        <table className="table-base mt-3 min-w-[40rem]">
          <thead>
            <tr>
              <th scope="col">Fonte</th>
              <th scope="col">Uso</th>
              <th scope="col">Classe</th>
              <th scope="col">Stato</th>
              <th scope="col">Licenza</th>
            </tr>
          </thead>
          <tbody>
            {CONNECTORS.map((c) => (
              <tr key={c.name}>
                <th scope="row" className="font-semibold">
                  {c.name}
                </th>
                <td>{c.use}</td>
                <td>{c.cls}</td>
                <td>{c.status}</td>
                <td className="text-xs">{c.license}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <h2 className="h-section pt-2">Modelli registrati</h2>
      <p className="text-sm text-sand-600">
        Nessun modello calibrato è registrato: la modalità Pilota calibrato non è attivabile. I modelli DEMO non possono essere usati in modalità Pilota (verificato da test).
      </p>
      {registry.list().map((m) => (
        <section key={modelRef(m)} className="card space-y-3" aria-labelledby={`m-${m.id}`}>
          <div className="flex flex-wrap items-center gap-2">
            <h3 id={`m-${m.id}`} className="text-lg font-bold text-petrol-900">
              {m.name}
            </h3>
            <code className="rounded bg-sand-100 px-2 py-0.5 text-xs">{modelRef(m)}</code>
            <span className="rounded border-2 border-dashed border-ochre-800 bg-ochre-100 px-2 py-0.5 text-xs font-bold text-ochre-800">DEMO ILLUSTRATIVO</span>
          </div>
          <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[12rem_1fr]">
            <dt className="font-semibold text-sand-600">Ambito di validità</dt>
            <dd>{m.validityScope}</dd>
            <dt className="font-semibold text-sand-600">Input obbligatori</dt>
            <dd>{m.requiredInputs.join('; ')}</dd>
            <dt className="font-semibold text-sand-600">Fonte scientifica</dt>
            <dd>{m.scientificSource}</dd>
            <dt className="font-semibold text-sand-600">Metodo d’incertezza</dt>
            <dd>{m.uncertaintyMethod}</dd>
            <dt className="font-semibold text-sand-600">Validazione</dt>
            <dd>{m.validationDate ? `${m.validationDate} — ${m.reviewer}` : 'Non validato · nessun revisore'}</dd>
            <dt className="font-semibold text-sand-600">Test</dt>
            <dd className="font-mono text-xs">{m.testFile}</dd>
          </dl>
          <details>
            <summary className="cursor-pointer font-semibold text-petrol-700">Output e ipotesi</summary>
            <ul className="mt-2 list-disc pl-5 text-sm">
              {m.outputs.map((o) => (
                <li key={o.key}>
                  <code>{o.key}</code> [{o.unit}] — {o.description}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-sm font-semibold">Ipotesi</p>
            <ul className="list-disc pl-5 text-sm">
              {m.assumptions.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          </details>
          {m.parameters.length > 0 && (
            <details>
              <summary className="cursor-pointer font-semibold text-petrol-700">Parametri ({m.parameters.length})</summary>
              <div className="mt-2 overflow-x-auto">
                <table className="table-base min-w-[36rem]">
                  <thead>
                    <tr>
                      <th scope="col">Parametro</th>
                      <th scope="col">Unità</th>
                      <th scope="col">Prudente</th>
                      <th scope="col">Centrale</th>
                      <th scope="col">Favorevole</th>
                    </tr>
                  </thead>
                  <tbody>
                    {m.parameters.map((p) => (
                      <tr key={p.key}>
                        <td>{p.label}</td>
                        <td>{p.unit}</td>
                        <td className="tabular-nums">{p.low}</td>
                        <td className="tabular-nums font-semibold">{p.central}</td>
                        <td className="tabular-nums">{p.high}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-2 text-xs text-sand-600">{m.parameters[0]?.source}</p>
              </div>
            </details>
          )}
        </section>
      ))}
    </div>
  );
}
