import type { Position } from '@mdt/domain';
import { usePermissions } from '../state/permissions';
import { useWorkMode } from '../state/preferences';

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
export function GuideBanner({ steps, readOnlyHint }: { steps: GuideStep[]; readOnlyHint: string }) {
  const mode = useWorkMode();
  const { canEdit } = usePermissions();
  if (mode !== 'guidata') return null;
  const next = steps.find((s) => !s.done);
  const doneCount = steps.filter((s) => s.done).length;
  return (
    <aside aria-label="Guida" className="rounded-xl border-2 border-petrol-500 bg-petrol-100 p-3 text-sm text-petrol-900">
      <p className="font-bold">
        Modalità guidata · {doneCount} di {steps.length} passi fatti
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
        <p>Hai completato tutti i passi: ora puoi confrontare, decidere e motivare.</p>
      )}
      <p className="mt-1 text-xs">Puoi passare alla modalità tecnica da “Le mie preferenze”.</p>
    </aside>
  );
}
