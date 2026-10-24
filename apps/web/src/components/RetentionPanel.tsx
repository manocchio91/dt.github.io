import { useEffect, useState } from 'react';
import { MEDIA_CATEGORY_LABEL, type MediaRecord } from '@mdt/domain';
import { useMediaStores } from '../state/useMedia';
import { Alert, Section } from './ui';

/**
 * B-125 — Anteprima per gli amministratori dei file in scadenza (30 giorni) e
 * modifica della data di fine conservazione. L'eliminazione a scadenza è fatta
 * dal job pianificato lato server (media-retention), non dal browser.
 */
export function RetentionPanel({ organizationId, records, onChanged }: { organizationId: string; records: MediaRecord[]; onChanged: () => void }) {
  const { remote } = useMediaStores();
  const [expiring, setExpiring] = useState<{ id: string; retentionUntil: string }[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const today = new Date().toISOString().slice(0, 10);

  useEffect(() => {
    if (!remote) return;
    remote
      .expiring(30)
      .then(setExpiring)
      .catch((e: Error) => setMsg(e.message));
  }, [remote, organizationId, records]);

  if (!remote) return null;
  const mine = expiring.map((e) => ({ ...e, record: records.find((r) => r.id === e.id) })).filter((e) => e.record);

  return (
    <Section title="Conservazione (amministratori)">
      <p className="text-sm">
        I file vengono eliminati automaticamente dopo la data di fine conservazione dal servizio pianificato del server. Qui vedi quelli in scadenza nei prossimi 30 giorni e puoi prorogarli.
      </p>
      {msg && <Alert tone="info">{msg}</Alert>}
      {mine.length === 0 ? (
        <p className="text-sm text-sand-600">Nessun file di questo progetto in scadenza nei prossimi 30 giorni.</p>
      ) : (
        <table className="table-base">
          <caption className="sr-only">File in scadenza</caption>
          <thead>
            <tr>
              <th scope="col">File</th>
              <th scope="col">Scade il</th>
              <th scope="col">Nuova data</th>
            </tr>
          </thead>
          <tbody>
            {mine.map(({ id, retentionUntil, record }) => (
              <tr key={id}>
                <td>
                  {MEDIA_CATEGORY_LABEL[record!.category].title} — {record!.description || record!.originalName}
                </td>
                <td>{retentionUntil}</td>
                <td>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="date"
                      className="input w-44"
                      min={today}
                      aria-label={`Nuova data di fine conservazione per ${record!.originalName}`}
                      value={edits[id] ?? ''}
                      onChange={(e) => setEdits({ ...edits, [id]: e.target.value })}
                    />
                    <button
                      type="button"
                      className="btn-secondary"
                      disabled={!edits[id]}
                      onClick={async () => {
                        try {
                          await remote.setRetention(record!, edits[id]!);
                          setMsg('Data di conservazione aggiornata (registrata nell’audit).');
                          onChanged();
                        } catch (e) {
                          setMsg((e as Error).message);
                        }
                      }}
                    >
                      Proroga
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Section>
  );
}
