import { describe, expect, it } from 'vitest';
import { DECISIONS, parsePreferences } from './onboarding';

const now = new Date('2026-10-24T10:00:00Z');

describe('Onboarding: decisioni per percorso (Audit Anno Luce)', () => {
  it('percorso urbano: zone calde, luogo preciso, interventi, soglia, verifica successiva', () => {
    expect(DECISIONS.urban.map((d) => d.id)).toEqual(['individuare_area_calda', 'ridurre_calore', 'scegliere_intervento', 'monitorare_soglia', 'verificare_risultato']);
  });

  it('percorso agricolo: stress, parcella, fase fenologica, soglia dell’agronomo, sopralluogo, scenari', () => {
    expect(DECISIONS.agriculture.map((d) => d.id)).toEqual(['valutare_irrigazione', 'documentare_campo', 'fase_fenologica', 'soglia_agronomo', 'zona_da_controllare', 'confrontare_scenari']);
  });

  it('nessuna voce fa credere che l’app prescriva irrigazioni, trattamenti o interventi automatici', () => {
    const text = [...DECISIONS.urban, ...DECISIONS.agriculture].map((d) => `${d.title} ${d.hint}`).join(' ');
    expect(text).not.toMatch(/automatic|prescri|irrigazione di soccorso|serve acqua|irriga ora|tratta ora/i);
    expect(DECISIONS.agriculture[0]!.hint).toMatch(/resta tua e dell’agronomo/);
  });

  it('le decisioni salvate con le versioni precedenti restano leggibili', () => {
    const old = { version: 1, completedAt: now.toISOString(), profile: 'tecnico_comunale', sector: 'urban', decision: 'motivare_proposta', area: { kind: 'demo' }, data: [], mode: 'guidata' };
    expect(parsePreferences(old)?.decision).toBe('scegliere_intervento');
    expect(parsePreferences({ ...old, profile: 'agricoltore', sector: 'agriculture', decision: 'verificare_risposta' })?.decision).toBe('confrontare_scenari');
  });
});
