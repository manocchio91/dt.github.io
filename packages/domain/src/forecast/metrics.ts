import { QUANTILE_LEVELS, MEDIAN_INDEX } from './types';

/**
 * Metriche di valutazione probabilistica. Tutte ignorano gli istanti con
 * osservazione mancante e lo dichiarano nel conteggio `n`.
 */

const ok = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v);

export function mae(pred: readonly number[], obs: readonly (number | null)[]): { value: number; n: number } {
  let s = 0;
  let n = 0;
  pred.forEach((p, i) => {
    const o = obs[i];
    if (ok(o)) {
      s += Math.abs(p - o);
      n++;
    }
  });
  return { value: n ? s / n : NaN, n };
}

/** Scala MASE: errore medio della persistenza stagionale (periodo m) sullo storico. */
export function maseScale(history: readonly (number | null)[], m = 24): number {
  let s = 0;
  let n = 0;
  for (let t = m; t < history.length; t++) {
    const a = history[t];
    const b = history[t - m];
    if (ok(a) && ok(b)) {
      s += Math.abs(a - b);
      n++;
    }
  }
  return n ? s / n : NaN;
}

export function pinball(q: number, level: number, y: number): number {
  const d = y - q;
  return d >= 0 ? level * d : (level - 1) * d;
}

/** Pinball medio su tutti i livelli e istanti. */
export function meanPinball(quantiles: readonly (readonly number[])[], obs: readonly (number | null)[], levels: readonly number[] = QUANTILE_LEVELS): number {
  let s = 0;
  let n = 0;
  quantiles.forEach((row, i) => {
    const y = obs[i];
    if (!ok(y)) return;
    row.forEach((q, j) => {
      s += pinball(q, levels[j]!, y);
      n++;
    });
  });
  return n ? s / n : NaN;
}

/** Weighted Quantile Loss (come in GIFT-Eval): 2·Σ pinball / Σ|y|, media sui livelli. */
export function wql(quantiles: readonly (readonly number[])[], obs: readonly (number | null)[], levels: readonly number[] = QUANTILE_LEVELS): number {
  let denom = 0;
  quantiles.forEach((_, i) => {
    const y = obs[i];
    if (ok(y)) denom += Math.abs(y);
  });
  if (!denom) return NaN;
  let total = 0;
  levels.forEach((l, j) => {
    let s = 0;
    quantiles.forEach((row, i) => {
      const y = obs[i];
      if (ok(y)) s += pinball(row[j]!, l, y);
    });
    total += (2 * s) / denom;
  });
  return total / levels.length;
}

/** Frazione di osservazioni dentro l'intervallo tra i livelli lo e hi (attesa: hi − lo). */
export function coverage(quantiles: readonly (readonly number[])[], obs: readonly (number | null)[], lo: number, hi: number, levels: readonly number[] = QUANTILE_LEVELS): { value: number; n: number; expected: number } {
  const il = levels.indexOf(lo);
  const ih = levels.indexOf(hi);
  if (il < 0 || ih < 0) throw new Error('livelli non disponibili');
  let inside = 0;
  let n = 0;
  quantiles.forEach((row, i) => {
    const y = obs[i];
    if (!ok(y)) return;
    n++;
    if (y >= row[il]! && y <= row[ih]!) inside++;
  });
  return { value: n ? inside / n : NaN, n, expected: Math.round((hi - lo) * 100) / 100 };
}

/** Probabilità stimata che il valore superi (o scenda sotto) una soglia, interpolando i quantili. */
export function exceedanceProbability(row: readonly number[], threshold: number, direction: 'sopra' | 'sotto', levels: readonly number[] = QUANTILE_LEVELS): number {
  // CDF(threshold) per interpolazione lineare tra i quantili
  let cdf: number;
  if (threshold <= row[0]!) cdf = levels[0]! * (threshold < row[0]! ? 0.5 : 1);
  else if (threshold >= row[row.length - 1]!) cdf = 1 - (1 - levels[levels.length - 1]!) * (threshold > row[row.length - 1]! ? 0.5 : 1);
  else {
    let j = 0;
    while (j < row.length - 1 && row[j + 1]! < threshold) j++;
    const a = row[j]!;
    const b = row[j + 1]!;
    const f = b > a ? (threshold - a) / (b - a) : 0;
    cdf = levels[j]! + f * (levels[j + 1]! - levels[j]!);
  }
  const p = direction === 'sopra' ? 1 - cdf : cdf;
  return Math.min(1, Math.max(0, Math.round(p * 1000) / 1000));
}

export interface AlertRule {
  threshold: number;
  direction: 'sopra' | 'sotto';
  /** probabilità minima per segnalare (decisa dall'esperto) */
  minProbability: number;
}

/** Allarmi previsti contro eventi osservati, per stimare falsi allarmi e criticità mancate. */
export function alertConfusion(forecasts: readonly (readonly (readonly number[])[])[], observed: readonly (readonly (number | null)[])[], rule: AlertRule) {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let tn = 0;
  forecasts.forEach((rows, k) => {
    const alarm = rows.some((row) => exceedanceProbability(row, rule.threshold, rule.direction) >= rule.minProbability);
    const obs = observed[k]!.filter(ok);
    if (obs.length === 0) return;
    const event = obs.some((y) => (rule.direction === 'sopra' ? y > rule.threshold : y < rule.threshold));
    if (alarm && event) tp++;
    else if (alarm) fp++;
    else if (event) fn++;
    else tn++;
  });
  return { veriPositivi: tp, falsiAllarmi: fp, criticitaMancate: fn, veriNegativi: tn };
}

/** Controlla che i quantili siano ordinati e non incrociati, e che la mediana sia il livello 0,5. */
export function checkQuantiles(rows: readonly (readonly number[])[], median: readonly number[], levels: readonly number[] = QUANTILE_LEVELS): string[] {
  const p: string[] = [];
  if (levels.length !== 21) p.push(`Attesi 21 livelli di quantile, ricevuti ${levels.length}.`);
  rows.forEach((row, h) => {
    if (row.length !== levels.length) p.push(`Passo ${h + 1}: ${row.length} quantili invece di ${levels.length}.`);
    for (let j = 1; j < row.length; j++) if (row[j]! < row[j - 1]! - 1e-9) {
      p.push(`Passo ${h + 1}: quantili incrociati.`);
      break;
    }
    if (Math.abs(row[MEDIAN_INDEX]! - median[h]!) > 1e-6 * Math.max(1, Math.abs(median[h]!))) p.push(`Passo ${h + 1}: mediana diversa dal quantile 0,5.`);
    if (row.some((x) => !Number.isFinite(x))) p.push(`Passo ${h + 1}: valori non finiti.`);
  });
  return p;
}
