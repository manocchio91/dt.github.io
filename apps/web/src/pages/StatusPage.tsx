import { FEATURES, FEATURE_STATUS_LABEL, type FeatureStatus } from '@mdt/domain';
import { StatusBadge } from '../components/ui';

export function StatusPage() {
  const counts = FEATURES.reduce<Record<string, number>>((acc, f) => ({ ...acc, [f.status]: (acc[f.status] ?? 0) + 1 }), {});
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-extrabold text-petrol-900">Stato delle funzioni F01–F31</h1>
      <p className="text-sm">
        Matrice requisiti–funzioni–test della Milestone 0. Nessuna funzione è descritta come validata senza prova: le evidenze puntano a test automatici o pagine verificabili.
      </p>
      <ul className="flex flex-wrap gap-3 text-sm">
        {(Object.keys(FEATURE_STATUS_LABEL) as FeatureStatus[]).map((s) => (
          <li key={s} className="flex items-center gap-2">
            <StatusBadge status={s} /> {counts[s] ?? 0}
          </li>
        ))}
      </ul>
      <div className="card overflow-x-auto p-0">
        <table className="table-base min-w-[48rem]">
          <caption className="sr-only">Stato dei requisiti F01–F31</caption>
          <thead>
            <tr>
              <th scope="col">ID</th>
              <th scope="col">Funzione</th>
              <th scope="col">Criterio di accettazione</th>
              <th scope="col">Stato</th>
              <th scope="col">M</th>
              <th scope="col">Evidenza</th>
              <th scope="col">Cosa manca</th>
            </tr>
          </thead>
          <tbody>
            {FEATURES.map((f) => (
              <tr key={f.id}>
                <th scope="row" className="font-mono">
                  {f.id}
                </th>
                <td className="font-semibold">{f.title}</td>
                <td>
                  {f.criterion}
                  {f.traces && <span className="mt-1 block text-xs text-sand-600">Collegata a: {f.traces.join(', ')}</span>}
                </td>
                <td>
                  <StatusBadge status={f.status} />
                </td>
                <td>M{f.milestone}</td>
                <td className="text-xs">
                  {f.evidence.length ? (
                    <ul className="space-y-0.5">
                      {f.evidence.map((e) => (
                        <li key={e} className="font-mono break-all">
                          {e}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="text-xs">{f.gap || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
