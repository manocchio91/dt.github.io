// Smoke test reale verso Open-Meteo Forecast API (rete necessaria).
// Uso: node scripts/open-meteo-smoke.mjs [--save-fixture]
// Con --save-fixture salva le risposte come fixture controllate per i test automatici.
import { writeFileSync, mkdirSync } from 'node:fs';
import { buildIngestUrl, fetchForecastJson, parseForecastResponse, issuedHour, splitAtIssue } from '../packages/domain/src/connectors/openMeteoForecast.ts';

const cases = [
  { id: 'smoke-urbano', latitude: 41.5606, longitude: 14.663, scope: 'urban' },
  { id: 'smoke-vigneto', latitude: 41.8, longitude: 14.92, scope: 'agricultural' },
];
const save = process.argv.includes('--save-fixture');
let failed = false;
for (const loc of cases) {
  const url = buildIngestUrl(loc);
  try {
    const t0 = Date.now();
    const { body, attempts } = await fetchForecastJson(url, { timeoutMs: 15_000 });
    const p = parseForecastResponse(body, loc.scope);
    const { forecast, past } = splitAtIssue(p, issuedHour(new Date()));
    console.log(`${loc.scope}: OK in ${Date.now() - t0} ms (${attempts} tentativo/i) — cella ${p.grid.latitude}, ${p.grid.longitude}, quota ${p.grid.elevation} m; ${p.variables.length} variabili; ${forecast.length} ore future, ${past.length} passate; ${forecast[0]?.validAt} → ${forecast.at(-1)?.validAt}`);
    if (p.warnings.length) console.log('  avvisi:', p.warnings.join('; '));
    if (save) {
      mkdirSync('packages/domain/src/connectors/fixtures', { recursive: true });
      writeFileSync(`packages/domain/src/connectors/fixtures/open-meteo-forecast-${loc.scope}.json`, JSON.stringify({ _fixture: { capturedAt: new Date().toISOString(), url, note: 'Risposta reale Open-Meteo (CC BY 4.0) usata come fixture controllata nei test.' }, ...body }));
    }
  } catch (e) {
    failed = true;
    console.error(`${loc.scope}: ERRORE ${e.code ?? ''} ${e.message}`);
  }
}
process.exitCode = failed ? 1 : 0;
