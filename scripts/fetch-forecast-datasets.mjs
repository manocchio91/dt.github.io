// Scarica (una tantum) le serie orarie usate dai backtest e dalle demo delle previsioni.
// Fonte: Open-Meteo Historical Weather API (rianalisi ERA5 / ERA5-Land), licenza CC BY 4.0.
// Sono STIME DA MODELLO riferite a una cella di griglia, non misure in campo.
import { writeFileSync, mkdirSync } from 'node:fs';

const OUT = 'packages/domain/src/forecast/data';
const sets = [
  {
    file: 'urban_campobasso_2025.json',
    title: 'Campobasso (area urbana) — estate 2025',
    lat: 41.5606,
    lon: 14.663,
    start: '2025-06-01',
    end: '2025-08-31',
    vars: { temperature_2m: ['temperatura_aria', '°C'], relative_humidity_2m: ['umidita_relativa', '%'], shortwave_radiation: ['radiazione', 'W/m²'], wind_speed_10m: ['vento', 'm/s'] },
  },
  {
    file: 'vineyard_molise_2025.json',
    title: 'Vigneto molisano (parcella dimostrativa) — estate 2025',
    lat: 41.8,
    lon: 14.92,
    start: '2025-06-01',
    end: '2025-09-15',
    vars: { soil_moisture_7_to_28cm: ['umidita_suolo', 'm³/m³'], soil_temperature_7_to_28cm: ['temperatura_suolo', '°C'], temperature_2m: ['temperatura_aria', '°C'], precipitation: ['precipitazione', 'mm'], shortwave_radiation: ['radiazione', 'W/m²'] },
  },
];

mkdirSync(OUT, { recursive: true });
for (const s of sets) {
  const url = new URL('https://archive-api.open-meteo.com/v1/archive');
  url.search = new URLSearchParams({ latitude: String(s.lat), longitude: String(s.lon), start_date: s.start, end_date: s.end, hourly: Object.keys(s.vars).join(','), timezone: 'GMT', wind_speed_unit: 'ms' }).toString();
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${s.file}: HTTP ${res.status}`);
  const j = await res.json();
  const series = {};
  for (const [k, [name, unit]] of Object.entries(s.vars)) series[name] = { unit, values: j.hourly[k] };
  const out = {
    meta: {
      title: s.title,
      source: 'Open-Meteo Historical Weather API (rianalisi ERA5 / ERA5-Land)',
      endpoint: 'https://archive-api.open-meteo.com/v1/archive',
      license: 'CC BY 4.0 — dati Open-Meteo.com',
      retrievedAt: new Date().toISOString(),
      requested: { lat: s.lat, lon: s.lon },
      gridCell: { lat: j.latitude, lon: j.longitude, elevationM: j.elevation },
      frequency: '1h',
      timezone: 'UTC',
      dataClass: 'STIMATO_DA_MODELLO',
      note: 'Stima da modello riferita a una cella di griglia di alcuni chilometri: non è una misura in campo né un sensore locale.',
    },
    time: j.hourly.time.map((t) => `${t}:00Z`),
    series,
  };
  writeFileSync(`${OUT}/${s.file}`, JSON.stringify(out));
  console.log(`${s.file}: ${out.time.length} ore, cella ${j.latitude}, ${j.longitude}`);
}
