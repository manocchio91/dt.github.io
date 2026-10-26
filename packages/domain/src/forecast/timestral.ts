import { checkQuantiles } from './metrics';
import { assertValidRequest, futureTimestamps, requestHash } from './validate';
import { ForecastUnavailableError, QUANTILE_LEVELS, type ForecastModelMeta, type ForecastRequest, type ForecastResult, type PhysicalConstraintReport, type TimeSeriesForecastAdapter } from './types';

/**
 * Adapter verso il servizio di inferenza Timestral (services/forecasting).
 * Il modello non gira nel browser. Nessun ripiego silenzioso: se il servizio
 * non è configurato o non risponde, l'errore è esplicito.
 *
 * Fonti ufficiali: codice github.com/mistralai/timestral (Apache-2.0),
 * pesi huggingface.co/mistralai/Timestral-5M e -28M (licenza Modified MIT).
 */
export const TIMESTRAL_MODELS = {
  'mistralai/Timestral-5M': { revision: 'bdd20cfc15a3fea0e4cb5ccef37f8d3ca7aa335f', sizeMb: 21 },
  'mistralai/Timestral-28M': { revision: '49b26409ac87b5935539a5d8ffe7f397b720db47', sizeMb: 111 },
} as const;
export type TimestralModelId = keyof typeof TIMESTRAL_MODELS;
export const TIMESTRAL_CODE_COMMIT = 'a534bdbd244d64f3d9d743f46c7bf6fc330ed4ff';
export const FORECAST_SCHEMA_VERSION = 1;
/** Limiti fisici delle grandezze vincolate dal servizio (stessa tabella del proxy, PHYSICAL_BOUNDS). */
export const PHYSICAL_LIMITS: Record<string, [number, number]> = { umidita_relativa: [0, 100], relative_humidity_2m: [0, 100] };

export function timestralMeta(model: TimestralModelId): ForecastModelMeta {
  return {
    id: model,
    name: model.split('/').pop()!, // "Timestral-5M": nome ufficiale, uguale nel badge e nei dettagli
    version: '1.0.0',
    revision: TIMESTRAL_MODELS[model].revision,
    kind: 'timestral',
    status: 'beta',
    license: 'Codice: Apache-2.0 · Pesi: Modified MIT (Hugging Face)',
    applicability: 'Previsione probabilistica zero-shot di serie orarie; da validare sul dominio con backtest locale prima di influire sulle decisioni.',
    limitations: [
      'Non misura, non diagnostica, non prescrive.',
      'Non calcola l’effetto causale degli interventi (alberi, depaving, schermature).',
      'I benchmark pubblici di Mistral non provano l’efficacia sul Molise.',
    ],
  };
}

export interface TimestralConfig {
  /** URL del servizio (o del proxy autenticato); assente = motore non configurato */
  baseUrl: string | null | undefined;
  model: TimestralModelId;
  /** intestazione di autorizzazione (token del proxy o della sessione), mai una chiave nel bundle */
  authorization?: () => Promise<string | null> | string | null;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  cache?: Map<string, ForecastResult>;
  /**
   * Metadati per il proxy (progetto, contesto, variabili, provenienza) inviati come campo `mdt`:
   * il proxy li usa per autorizzare e registrare l'esecuzione e li toglie prima del servizio.
   */
  envelope?: (req: ForecastRequest) => Record<string, unknown> | null;
}

interface ServiceResponse {
  schema_version: number;
  model: string;
  revision: string;
  quantile_levels: number[];
  quantiles: number[][][][]; // (series, variates, horizon, 21)
  median: number[][][];
  inference_ms: number;
  warnings: string[];
  adapter_version?: string;
  constraints?: (PhysicalConstraintReport | null)[];
  run_id?: string;
}

export class TimestralForecastAdapter implements TimeSeriesForecastAdapter {
  readonly meta: ForecastModelMeta;
  private cache: Map<string, ForecastResult>;

  constructor(private readonly cfg: TimestralConfig) {
    this.meta = timestralMeta(cfg.model);
    this.cache = cfg.cache ?? new Map();
  }

  get configured(): boolean {
    return !!this.cfg.baseUrl;
  }

  async forecast(req: ForecastRequest, opts: { signal?: AbortSignal } = {}): Promise<ForecastResult> {
    if (!this.cfg.baseUrl) throw new ForecastUnavailableError();
    assertValidRequest(req);
    const hash = requestHash(req, this.meta.id, this.meta.revision);
    const hit = this.cache.get(hash);
    if (hit) return { ...hit, warnings: [...hit.warnings, 'risultato dalla cache (stesso input e stessa revisione)'] };

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.cfg.timeoutMs ?? 30_000);
    opts.signal?.addEventListener('abort', () => ctrl.abort());
    const auth = typeof this.cfg.authorization === 'function' ? await this.cfg.authorization() : this.cfg.authorization;
    const body = {
      schema_version: FORECAST_SCHEMA_VERSION,
      model: this.meta.id,
      revision: this.meta.revision,
      frequency: req.frequency,
      prediction_length: req.horizon,
      // una serie con più variate (target previsti congiuntamente): forma (1, V, T)
      context: [req.targets.map((t) => t.values)],
      past_covariates: req.pastCovariates.length ? [req.pastCovariates.map((c) => c.values)] : null,
      known_covariates: req.knownCovariates.length ? [req.knownCovariates.map((c) => c.values)] : null,
      input_hash: hash,
      ...(this.cfg.envelope ? { mdt: this.cfg.envelope(req) } : {}),
    };
    let res: Response;
    try {
      res = await (this.cfg.fetchImpl ?? fetch)(`${this.cfg.baseUrl.replace(/\/$/, '')}/v1/forecast`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(auth ? { authorization: auth } : {}) },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
    } catch (e) {
      throw new ForecastUnavailableError((e as Error).name === 'AbortError' ? 'Servizio Timestral: tempo scaduto' : 'Servizio Timestral non raggiungibile');
    } finally {
      clearTimeout(timer);
    }
    if (res.status === 503) throw new ForecastUnavailableError('Servizio Timestral: modello non caricato');
    if (!res.ok) {
      let detail = '';
      try {
        detail = ((await res.json()) as { detail?: string }).detail ?? '';
      } catch {
        /* corpo non JSON */
      }
      throw new Error(`Servizio Timestral: errore ${res.status}${detail ? ` — ${detail}` : ''}`);
    }
    const out = (await res.json()) as ServiceResponse;
    if (out.schema_version !== FORECAST_SCHEMA_VERSION) throw new Error(`Schema di risposta ${out.schema_version} non supportato`);
    if (out.revision !== this.meta.revision) throw new Error('Revisione del modello diversa da quella dichiarata: risultato scartato');
    const median = out.median[0]!;
    const quantiles = out.quantiles[0]!;
    const problems = median.flatMap((m, v) => checkQuantiles(quantiles[v]!, m, out.quantile_levels));
    if (problems.length) throw new Error(`Risposta non valida: ${problems.slice(0, 3).join(' ')}`);
    // difesa in profondità: il vincolo si applica sul server; qui una risposta fuori limite si scarta, non si corregge
    req.targets.forEach((t, v) => {
      const b = PHYSICAL_LIMITS[t.variable];
      if (b && quantiles[v]!.some((row) => row.some((x) => x < b[0] - 1e-9 || x > b[1] + 1e-9))) throw new Error(`Risposta non valida: ${t.variable} fuori dai limiti fisici`);
    });
    const result: ForecastResult = {
      model: this.meta,
      timestamps: futureTimestamps(req.targets[0]!.timestamps.at(-1)!, req.horizon),
      median,
      quantiles,
      levels: QUANTILE_LEVELS,
      inferenceMs: out.inference_ms,
      warnings: out.warnings,
      dataClass: 'STIMATO_DA_MODELLO',
      inputHash: hash,
      ...(out.constraints ? { constraints: out.constraints } : {}),
      ...(out.adapter_version ? { adapterVersion: out.adapter_version } : {}),
      ...(out.run_id ? { runId: out.run_id } : {}),
    };
    this.cache.set(hash, result);
    return result;
  }
}
