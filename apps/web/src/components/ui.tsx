import { useId, useState, type ReactNode } from 'react';
import { FEATURE_STATUS_LABEL, type FeatureStatus } from '@mdt/domain';

const STATUS_STYLE: Record<FeatureStatus, string> = {
  operativa: 'bg-leaf-800 text-white',
  beta: 'bg-petrol-700 text-white',
  dimostrativa: 'bg-ochre-100 text-ochre-800 border border-ochre-800',
  roadmap: 'bg-sand-100 text-sand-600 border border-sand-400 border-dashed',
  non_disponibile: 'bg-alert-100 text-alert-800 border border-alert-800',
};

export function StatusBadge({ status }: { status: FeatureStatus }) {
  return (
    <span className={`inline-block rounded px-2 py-0.5 text-xs font-bold whitespace-nowrap ${STATUS_STYLE[status]}`}>
      {FEATURE_STATUS_LABEL[status]}
    </span>
  );
}

export function Alert({ tone = 'info', title, children }: { tone?: 'info' | 'warn' | 'error' | 'ok'; title?: string; children: ReactNode }) {
  const styles = {
    info: 'border-petrol-500 bg-petrol-100 text-petrol-900',
    warn: 'border-ochre-500 bg-ochre-100 text-ochre-800',
    error: 'border-alert-800 bg-alert-100 text-alert-800',
    ok: 'border-leaf-600 bg-leaf-100 text-leaf-800',
  }[tone];
  const icon = { info: 'ℹ', warn: '⚠', error: '✖', ok: '✔' }[tone];
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`rounded-lg border-l-4 p-3 text-sm ${styles}`}>
      <div className="flex gap-2">
        <span aria-hidden="true" className="font-bold">
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          {title && <p className="font-bold">{title}</p>}
          <div className="space-y-1">{children}</div>
        </div>
      </div>
    </div>
  );
}

export function Section({ id, step, title, children, aside }: { id?: string; step?: number; title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section id={id} aria-labelledby={id ? `${id}-h` : undefined} className="card scroll-mt-20">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id={id ? `${id}-h` : undefined} className="h-section flex min-w-0 items-center gap-2 [overflow-wrap:anywhere]">
          {step !== undefined && (
            <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-petrol-700 text-sm text-white">{step}</span>
          )}
          {title}
        </h2>
        {aside}
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

const LEVEL_STYLE: Record<string, { cls: string; sym: string }> = {
  elevato: { cls: 'bg-alert-100 text-alert-800 border-alert-800', sym: '▲▲' },
  alta: { cls: 'bg-alert-100 text-alert-800 border-alert-800', sym: '▲▲' },
  moderato: { cls: 'bg-ochre-100 text-ochre-800 border-ochre-800', sym: '▲' },
  media: { cls: 'bg-ochre-100 text-ochre-800 border-ochre-800', sym: '▲' },
  basso: { cls: 'bg-leaf-100 text-leaf-800 border-leaf-800', sym: '▽' },
  bassa: { cls: 'bg-leaf-100 text-leaf-800 border-leaf-800', sym: '▽' },
  'non determinabile': { cls: 'bg-sand-100 text-sand-600 border-sand-400 border-dashed', sym: '?' },
};

export function LevelPill({ level, prefix }: { level: string; prefix?: string }) {
  const s = LEVEL_STYLE[level] ?? LEVEL_STYLE['non determinabile']!;
  return (
    <span className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs font-bold whitespace-nowrap ${s.cls}`}>
      <span aria-hidden="true">{s.sym}</span>
      {prefix ? `${prefix} ${level}` : level}
    </span>
  );
}

type DecisionState = 'Regolare' | 'Attenzione' | 'Critico';

const DECISION_STATE_STYLE: Record<DecisionState, string> = {
  Regolare: 'border-leaf-600 bg-leaf-100 text-leaf-800',
  Attenzione: 'border-ochre-500 bg-ochre-100 text-ochre-800',
  Critico: 'border-alert-800 bg-alert-100 text-alert-800',
};

/** Sintesi comune ai due percorsi: prima la situazione, poi gli strumenti di lavoro. */
export function DecisionOverview({
  subject,
  state,
  parameter,
  outlook,
  source,
  updated,
  nextStep,
}: {
  subject: string;
  state: DecisionState;
  parameter: string;
  outlook: string;
  source: string;
  updated: string;
  nextStep: string;
}) {
  return (
    <section className="card space-y-3" aria-labelledby="decision-overview-title" data-testid="decision-overview">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs font-bold tracking-wide text-sand-600 uppercase">Situazione attuale</p>
          <h2 id="decision-overview-title" className="text-xl font-extrabold text-petrol-900">{subject}</h2>
        </div>
        <span className={`rounded-lg border-2 px-3 py-1 text-sm font-extrabold ${DECISION_STATE_STYLE[state]}`}>
          {state}
        </span>
      </div>
      <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[10rem_1fr]">
        <dt className="font-semibold text-sand-600">Parametro principale</dt>
        <dd>{parameter}</dd>
        <dt className="font-semibold text-sand-600">Andamento previsto</dt>
        <dd>{outlook}</dd>
        <dt className="font-semibold text-sand-600">Fonte</dt>
        <dd>{source}</dd>
        <dt className="font-semibold text-sand-600">Aggiornato</dt>
        <dd>{updated}</dd>
      </dl>
      <p className="rounded bg-petrol-100 p-2 text-sm text-petrol-900"><strong>Prossimo passo:</strong> {nextStep}</p>
    </section>
  );
}

export const GLOSSARY: Record<string, string> = {
  baseline:
    'Situazione di riferimento prima dell’intervento (area, periodo, ora, dati). Una volta salvata non si modifica: ogni variazione crea una nuova versione.',
  albedo: 'Frazione della radiazione solare riflessa da una superficie (0 = assorbe tutto, 1 = riflette tutto).',
  depaving: 'Rimozione di pavimentazione impermeabile per sostituirla con verde o superfici drenanti.',
  utci: 'Universal Thermal Climate Index: indice di stress termico per le persone. Richiede temperatura media radiante e vento a quota pedone.',
  wbgt: 'Wet Bulb Globe Temperature: indice di stress da calore usato in ambito sanitario e lavorativo.',
  intervallo:
    'Intervallo illustrativo: ottenuto variando i parametri del modello tra ipotesi prudente e favorevole. Non è un intervallo di confidenza statistico.',
  aoi: 'Area of Interest: il poligono dell’area analizzata, salvato in coordinate WGS84 (EPSG:4326).',
  crs: 'Sistema di riferimento delle coordinate. L’app archivia in EPSG:4326 (latitudine/longitudine WGS84).',
  capex: 'Costo di investimento iniziale dell’intervento.',
  opex: 'Costo annuo di gestione e manutenzione.',
  fenologia: 'Fase di sviluppo della vite (es. fioritura, invaiatura). Va osservata in campo e confermata: l’app non la deduce.',
  capacita_campo: 'Contenuto d’acqua che il suolo trattiene dopo il drenaggio (m³/m³). Dipende da tessitura e struttura.',
  appassimento: 'Contenuto d’acqua sotto il quale la pianta non riesce più ad assorbire acqua (m³/m³).',
  lineage: 'Catena di provenienza di un dato: fonte, data, coordinate, trasformazioni, formula, versione, qualità e limiti.',
  griglia: 'L’area è divisa in celle regolari; per ogni cella il modello calcola l’effetto degli interventi che la coprono.',
  invaiatura: 'Fase in cui gli acini cambiano colore e inizia la maturazione.',
};

/** Termine tecnico con definizione accessibile (pulsante + regione espandibile). */
export function Term({ k, children }: { k: keyof typeof GLOSSARY | string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const def = GLOSSARY[k];
  if (!def) return <>{children}</>;
  return (
    <span className="relative inline">
      <button
        type="button"
        className="cursor-help border-b-2 border-dotted border-petrol-500 font-medium text-inherit"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
      >
        {children}
        <span className="sr-only"> (definizione)</span>
      </button>
      {open && (
        <span
          id={id}
          role="note"
          className="absolute top-full left-0 z-30 mt-1 block w-72 max-w-[80vw] rounded-lg border border-petrol-500 bg-white p-3 text-sm font-normal text-sand-900 shadow-lg"
        >
          {def}
        </span>
      )}
    </span>
  );
}

export function Field({ label, hint, children, htmlFor }: { label: ReactNode; hint?: ReactNode; children: ReactNode; htmlFor: string }) {
  return (
    <div>
      <label className="label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint && <p className="mt-1 text-xs text-sand-600">{hint}</p>}
    </div>
  );
}

export function DemoRibbon() {
  return (
    <p className="rounded-md bg-ochre-100 px-3 py-1.5 text-xs font-bold text-ochre-800">
      DEMO — stime illustrative non validate. Non utilizzabili come atto tecnico.
    </p>
  );
}
