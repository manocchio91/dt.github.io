import { useId } from 'react';
import { CONFLICT_MESSAGE, type ConflictInfo } from '../state/supabaseRepository';

const fmt = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat('it-IT', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Rome' }).format(Date.parse(iso)) : 'non disponibile';

/**
 * Conflitto di salvataggio: un solo messaggio, un'azione principale (ricaricare) e una secondaria.
 * Nessun salvataggio automatico: il lavoro dell'altra persona non viene sovrascritto.
 * I dettagli tecnici restano chiusi finché l'utente non li apre.
 */
export function ConflictNotice({ info, onReload, onCancel, busy = false }: { info: ConflictInfo; onReload: () => void; onCancel: () => void; busy?: boolean }) {
  const id = useId();
  return (
    <section aria-labelledby={`${id}-t`} className="rounded-md border-2 border-ochre-500 bg-ochre-100 p-3 text-sm text-ochre-800" data-testid="conflict-notice">
      <p id={`${id}-t`} role="alert" className="flex gap-2 font-semibold">
        <span aria-hidden="true">⚠</span>
        <span>{CONFLICT_MESSAGE}</span>
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" className="btn-primary" onClick={onReload} disabled={busy}>
          {busy ? 'Ricarico…' : 'Ricarica progetto'}
        </button>
        <button type="button" className="btn-secondary" onClick={onCancel} disabled={busy}>
          Annulla
        </button>
      </div>
      <details className="mt-2">
        <summary className="cursor-pointer text-xs font-semibold">Dettagli tecnici</summary>
        <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
          <dt>Ultima versione salvata</dt>
          <dd>{fmt(info.aggiornatoIl)}</dd>
          <dt>Versione attesa</dt>
          <dd>{info.versioneAttesa ?? 'n.d.'}</dd>
          <dt>Versione trovata</dt>
          <dd>{info.versioneTrovata ?? 'n.d.'}</dd>
          <dt>Codice conflitto</dt>
          <dd className="font-mono">{info.codice}</dd>
        </dl>
      </details>
    </section>
  );
}
