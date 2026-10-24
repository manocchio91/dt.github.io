import { useId, useState, type KeyboardEvent } from 'react';
import { formatNumber } from './DataBadge';
import { fmtHour } from '../state/forecast';

export interface ChartForecast {
  timestamps: string[];
  median: number[];
  lower: number[];
  upper: number[];
  probabilities?: number[];
}

/**
 * Grafico accessibile: storico, separatore "ora", mediana, banda, soglia e
 * osservazione successiva. Ogni elemento ha un tratto/motivo distinto (non solo
 * colore), la legenda è testuale, il cursore si sposta con le frecce e il valore
 * corrente è annunciato agli screen reader. La tabella equivalente è nel pannello.
 */
export function ForecastChart(props: {
  unit: string;
  history: { timestamps: string[]; values: (number | null)[] };
  forecast: ChartForecast | null;
  observed?: (number | null)[] | null;
  threshold?: { value: number; label: string } | null;
  bandLabel: string;
  title: string;
}) {
  const { unit, history, forecast, observed, threshold, bandLabel, title } = props;
  const [cursor, setCursor] = useState<number | null>(null);
  const uid = useId().replace(/:/g, '');
  const W = 720;
  const H = 300;
  const pad = { l: 56, r: 16, t: 26, b: 40 };
  const nH = history.timestamps.length;
  const nF = forecast?.timestamps.length ?? 0;
  const n = nH + Math.max(nF, observed?.length ?? 0);
  const vals = [
    ...history.values,
    ...(forecast ? [...forecast.lower, ...forecast.upper] : []),
    ...(observed ?? []),
    ...(threshold ? [threshold.value] : []),
  ].filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  const lo = vals.length ? Math.min(...vals) : 0;
  const hi = vals.length ? Math.max(...vals) : 1;
  const span = hi - lo || 1;
  const y0 = lo - span * 0.08;
  const y1 = hi + span * 0.08;
  const x = (i: number) => pad.l + (i / Math.max(1, n - 1)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - (v - y0) / (y1 - y0)) * (H - pad.t - pad.b);
  const path = (pts: [number, number | null][]) =>
    pts.reduce((acc, [i, v], k) => (v === null || !Number.isFinite(v) ? acc : acc + `${acc === '' || pts[k - 1]?.[1] === null ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`), '');
  const nowX = x(nH - 0.5);
  const ticks = Array.from({ length: 5 }, (_, k) => y0 + ((y1 - y0) * k) / 4);
  // decimali sufficienti a distinguere le tacche (es. umidità del suolo in m³/m³)
  const digits = Math.max(0, Math.min(4, Math.ceil(-Math.log10((y1 - y0) / 4)) + 1));
  const tick = (v: number) => v.toLocaleString('it-IT', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const dayTicks: number[] = [];
  const all = [...history.timestamps, ...(forecast?.timestamps ?? [])];
  all.forEach((t, i) => {
    if (new Intl.DateTimeFormat('it-IT', { hour: '2-digit', hourCycle: 'h23', timeZone: 'Europe/Rome' }).format(Date.parse(t)) === '00') dayTicks.push(i);
  });

  const fi = cursor !== null && cursor >= nH ? cursor - nH : null;
  const announce =
    cursor === null
      ? ''
      : cursor < nH
        ? `${fmtHour(history.timestamps[cursor]!)}: storico ${history.values[cursor] == null ? 'mancante' : formatNumber(history.values[cursor]!, unit)}`
        : forecast && fi !== null && fi < nF
          ? `${fmtHour(forecast.timestamps[fi]!)}: mediana ${formatNumber(forecast.median[fi]!, unit)}, ${bandLabel} da ${formatNumber(forecast.lower[fi]!, '')} a ${formatNumber(forecast.upper[fi]!, unit)}${
              forecast.probabilities ? `, probabilità di superare la soglia ${Math.round(forecast.probabilities[fi]! * 100)}%` : ''
            }${observed && observed[fi] != null ? `, osservato ${formatNumber(observed[fi]!, unit)}` : ''}`
          : '';

  const onKey = (e: KeyboardEvent) => {
    const last = nH + nF - 1;
    if (e.key === 'ArrowRight') setCursor((c) => Math.min(last, (c ?? nH - 1) + 1));
    else if (e.key === 'ArrowLeft') setCursor((c) => Math.max(0, (c ?? nH) - 1));
    else if (e.key === 'Home') setCursor(nH);
    else if (e.key === 'End') setCursor(last);
    else if (e.key === 'Escape') setCursor(null);
    else return;
    e.preventDefault();
  };

  return (
    <figure className="space-y-2">
      <div
        tabIndex={0}
        role="group"
        aria-roledescription="grafico interattivo"
        aria-label={`${title}. Usa le frecce sinistra e destra per scorrere le ore, Inizio per la prima ora prevista, Esc per uscire.`}
        onKeyDown={onKey}
        onBlur={() => setCursor(null)}
        className="rounded-lg focus-visible:outline-3 focus-visible:outline-petrol-500"
      >
        <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" aria-hidden="true">
          <defs>
            <pattern id={`hatch-${uid}`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="6" height="6" fill="var(--color-petrol-100, #dcecef)" />
              <line x1="0" y1="0" x2="0" y2="6" stroke="var(--color-petrol-500, #3d8a96)" strokeWidth="1.5" />
            </pattern>
          </defs>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="#e5e0d8" />
              <text x={pad.l - 6} y={y(t) + 4} textAnchor="end" fontSize="11" fill="#6b6257">
                {tick(t)}
              </text>
            </g>
          ))}
          {dayTicks.filter((i) => x(i) < W - pad.r - 40).map((i) => (
            <g key={i}>
              <line x1={x(i)} x2={x(i)} y1={pad.t} y2={H - pad.b} stroke="#efebe4" />
              <text x={x(i) + 3} y={H - pad.b + 14} fontSize="11" fill="#6b6257">
                {new Intl.DateTimeFormat('it-IT', { day: '2-digit', month: 'short', timeZone: 'Europe/Rome' }).format(Date.parse(all[i]!))}
              </text>
            </g>
          ))}
          <text x={pad.l - 6} y={12} textAnchor="end" fontSize="11" fill="#6b6257">
            {unit}
          </text>
          {forecast && (
            <path
              d={
                forecast.upper.map((v, i) => `${i ? 'L' : 'M'}${x(nH + i).toFixed(1)},${y(v).toFixed(1)}`).join('') +
                forecast.lower
                  .map((v, i) => [i, v] as const)
                  .reverse()
                  .map(([i, v]) => `L${x(nH + i).toFixed(1)},${y(v).toFixed(1)}`)
                  .join('') +
                'Z'
              }
              fill={`url(#hatch-${uid})`}
              stroke="var(--color-petrol-500, #3d8a96)"
              strokeWidth="1"
              opacity="0.9"
            />
          )}
          <path d={path(history.values.map((v, i) => [i, v]))} fill="none" stroke="#2b2620" strokeWidth="2" />
          {forecast && <path d={path(forecast.median.map((v, i) => [nH + i, v]))} fill="none" stroke="var(--color-petrol-900, #12434b)" strokeWidth="2.5" strokeDasharray="7 4" />}
          {observed && (
            <g>
              <path d={path(observed.map((v, i) => [nH + i, v]))} fill="none" stroke="#7a4b00" strokeWidth="1.5" strokeDasharray="1 3" />
              {observed.map((v, i) => (v == null || i % 3 ? null : <circle key={i} cx={x(nH + i)} cy={y(v)} r="2.5" fill="#7a4b00" />))}
            </g>
          )}
          {threshold && (
            <g>
              <line x1={pad.l} x2={W - pad.r} y1={y(threshold.value)} y2={y(threshold.value)} stroke="#a3271b" strokeWidth="1.5" strokeDasharray="10 3 2 3" />
              <text x={W - pad.r - 4} y={y(threshold.value) - 5} textAnchor="end" fontSize="11" fill="#a3271b">
                {threshold.label}
              </text>
            </g>
          )}
          <line x1={nowX} x2={nowX} y1={pad.t} y2={H - pad.b} stroke="#2b2620" strokeWidth="1.5" />
          <text x={nowX + 4} y={pad.t + 12} fontSize="12" fontWeight="700" fill="#2b2620">
            ora
          </text>
          {cursor !== null && <line x1={x(cursor)} x2={x(cursor)} y1={pad.t} y2={H - pad.b} stroke="#3d8a96" strokeWidth="2" />}
        </svg>
      </div>
      <p aria-live="polite" className="min-h-5 text-sm font-semibold tabular-nums">
        {announce}
      </p>
      <figcaption>
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs" aria-label="Legenda">
          <li>
            <span aria-hidden="true" className="font-bold">━</span> storico (rianalisi, stima da modello)
          </li>
          <li>
            <span aria-hidden="true" className="font-bold">┃</span> ora: emissione della previsione
          </li>
          <li>
            <span aria-hidden="true" className="font-bold text-petrol-900">╍╍</span> mediana prevista (50%)
          </li>
          <li>
            <span aria-hidden="true" className="font-bold text-petrol-700">▨</span> {bandLabel}
          </li>
          {threshold && (
            <li>
              <span aria-hidden="true" className="font-bold text-alert-800">─·─</span> soglia: {threshold.label}
            </li>
          )}
          {observed && (
            <li>
              <span aria-hidden="true" className="font-bold text-ochre-800">··•··</span> osservazione successiva (rianalisi)
            </li>
          )}
        </ul>
      </figcaption>
    </figure>
  );
}
