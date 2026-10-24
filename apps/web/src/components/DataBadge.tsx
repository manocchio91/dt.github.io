import { useId, useRef, useState } from 'react';
import { DATA_CLASS_DESCRIPTION, DATA_CLASS_LABEL, type DataClass, type DataValue } from '@mdt/domain';

/** Simbolo + colore + testo: la classe non dipende solo dal colore. */
const CLASS_STYLE: Record<DataClass, { symbol: string; cls: string }> = {
  MISURATO: { symbol: '●', cls: 'bg-leaf-800 text-white' },
  OSSERVATO_DA_DATASET: { symbol: '◆', cls: 'bg-leaf-100 text-leaf-800 border border-leaf-800' },
  STIMATO_DA_MODELLO: { symbol: '≈', cls: 'bg-petrol-100 text-petrol-900 border border-petrol-700' },
  PREVISIONE: { symbol: '→', cls: 'bg-petrol-700 text-white' },
  SIMULATO: { symbol: '◇', cls: 'bg-ochre-100 text-ochre-800 border border-ochre-800' },
  INSERITO_DALL_UTENTE: { symbol: '✎', cls: 'bg-sand-100 text-sand-900 border border-sand-600' },
  DATO_MANCANTE: { symbol: '∅', cls: 'bg-alert-100 text-alert-800 border border-alert-800 border-dashed' },
};

export function ClassChip({ dataClass }: { dataClass: DataClass }) {
  const s = CLASS_STYLE[dataClass];
  return (
    <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[0.7rem] font-bold tracking-wide whitespace-nowrap ${s.cls}`}>
      <span aria-hidden="true">{s.symbol}</span>
      {DATA_CLASS_LABEL[dataClass]}
    </span>
  );
}

export function formatNumber(v: number, unit: string): string {
  const digits = Math.abs(v) >= 100 || Number.isInteger(v) ? 0 : Math.abs(v) < 1 ? 2 : 1;
  const n = v.toLocaleString('it-IT', { maximumFractionDigits: digits, minimumFractionDigits: 0 });
  return unit && unit !== '—' ? `${n} ${unit}` : n;
}

export function formatValue(d: DataValue): string {
  if (d.value === null) return 'n.d.';
  return formatNumber(d.value, d.unit);
}

export function formatRange(d: DataValue): string | null {
  if (!d.range) return null;
  return `${formatNumber(d.range[0], '')} … ${formatNumber(d.range[1], d.unit)}`;
}

function fmtDate(iso: string) {
  const t = Date.parse(iso);
  if (Number.isNaN(t) || t === 0) return 'n.d.';
  return new Intl.DateTimeFormat('it-IT', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Rome' }).format(t) + ' (Europe/Rome)';
}

/** Numero con badge di classe; il badge apre il pannello di lineage. */
export function DataBadge({ value, compact = false }: { value: DataValue; compact?: boolean }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const range = formatRange(value);
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-2 gap-y-1">
      {value.dataClass === 'DATO_MANCANTE' ? (
        <span className="font-semibold text-alert-800">Dato mancante</span>
      ) : (
        <span className="font-bold tabular-nums">{formatValue(value)}</span>
      )}
      {range && !compact && (
        <span className="text-xs text-sand-600 tabular-nums">
          {value.rangeLabel ?? 'intervallo'}: {range}
        </span>
      )}
      <button
        type="button"
        className="rounded focus-visible:outline-3"
        onClick={() => {
          setOpen(true);
          dialogRef.current?.showModal();
        }}
        aria-label={`${DATA_CLASS_LABEL[value.dataClass]} — apri provenienza di: ${value.label}`}
      >
        <ClassChip dataClass={value.dataClass} />
      </button>
      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        onClose={() => setOpen(false)}
        className="m-auto w-[min(40rem,calc(100vw-2rem))] rounded-xl border border-sand-200 p-0 shadow-xl backdrop:bg-sand-900/40"
        onClick={(e) => {
          if (e.target === dialogRef.current) dialogRef.current?.close();
        }}
      >
        {open && <LineagePanel value={value} titleId={titleId} onClose={() => dialogRef.current?.close()} />}
      </dialog>
    </span>
  );
}

export function LineagePanel({ value, titleId, onClose }: { value: DataValue; titleId: string; onClose: () => void }) {
  const l = value.lineage;
  const rows: [string, string | undefined][] = [
    ['Classe', `${DATA_CLASS_LABEL[value.dataClass]} — ${DATA_CLASS_DESCRIPTION[value.dataClass]}`],
    ['Valore', value.value === null ? `mancante: ${value.missingReason ?? ''}` : formatValue(value)],
    ['Intervallo', formatRange(value) ? `${formatRange(value)} (${value.rangeLabel ?? 'intervallo'})` : undefined],
    ['Unità', value.unit],
    ['Fonte', l.source],
    ['Endpoint / dataset', l.endpoint],
    ['Acquisizione', fmtDate(l.acquiredAt)],
    ['Licenza', l.license],
    ['Coordinate', l.coordinates === 'area' ? "riferito all'area di interesse" : l.coordinates ? `${l.coordinates.lat.toFixed(4)}, ${l.coordinates.lon.toFixed(4)} (WGS84)` : undefined],
    ['Quota', l.height],
    ['Profondità', l.depth],
    ['Risoluzione spaziale', l.spatialResolution],
    ['Risoluzione temporale', l.temporalResolution],
    ['Orizzonte previsione', l.forecastHorizon],
    ['Formula', l.formula],
    ['Modello', l.modelId ? `${l.modelId}@${l.modelVersion}` : undefined],
    ['Qualità', l.quality + (l.qualityFlags?.length ? ` — ${l.qualityFlags.join(', ')}` : '')],
    ['Uso nel calcolo', l.usage],
  ];
  return (
    <div className="max-h-[85vh] overflow-y-auto">
      <div className="sticky top-0 flex items-start justify-between gap-4 border-b border-sand-200 bg-white p-4">
        <div>
          <p className="text-xs font-semibold tracking-wide text-sand-600 uppercase">Provenienza del dato (lineage)</p>
          <h2 id={titleId} className="text-lg font-bold text-petrol-900">
            {value.label}
          </h2>
          {l.isDemo && <p className="mt-1 text-sm font-semibold text-ochre-800">DEMO — dato dimostrativo</p>}
        </div>
        <button type="button" className="btn-ghost" onClick={onClose} autoFocus>
          Chiudi
        </button>
      </div>
      <dl className="grid grid-cols-1 gap-x-4 gap-y-2 p-4 text-sm sm:grid-cols-[11rem_1fr]">
        {rows
          .filter(([, v]) => v)
          .map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="font-semibold text-sand-600">{k}</dt>
              <dd className="break-words">{v}</dd>
            </div>
          ))}
        {l.transforms.length > 0 && (
          <>
            <dt className="font-semibold text-sand-600">Trasformazioni</dt>
            <dd>
              <ul className="list-disc pl-5">
                {l.transforms.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </dd>
          </>
        )}
        <dt className="font-semibold text-sand-600">Limitazioni</dt>
        <dd>
          <ul className="list-disc pl-5">
            {l.limitations.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </dd>
      </dl>
    </div>
  );
}
