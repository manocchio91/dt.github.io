import { describe, expect, it } from 'vitest';
import {
  changeSector,
  DATA_SOURCES,
  DECISIONS,
  dataConsequences,
  finalizeOnboarding,
  ONBOARDING_STEPS,
  onboardingTarget,
  OPERATIONAL_PROFILES,
  parsePreferences,
  PROFILE_DEFAULT_SECTOR,
  validateStep,
  type OnboardingDraft,
} from './onboarding';
import { ORG_ROLES, permissionsFor } from './permissions';

const now = new Date('2026-10-24T10:00:00Z');
const urban: OnboardingDraft = {
  profile: 'tecnico_comunale',
  sector: 'urban',
  decision: 'ridurre_calore',
  area: { kind: 'demo' },
  data: ['confini_area'],
  mode: 'guidata',
};

describe('Onboarding: sei domande', () => {
  it('ha sei passi nell’ordine richiesto', () => {
    expect(ONBOARDING_STEPS).toEqual(['profilo', 'ambito', 'decisione', 'area', 'dati', 'modalita']);
  });

  it('offre i cinque profili operativi', () => {
    expect(OPERATIONAL_PROFILES).toEqual(['tecnico_comunale', 'gestore_verde', 'agricoltore', 'agronomo', 'revisore']);
    expect(PROFILE_DEFAULT_SECTOR.revisore).toBeNull();
  });

  it('valida ogni passo e completa le preferenze', () => {
    for (const s of ONBOARDING_STEPS) expect(validateStep(s, urban), s).toEqual([]);
    const p = finalizeOnboarding(urban, now);
    expect(p).toMatchObject({ version: 1, sector: 'urban', mode: 'guidata', completedAt: now.toISOString() });
    expect(() => finalizeOnboarding({ ...urban, mode: undefined }, now)).toThrow(/modalità/);
  });

  it('richiede un nome per il nuovo progetto', () => {
    expect(validateStep('area', { ...urban, area: { kind: 'nuovo', name: 'ab' } })).toHaveLength(1);
    expect(validateStep('area', { ...urban, area: { kind: 'nuovo', name: 'Viale Roma' } })).toEqual([]);
  });
});

describe('Nessuna commistione tra urbano e agricolo', () => {
  it('le liste di decisioni e dati non condividono voci', () => {
    const ids = (xs: { id: string }[]) => new Set(xs.map((x) => x.id));
    const du = ids(DECISIONS.urban);
    expect([...ids(DECISIONS.agriculture)].some((x) => du.has(x))).toBe(false);
    const su = ids(DATA_SOURCES.urban);
    expect([...ids(DATA_SOURCES.agriculture)].some((x) => su.has(x))).toBe(false);
  });

  it('rifiuta una decisione o un dato dell’altro ambito', () => {
    expect(validateStep('decisione', { ...urban, decision: 'zona_da_controllare' })).toHaveLength(1);
    expect(validateStep('dati', { ...urban, data: ['sonda_suolo'] })).toHaveLength(1);
  });

  it('cambiare ambito azzera decisione, dati e progetto esistente', () => {
    const d = changeSector({ ...urban, area: { kind: 'esistente', projectId: 'p1' } }, 'agriculture');
    expect(d).toMatchObject({ sector: 'agriculture', decision: undefined, data: [], area: undefined });
    expect(changeSector(urban, 'urban')).toBe(urban);
  });

  it('le conseguenze dei dati mancanti parlano solo dell’ambito scelto', () => {
    expect(dataConsequences({ sector: 'urban', data: [] }).join(' ')).not.toMatch(/suolo|vigneto/);
    expect(dataConsequences({ sector: 'agriculture', data: [] }).join(' ')).not.toMatch(/superfici|prezzario/);
    expect(dataConsequences({ sector: 'agriculture', data: ['sonda_suolo', 'stazione_meteo', 'analisi_suolo'] })).toEqual([]);
  });
});

describe('Instradamento', () => {
  const projects = [
    { id: 'u1', sector: 'urban' as const, hasArea: true },
    { id: 'u2', sector: 'urban' as const, hasArea: false },
    { id: 'a1', sector: 'agriculture' as const, hasArea: true },
  ];
  it('demo e nuovo progetto restano nell’ambito', () => {
    expect(onboardingTarget(finalizeOnboarding(urban, now), projects)).toEqual({ kind: 'demo', sector: 'urban' });
    expect(onboardingTarget(finalizeOnboarding({ ...urban, area: { kind: 'nuovo', name: ' Via Roma ' } }, now), projects)).toEqual({ kind: 'nuovo', sector: 'urban', name: 'Via Roma' });
  });
  it('progetto esistente: Lab se ha l’area, altrimenti pagina area', () => {
    expect(onboardingTarget(finalizeOnboarding({ ...urban, area: { kind: 'esistente', projectId: 'u1' } }, now), projects)).toMatchObject({ path: '/progetti/u1/urbano' });
    expect(onboardingTarget(finalizeOnboarding({ ...urban, area: { kind: 'esistente', projectId: 'u2' } }, now), projects)).toMatchObject({ path: '/progetti/u2/area' });
  });
  it('un progetto dell’altro ambito non viene mai aperto', () => {
    expect(onboardingTarget(finalizeOnboarding({ ...urban, area: { kind: 'esistente', projectId: 'a1' } }, now), projects)).toEqual({ kind: 'demo', sector: 'urban' });
  });
});

describe('Il profilo non concede permessi', () => {
  it('le preferenze non contengono ruoli; campi estranei vengono scartati', () => {
    const p = finalizeOnboarding({ ...urban, profile: 'revisore' }, now);
    expect(Object.keys(p).sort()).toEqual(['area', 'completedAt', 'data', 'decision', 'mode', 'profile', 'sector', 'version']);
    const injected = parsePreferences({ ...p, role: 'admin', canEdit: true, permissions: ['all'] });
    expect(injected).toEqual(p);
    expect(injected).not.toHaveProperty('role');
  });

  it('preferenze incoerenti o manomesse sono ignorate', () => {
    const p = finalizeOnboarding(urban, now);
    expect(parsePreferences({ ...p, decision: 'zona_da_controllare' })).toBeNull();
    expect(parsePreferences({ ...p, version: 2 })).toBeNull();
    expect(parsePreferences('x')).toBeNull();
  });

  it('i permessi dipendono solo dal ruolo di autorizzazione', () => {
    expect(permissionsFor.length).toBe(2); // (archivio, ruolo): nessun parametro "profilo"
    expect(permissionsFor('organizzazione', 'viewer')).toMatchObject({ canEdit: false, readOnly: true, canAdmin: false });
    expect(permissionsFor('organizzazione', 'editor')).toMatchObject({ canEdit: true, canApprove: false });
    expect(permissionsFor('organizzazione', 'approver')).toMatchObject({ canEdit: true, canApprove: true, canAdmin: false });
    expect(permissionsFor('organizzazione', 'admin')).toMatchObject({ canAdmin: true });
    expect(permissionsFor('organizzazione', null)).toMatchObject({ canEdit: false, readOnly: true });
    expect(permissionsFor('locale', null)).toMatchObject({ canEdit: true, readOnly: false });
    expect(ORG_ROLES).toEqual(['viewer', 'editor', 'approver', 'admin']);
  });
});
