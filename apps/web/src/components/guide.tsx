import { Link } from 'react-router-dom';
import type { Position } from '@mdt/domain';
import { usePermissions } from '../state/permissions';
import { useWorkMode } from '../state/preferences';

/** Percorso principale, uguale per città e campagna. */
export const MAIN_PATH = [
  'Crea o scegli il progetto',
  'Seleziona l’area o la parcella',
  'Osserva gli indicatori',
  'Individua la criticità',
  'Confronta gli scenari',
  'Registra la decisione',
  'Verifica il risultato',
] as const;

export interface PathPosition {
  /** passo (1–7) o intervallo di passi coperti dalla pagina */
  step: number | [number, number];
  what: string;
  why: string;
  next?: { label: string; to: string };
}

function stepLabel(step: PathPosition['step']): string {
  const [a, b] = Array.isArray(step) ? step : [step, step];
  return a === b ? `Passo ${a} di ${MAIN_PATH.length} · ${MAIN_PATH[a - 1]}` : `Passi ${a}–${b} di ${MAIN_PATH.length} · ${MAIN_PATH[a - 1]} e ${MAIN_PATH[b - 1]!.toLowerCase()}`;
}

function PathHeader({ where }: { where: PathPosition }) {
  const [a, b] = Array.isArray(where.step) ? where.step : [where.step, where.step];
  return (
    <>
      <p className="font-bold">{stepLabel(where.step)}</p>
      <ol className="my-1 flex gap-1" aria-hidden="true">
        {MAIN_PATH.map((l, i) => (
          <li key={l} className={`h-1.5 flex-1 rounded ${i + 1 < a ? 'bg-petrol-500' : i + 1 <= b ? 'bg-petrol-900' : 'bg-sand-200'}`} />
        ))}
      </ol>
      <p>
        <strong>Cosa osservi:</strong> {where.what}
      </p>
      <p>
        <strong>Perché conta:</strong> {where.why}
      </p>
    </>
  );
}

/**
 * Modalità guidata: dove si trova l'utente nel percorso, cosa osserva, perché conta e il
 * prossimo passo. In modalità tecnica non appare.
 */
export function PathGuide({ where }: { where: PathPosition }) {
  const mode = useWorkMode();
  if (mode !== 'guidata') return null;
  return (
    <aside aria-label="Dove ti trovi" data-testid="path-guide" className="rounded-xl border-2 border-petrol-500 bg-petrol-100 p-3 text-sm text-petrol-900">
      <PathHeader where={where} />
      {where.next && (
        <p>
          <strong>Prossimo passo:</strong>{' '}
          <Link to={where.next.to} className="font-semibold underline">
            {where.next.label}
          </Link>
        </p>
      )}
    </aside>
  );
}

/** Coordinate inserite da tastiera: una per riga, "latitudine, longitudine". */
export function parseCoordinates(text: string): { vertices: Position[]; error: string | null } {
  const vertices: Position[] = [];
  const lines = text
    .split(/\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  for (const [i, l] of lines.entries()) {
    const parts = l.split(/[,;\s]+/).map(Number);
    if (parts.length < 2 || parts.some((n) => !Number.isFinite(n))) return { vertices: [], error: `Riga ${i + 1}: usa il formato "latitudine, longitudine".` };
    vertices.push([parts[1]!, parts[0]!]);
  }
  if (vertices.length === 0) return { vertices, error: 'Inserisci almeno una coppia di coordinate.' };
  return { vertices, error: null };
}

export interface GuideStep {
  done: boolean;
  label: string;
  anchor: string;
}

/**
 * Modalità guidata: indica il prossimo passo da fare, in linguaggio semplice.
 * In modalità tecnica non appare (i dettagli sono già aperti).
 */
export function GuideBanner({ steps, readOnlyHint, where, whenDone }: { steps: GuideStep[]; readOnlyHint: string; where?: PathPosition; whenDone?: { label: string; to: string } }) {
  const mode = useWorkMode();
  const { canEdit } = usePermissions();
  if (mode !== 'guidata') return null;
  const next = steps.find((s) => !s.done);
  const doneCount = steps.filter((s) => s.done).length;
  return (
    <aside aria-label="Guida" data-testid="path-guide" className="rounded-xl border-2 border-petrol-500 bg-petrol-100 p-3 text-sm text-petrol-900">
      {where && <PathHeader where={where} />}
      <p className={where ? 'mt-1 font-semibold' : 'font-bold'}>
        {where ? 'In questa pagina' : 'Modalità guidata'} · {doneCount} di {steps.length} attività fatte
      </p>
      {!canEdit ? (
        <p>{readOnlyHint}</p>
      ) : next ? (
        <p>
          Prossimo passo:{' '}
          <a href={`#${next.anchor}`} className="font-semibold underline">
            {next.label}
          </a>
        </p>
      ) : (
        <p>
          Hai completato le attività di questa pagina.
          {whenDone && (
            <>
              {' '}
              Prossimo passo:{' '}
              {whenDone.to.startsWith('#') ? (
                <a href={whenDone.to} className="font-semibold underline">
                  {whenDone.label}
                </a>
              ) : (
                <Link to={whenDone.to} className="font-semibold underline">
                  {whenDone.label}
                </Link>
              )}
            </>
          )}
        </p>
      )}
      <p className="mt-1 text-xs">Puoi passare alla modalità tecnica da “Le mie preferenze”.</p>
    </aside>
  );
}
