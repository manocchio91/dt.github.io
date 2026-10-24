import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { formatArea, type ProjectBundle } from '@mdt/domain';
import { useAuth } from '../state/auth';
import { DataBadge } from '../components/DataBadge';
import { Alert, DemoRibbon, Section } from '../components/ui';

type State = { status: 'loading' } | { status: 'invalid' } | { status: 'error'; message: string } | { status: 'ok'; bundle: ProjectBundle; expiresAt: string };

/** Vista in sola lettura raggiunta da un link condiviso: nessuna modifica possibile. */
export function SharedPage() {
  const { token = '' } = useParams();
  const { client } = useAuth();
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    if (!client) return;
    client.rpc('get_shared_project', { p_token: token }).then(({ data, error }) => {
      if (error) setState({ status: 'error', message: error.message });
      else if (!data) setState({ status: 'invalid' });
      else setState({ status: 'ok', bundle: (data as { bundle: ProjectBundle }).bundle, expiresAt: (data as { expiresAt: string }).expiresAt });
    });
  }, [client, token]);

  if (!client) return <Alert tone="error">Condivisione non disponibile: archivio condiviso non configurato.</Alert>;
  if (state.status === 'loading') return <p className="card">Verifica del link…</p>;
  if (state.status === 'invalid') return <Alert tone="error" title="Link non valido">Il link è errato, scaduto o revocato.</Alert>;
  if (state.status === 'error') return <Alert tone="error">{state.message}</Alert>;

  const b = state.bundle;
  const label = (id: string) => b.scenarios.find((s) => s.id === id)?.label ?? id;
  return (
    <div className="space-y-4">
      <Alert tone="info" title="Vista in sola lettura">
        Link valido fino al {new Date(state.expiresAt).toLocaleString('it-IT', { timeZone: 'Europe/Rome' })}. L’accesso è registrato.
      </Alert>
      <h1 className="text-2xl font-extrabold text-petrol-900">{b.project.name}</h1>
      {b.project.mode === 'demo' && <DemoRibbon />}
      {b.area && (
        <p className="text-sm">
          {b.area.name} · {formatArea(b.area.areaM2)} · {b.area.crs}
        </p>
      )}
      {b.baselines.map((bl) => (
        <Section key={bl.id} title={`Baseline v${bl.version} — ${bl.periodStart} → ${bl.periodEnd}, ore ${bl.referenceHourLocal}:00`}>
          <ul className="space-y-1 text-sm">
            {bl.values.map((v) => (
              <li key={v.key}>
                {v.label}: <DataBadge value={v} />
              </li>
            ))}
          </ul>
        </Section>
      ))}
      {b.runs.filter((r) => r.outputs.length).length > 0 && (
        <Section title="Risultati degli scenari">
          {b.runs
            .filter((r) => r.outputs.length)
            .map((r) => (
              <div key={r.scenarioId} className="space-y-1">
                <h3 className="font-bold">Scenario {label(r.scenarioId)}</h3>
                <ul className="text-sm">
                  {r.outputs.map((o) => (
                    <li key={o.key}>
                      {o.label}: <DataBadge value={o} />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
        </Section>
      )}
      {b.decisions.length > 0 && (
        <Section title="Decisioni">
          <ul className="space-y-2 text-sm">
            {b.decisions.map((d) => (
              <li key={d.id}>
                <strong>{d.outcome}</strong>
                {d.chosen && ` — ${label(d.chosen)}`}: {d.rationale} <span className="text-xs text-sand-600">({d.author})</span>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}
