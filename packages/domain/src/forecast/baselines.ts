import { assertValidRequest, futureTimestamps, requestHash } from './validate';
import { QUANTILE_LEVELS, type ForecastModelMeta, type ForecastRequest, type ForecastResult, type TimeSeriesForecastAdapter } from './types';

/**
 * Baseline statistiche obbligatorie di confronto. Deterministiche, leggere,
 * eseguibili nel browser. Gli intervalli sono quantili empirici degli errori
 * storici dello stesso metodo sul contesto (nessun dato futuro).
 */

function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

const finite = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v);

function lastFinite(values: readonly (number | null)[]): { value: number; index: number } {
  for (let i = values.length - 1; i >= 0; i--) if (finite(values[i])) return { value: values[i] as number, index: i };
  throw new Error('nessun valore disponibile');
}

const round4 = (x: number) => Math.round(x * 1e4) / 1e4;

function build(meta: ForecastModelMeta, req: ForecastRequest, perTarget: (values: (number | null)[]) => { median: number[]; quantiles: number[][]; warnings: string[] }): ForecastResult {
  assertValidRequest(req);
  const t0 = performance.now();
  const median: number[][] = [];
  const quantiles: number[][][] = [];
  const warnings: string[] = [];
  for (const s of req.targets) {
    const r = perTarget(s.values);
    median.push(r.median.map(round4));
    quantiles.push(r.quantiles.map((row) => row.map(round4)));
    warnings.push(...r.warnings.map((w) => `${s.variable}: ${w}`));
  }
  return {
    model: meta,
    timestamps: futureTimestamps(req.targets[0]!.timestamps.at(-1)!, req.horizon),
    median,
    quantiles,
    levels: QUANTILE_LEVELS,
    inferenceMs: Math.round(performance.now() - t0),
    warnings,
    dataClass: meta.kind === 'demo' ? 'SIMULATO' : 'STIMATO_DA_MODELLO',
    inputHash: requestHash(req, meta.id, meta.revision),
  };
}

/** Errori empirici del metodo a passo h sul contesto, ordinati. */
function residuals(values: readonly (number | null)[], lag: (h: number) => number, h: number): number[] {
  const L = lag(h);
  const out: number[] = [];
  for (let t = L; t < values.length; t++) {
    const a = values[t];
    const b = values[t - L];
    if (finite(a) && finite(b)) out.push(a - b);
  }
  return out.sort((x, y) => x - y);
}

export const PERSISTENCE_META: ForecastModelMeta = {
  id: 'baseline-persistenza',
  name: 'Persistenza (ultimo valore)',
  version: '1.0.0',
  revision: 'n/a',
  kind: 'baseline',
  status: 'beta',
  license: 'codice del progetto',
  applicability: 'Riferimento minimo: ogni modello deve fare meglio di così per essere utile.',
  limitations: ['Ignora il ciclo giornaliero e le covariate.'],
};

export class NaivePersistenceAdapter implements TimeSeriesForecastAdapter {
  readonly meta = PERSISTENCE_META;
  async forecast(req: ForecastRequest): Promise<ForecastResult> {
    return build(this.meta, req, (values) => {
      const last = lastFinite(values);
      const median: number[] = [];
      const q: number[][] = [];
      for (let h = 1; h <= req.horizon; h++) {
        const r = residuals(values, () => h, h);
        const off = quantile(r, 0.5);
        median.push(last.value + off);
        q.push(QUANTILE_LEVELS.map((l) => last.value + quantile(r, l)));
      }
      return { median, quantiles: q, warnings: last.index < values.length - 1 ? ['ultimo valore mancante: usato il precedente'] : [] };
    });
  }
}

export const SEASONAL_META: ForecastModelMeta = {
  id: 'baseline-persistenza-stagionale',
  name: 'Persistenza stagionale (stessa ora del giorno prima)',
  version: '1.0.0',
  revision: 'n/a',
  kind: 'baseline',
  status: 'beta',
  license: 'codice del progetto',
  applicability: 'Serie orarie con ciclo giornaliero (temperature, radiazione).',
  limitations: ['Non anticipa cambi di tempo; intervalli dagli errori storici del metodo.'],
};

export class SeasonalNaiveAdapter implements TimeSeriesForecastAdapter {
  readonly meta = SEASONAL_META;
  constructor(private readonly period = 24) {}
  async forecast(req: ForecastRequest): Promise<ForecastResult> {
    const m = this.period;
    return build(this.meta, req, (values) => {
      const T = values.length;
      const median: number[] = [];
      const q: number[][] = [];
      const warnings: string[] = [];
      for (let h = 1; h <= req.horizon; h++) {
        const k = Math.ceil(h / m);
        let idx = T - k * m + ((h - 1) % m);
        let base = values[idx];
        // se manca il valore della stessa ora, risale di un periodo
        let back = 0;
        while (!finite(base) && idx - m >= 0 && back < 7) {
          idx -= m;
          base = values[idx];
          back++;
        }
        if (!finite(base)) {
          base = lastFinite(values).value;
          warnings.push(`passo ${h}: nessun valore stagionale, usata la persistenza`);
        }
        const r = residuals(values, () => k * m, h);
        median.push((base as number) + quantile(r, 0.5));
        q.push(QUANTILE_LEVELS.map((l) => (base as number) + quantile(r, l)));
      }
      return { median, quantiles: q, warnings };
    });
  }
}

/** Solo fixture e modalità dimostrativa: ripete un risultato registrato, sempre marcato SIMULATO. */
export class DemoForecastAdapter implements TimeSeriesForecastAdapter {
  readonly meta: ForecastModelMeta;
  constructor(private readonly fixture: Pick<ForecastResult, 'median' | 'quantiles' | 'timestamps'>) {
    this.meta = { id: 'demo-fixture', name: 'Previsione dimostrativa registrata', version: '0', revision: 'fixture', kind: 'demo', status: 'demo', license: 'dati dimostrativi', applicability: 'Solo test e dimostrazione.', limitations: ['Valori SIMULATI, non prodotti da un modello sui dati attuali.'] };
  }
  async forecast(req: ForecastRequest): Promise<ForecastResult> {
    return { ...build(this.meta, req, () => ({ median: [], quantiles: [], warnings: [] })), ...this.fixture, dataClass: 'SIMULATO' };
  }
}
