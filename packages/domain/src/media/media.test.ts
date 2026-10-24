import { describe, expect, it } from 'vitest';
import { seedCampobasso, seedVineyard } from '../seeds/seeds';
import { AGRI_PHOTO_NOTICE, categoriesFor, mediaToCsv, projectCells, validateMediaContext, type MediaRecord } from './media';

const urban = seedCampobasso(new Date('2026-10-24T08:00:00Z'));
const agri = seedVineyard(new Date('2026-08-20T08:00:00Z'), '2026-08-20');
const today = '2026-10-24';

const base = (b: typeof urban): Parameters<typeof validateMediaContext>[0] => ({
  projectId: b.project.id,
  areaId: b.area!.id,
  zoneId: null,
  cellId: null,
  scenarioId: null,
  observationId: null,
  workflowStage: 'bozza',
  category: 'foto_sopralluogo',
  observedOn: '2026-10-20',
  author: 'Tecnico',
  description: '',
  location: null,
  locationConsent: false,
});

describe('Contesto obbligatorio dei file', () => {
  it('un file urbano con area, cella e scenario validi è accettato', () => {
    const cell = projectCells(urban)[10]!.id;
    expect(validateMediaContext({ ...base(urban), cellId: cell, scenarioId: urban.scenarios[0]!.id }, urban, today)).toEqual([]);
  });

  it('un file agricolo con sottozona e osservazione validi è accettato', () => {
    expect(validateMediaContext({ ...base(agri), zoneId: agri.agri!.zones[0]!.id, observationId: agri.agri!.observations[0]!.id, category: 'immagine_terreno_coltura' }, agri, today)).toEqual([]);
  });

  it('senza area o con riferimenti inesistenti viene rifiutato', () => {
    expect(validateMediaContext({ ...base(urban), areaId: 'altro' }, urban, today).join(' ')).toMatch(/area del progetto/);
    expect(validateMediaContext({ ...base(urban), scenarioId: 'x' }, urban, today).join(' ')).toMatch(/Scenario non trovato/);
    expect(validateMediaContext({ ...base(urban), cellId: 'r999c999' }, urban, today).join(' ')).toMatch(/Cella non trovata/);
  });

  it('nessuna commistione: niente sottozone in un progetto urbano, niente celle in uno agricolo', () => {
    expect(validateMediaContext({ ...base(urban), zoneId: agri.agri!.zones[0]!.id }, urban, today).join(' ')).toMatch(/solo nei progetti agricoli/);
    expect(validateMediaContext({ ...base(agri), cellId: 'r1c1' }, agri, today).join(' ')).toMatch(/solo nei progetti urbani/);
    expect(validateMediaContext({ ...base(urban), category: 'immagine_terreno_coltura' }, urban, today).join(' ')).toMatch(/Categoria non disponibile/);
    expect(categoriesFor('urban')).not.toContain('immagine_terreno_coltura');
  });

  it('posizione solo con consenso; data non futura; autore obbligatorio', () => {
    expect(validateMediaContext({ ...base(urban), location: { lat: 41.56, lon: 14.66 } }, urban, today).join(' ')).toMatch(/consenso esplicito/);
    expect(validateMediaContext({ ...base(urban), location: { lat: 41.56, lon: 14.66 }, locationConsent: true }, urban, today)).toEqual([]);
    expect(validateMediaContext({ ...base(urban), observedOn: '2030-01-01' }, urban, today).join(' ')).toMatch(/futuro/);
    expect(validateMediaContext({ ...base(urban), author: ' ' }, urban, today).join(' ')).toMatch(/autore/);
  });

  it('il testo vicino alle immagini agricole non parla di diagnosi come risultato', () => {
    expect(AGRI_PHOTO_NOTICE).toBe('La fotografia documenta l’osservazione ed è associata ai dati disponibili. Non costituisce una diagnosi agronomica.');
  });
});

describe('Esportazione', () => {
  it('CSV con dizionario dei campi e campi con virgole protetti', () => {
    const r = { id: 'm1', category: 'documento_tecnico', description: 'Relazione, parte 1', observedOn: '2026-10-20', author: 'A', createdAt: 'x', projectId: 'p', areaId: 'a', zoneId: null, cellId: null, scenarioId: null, observationId: null, workflowStage: 'revisione', mime: 'application/pdf', sizeBytes: 10, sha256: 'h', storage: 'server', locationConsent: false, retentionUntil: '2031-10-20' } as unknown as MediaRecord;
    const { csv, dictionary } = mediaToCsv([r]);
    expect(csv.split('\n')[1]).toContain('"Relazione, parte 1"');
    expect(dictionary).toMatch(/^campo,descrizione\nid,Identificativo del file/);
  });
});
