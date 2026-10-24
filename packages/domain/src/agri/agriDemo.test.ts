import { describe, expect, it } from 'vitest';
import { seedVineyard } from '../seeds/seeds';
import { runDemoAgriModel, type AgriModelInput } from './agriDemo';

const now = new Date('2026-08-20T08:00:00Z');
const today = '2026-08-20';

function input(mut?: (i: AgriModelInput) => void): AgriModelInput {
  const b = seedVineyard(now, today);
  const a = b.agri!;
  const i: AgriModelInput = {
    setup: structuredClone(a.setup),
    zones: structuredClone(a.zones),
    weather: a.weather,
    observations: structuredClone(a.observations),
    today,
    computedAt: now.toISOString(),
    isDemo: true,
  };
  mut?.(i);
  return i;
}

describe('Modello vigneto DEMO', () => {
  it('mantiene le 4 componenti separate per zona (nessun indice unico)', () => {
    const [za] = runDemoAgriModel(input());
    expect(za!.components.map((c) => c.key)).toEqual(['stress_termico', 'stress_idrico', 'fenologia', 'fitosanitario']);
    expect(za).not.toHaveProperty('index');
  });

  it('zone con priorità diverse: A alta, B media', () => {
    const [za, zb] = runDemoAgriModel(input());
    expect(za!.priority).toBe('alta');
    expect(zb!.priority).toBe('media');
    expect(za!.motivation).toMatch(/stress idrico elevato/);
  });

  it('fenologia mai dedotta: senza conferma è DATO MANCANTE e abbassa la fiducia', () => {
    const [unconfirmed] = runDemoAgriModel(input());
    expect(unconfirmed!.components[2]!.value.dataClass).toBe('DATO_MANCANTE');
    const [confirmed] = runDemoAgriModel(
      input((i) => {
        i.setup.phenology = { stage: 'invaiatura', confirmed: true, confirmedBy: 'agronomo', confirmedAt: now.toISOString() };
      }),
    );
    expect(confirmed!.components[2]!.value.dataClass).toBe('INSERITO_DALL_UTENTE');
    const rank = { 'molto bassa': 0, bassa: 1, media: 2, alta: 3 };
    expect(rank[confirmed!.confidence]).toBeGreaterThan(rank[unconfirmed!.confidence]);
  });

  it('i dati mancanti riducono la fiducia e sono elencati', () => {
    const [, zb] = runDemoAgriModel(input());
    expect(zb!.confidence).toBe('molto bassa');
    expect(zb!.missingData).toEqual(expect.arrayContaining(['conferma della fase fenologica', 'osservazione in campo degli ultimi 7 giorni']));
  });

  it('una misura di suolo in campo sostituisce la stima e aumenta la fiducia', () => {
    const [base] = runDemoAgriModel(input());
    const [withProbe] = runDemoAgriModel(
      input((i) => {
        i.observations = [...i.observations, { id: 'p', zoneId: i.zones[0]!.id, date: today, category: 'misura_suolo', note: 'sonda TDR', value: 0.2, unit: 'm³/m³', dataClass: 'MISURATO' }];
      }),
    );
    expect(withProbe!.components[1]!.value.dataClass).toBe('MISURATO');
    expect(withProbe!.confidenceReasons.length).toBeLessThan(base!.confidenceReasons.length);
  });

  it('nessun consiglio irriguo senza input minimi', () => {
    const [za] = runDemoAgriModel(input());
    const irr = za!.measures.find((m) => m.id === 'irrigazione_soccorso')!;
    expect(irr.availability).toBe('non valutabile');
    expect(irr.missing).toContain('fase fenologica confermata');
    expect(irr.text).toMatch(/Nessun consiglio irriguo/);
  });

  it('con input minimi il testo irriguo è condizionale, mai prescrittivo', () => {
    const [za] = runDemoAgriModel(
      input((i) => {
        i.setup.phenology = { stage: 'invaiatura', confirmed: true, confirmedBy: 'x', confirmedAt: now.toISOString() };
      }),
    );
    const irr = za!.measures.find((m) => m.id === 'irrigazione_soccorso')!;
    expect(irr.availability).toBe('valutabile');
    expect(irr.text).toContain('Prima di intervenire verifica umidità del suolo, fase fenologica');
    expect(irr.text).not.toMatch(/\birriga(re)? \d|mm\b/);
  });

  it('stress idrico non determinabile senza parametri del suolo', () => {
    const [za] = runDemoAgriModel(
      input((i) => {
        i.zones[0]!.fieldCapacity = null;
      }),
    );
    expect(za!.components[1]!.level).toBe('non determinabile');
    expect(za!.components[1]!.value.dataClass).toBe('DATO_MANCANTE');
  });

  it('i segnali fitosanitari non sono una diagnosi', () => {
    const [za] = runDemoAgriModel(input());
    expect(za!.components[3]!.explanation).toMatch(/Non costituisce diagnosi/);
  });
});
