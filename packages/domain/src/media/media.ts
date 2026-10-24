import { buildGrid } from '../geo/geo';
import { suggestedCellSize } from '../models/urbanDemo';
import type { ProjectBundle, Sector } from '../project/bundle';

/**
 * Foto e documenti (B-109). Ogni file è sempre legato a un contesto:
 * progetto, area o parcella, data, autore, categoria e fase del workflow.
 * Una fotografia documenta un'osservazione: non è una diagnosi.
 */

export const MEDIA_CATEGORIES = [
  'foto_sopralluogo',
  'immagine_terreno_coltura',
  'documento_tecnico',
  'analisi_laboratorio',
  'relazione_tecnica',
  'autorizzazione_allegato',
  'verifica_ex_post',
] as const;
export type MediaCategory = (typeof MEDIA_CATEGORIES)[number];

export const MEDIA_CATEGORY_LABEL: Record<MediaCategory, { title: string; sectors: Sector[] }> = {
  foto_sopralluogo: { title: 'Fotografia di sopralluogo', sectors: ['urban', 'agriculture'] },
  immagine_terreno_coltura: { title: 'Immagine del terreno o della coltura', sectors: ['agriculture'] },
  documento_tecnico: { title: 'Documento tecnico', sectors: ['urban', 'agriculture'] },
  analisi_laboratorio: { title: 'Analisi di laboratorio', sectors: ['urban', 'agriculture'] },
  relazione_tecnica: { title: 'Relazione di tecnico, geologo o agronomo', sectors: ['urban', 'agriculture'] },
  autorizzazione_allegato: { title: 'Autorizzazione o allegato', sectors: ['urban', 'agriculture'] },
  verifica_ex_post: { title: 'File per la verifica ex-post', sectors: ['urban', 'agriculture'] },
};

export const WORKFLOW_STAGES = ['bozza', 'validazione_tecnica', 'revisione', 'approvazione', 'esecuzione', 'monitoraggio', 'chiusura'] as const;
export type WorkflowStage = (typeof WORKFLOW_STAGES)[number];
export const WORKFLOW_STAGE_LABEL: Record<WorkflowStage, string> = {
  bozza: 'Bozza',
  validazione_tecnica: 'Validazione tecnica',
  revisione: 'Revisione',
  approvazione: 'Approvazione',
  esecuzione: 'Esecuzione',
  monitoraggio: 'Monitoraggio',
  chiusura: 'Chiusura',
};

export const AGRI_PHOTO_NOTICE =
  'La fotografia documenta l’osservazione ed è associata ai dati disponibili. Non costituisce una diagnosi agronomica.';

export const DEFAULT_RETENTION_YEARS = 5;

export interface MediaAssociation {
  organizationId: string | null; // null = ospite, archivio locale
  projectId: string;
  /** area urbana o parcella agricola del progetto */
  areaId: string;
  /** agricolo: sottozona */
  zoneId: string | null;
  /** urbano: cella della griglia */
  cellId: string | null;
  scenarioId: string | null;
  observationId: string | null;
  workflowStage: WorkflowStage;
}

export interface MediaRecord extends MediaAssociation {
  id: string;
  category: MediaCategory;
  description: string;
  observedOn: string; // YYYY-MM-DD
  author: string;
  authorId: string | null;
  createdAt: string;
  mime: string;
  sizeBytes: number;
  sha256: string;
  originalName: string; // normalizzato
  /** dove si trova il contenuto */
  storage: 'locale' | 'server';
  storagePath: string | null;
  /** solo con consenso esplicito */
  location: { lat: number; lon: number } | null;
  locationConsent: boolean;
  metadataRemoved: string[];
  metadataKept: string[];
  retentionUntil: string; // YYYY-MM-DD
  status: 'caricamento' | 'attivo' | 'eliminazione_in_corso' | 'non_sincronizzato';
}

export const METADATA_KEPT = [
  'tipo di file e dimensione',
  'impronta SHA-256 (per verificare che il file non sia cambiato)',
  'nome del file normalizzato',
  'categoria, descrizione e data dell’osservazione',
  'collegamenti a progetto, area, zona o cella, scenario, osservazione, fase',
  'autore e data di caricamento',
];

export function categoriesFor(sector: Sector): MediaCategory[] {
  return MEDIA_CATEGORIES.filter((c) => MEDIA_CATEGORY_LABEL[c].sectors.includes(sector));
}

export function addYears(day: string, years: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return d.toISOString().slice(0, 10);
}

/** Celle della griglia dell'area urbana (per l'associazione a una cella). */
export function projectCells(bundle: ProjectBundle): { id: string; center: [number, number] }[] {
  if (!bundle.area || bundle.project.sector !== 'urban') return [];
  return buildGrid(bundle.area.geometry, suggestedCellSize(bundle.area.areaM2)).cells.map((c) => ({ id: c.id, center: c.center }));
}

/**
 * Coerenza del contesto: tutto deve esistere nel progetto e appartenere al
 * suo ambito (niente sottozone in un progetto urbano, niente celle in uno agricolo).
 */
export function validateMediaContext(
  r: Pick<MediaRecord, 'projectId' | 'areaId' | 'zoneId' | 'cellId' | 'scenarioId' | 'observationId' | 'workflowStage' | 'category' | 'observedOn' | 'author' | 'description' | 'location' | 'locationConsent'>,
  bundle: ProjectBundle,
  today: string,
): string[] {
  const e: string[] = [];
  const sector = bundle.project.sector;
  if (r.projectId !== bundle.project.id) e.push('Il file deve essere collegato a questo progetto.');
  if (!bundle.area || r.areaId !== bundle.area.id) e.push(sector === 'urban' ? 'Collega il file all’area del progetto.' : 'Collega il file alla parcella del progetto.');
  if (!MEDIA_CATEGORY_LABEL[r.category]?.sectors.includes(sector)) e.push('Categoria non disponibile in questo ambito.');
  if (!WORKFLOW_STAGES.includes(r.workflowStage)) e.push('Scegli la fase del workflow.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(r.observedOn)) e.push('Indica la data dell’osservazione.');
  else if (r.observedOn > today) e.push('La data dell’osservazione non può essere nel futuro.');
  if (!r.author.trim()) e.push('Indica l’autore.');
  if (r.description.length > 2000) e.push('Descrizione troppo lunga (massimo 2000 caratteri).');
  if (r.zoneId) {
    if (sector !== 'agriculture') e.push('Le sottozone esistono solo nei progetti agricoli.');
    else if (!bundle.agri?.zones.some((z) => z.id === r.zoneId)) e.push('Sottozona non trovata nel progetto.');
  }
  if (r.cellId) {
    if (sector !== 'urban') e.push('Le celle esistono solo nei progetti urbani.');
    else if (!projectCells(bundle).some((c) => c.id === r.cellId)) e.push('Cella non trovata nella griglia dell’area.');
  }
  if (r.scenarioId && !bundle.scenarios.some((s) => s.id === r.scenarioId)) e.push('Scenario non trovato nel progetto.');
  if (r.observationId && !bundle.agri?.observations.some((o) => o.id === r.observationId)) e.push('Osservazione non trovata nel progetto.');
  if (r.location && !r.locationConsent) e.push('La posizione si conserva solo con il tuo consenso esplicito.');
  if (r.location && (Math.abs(r.location.lat) > 90 || Math.abs(r.location.lon) > 180)) e.push('Coordinate non valide.');
  return e;
}

/** Descrizione leggibile del contesto di un file. */
export function describeContext(r: MediaRecord, bundle: ProjectBundle): string[] {
  const out = [bundle.project.name, bundle.project.sector === 'urban' ? `Area: ${bundle.area?.name ?? '—'}` : `Parcella: ${bundle.area?.name ?? '—'}`];
  if (r.zoneId) out.push(`Sottozona: ${bundle.agri?.zones.find((z) => z.id === r.zoneId)?.name ?? '—'}`);
  if (r.cellId) out.push(`Cella: ${r.cellId}`);
  if (r.scenarioId) out.push(`Scenario: ${bundle.scenarios.find((s) => s.id === r.scenarioId)?.label ?? '—'}`);
  if (r.observationId) out.push(`Osservazione: ${bundle.agri?.observations.find((o) => o.id === r.observationId)?.note ?? '—'}`);
  out.push(`Fase: ${WORKFLOW_STAGE_LABEL[r.workflowStage]}`);
  return out;
}

const CSV_COLUMNS: { key: keyof MediaRecord | 'contesto'; label: string; desc: string }[] = [
  { key: 'id', label: 'id', desc: 'Identificativo del file' },
  { key: 'category', label: 'categoria', desc: 'Tipologia di contenuto' },
  { key: 'description', label: 'descrizione', desc: 'Descrizione inserita dall’autore' },
  { key: 'observedOn', label: 'data_osservazione', desc: 'Data dell’osservazione (AAAA-MM-GG)' },
  { key: 'author', label: 'autore', desc: 'Chi ha caricato il file' },
  { key: 'createdAt', label: 'caricato_il', desc: 'Data e ora di caricamento (UTC)' },
  { key: 'projectId', label: 'progetto', desc: 'Identificativo del progetto' },
  { key: 'areaId', label: 'area_parcella', desc: 'Area urbana o parcella agricola' },
  { key: 'zoneId', label: 'sottozona', desc: 'Sottozona agricola (se presente)' },
  { key: 'cellId', label: 'cella', desc: 'Cella della griglia urbana (se presente)' },
  { key: 'scenarioId', label: 'scenario', desc: 'Scenario collegato (se presente)' },
  { key: 'observationId', label: 'osservazione', desc: 'Osservazione di campo collegata (se presente)' },
  { key: 'workflowStage', label: 'fase', desc: 'Fase del workflow' },
  { key: 'mime', label: 'tipo', desc: 'Tipo MIME verificato dal contenuto' },
  { key: 'sizeBytes', label: 'dimensione_byte', desc: 'Dimensione dopo la rimozione dei metadati' },
  { key: 'sha256', label: 'sha256', desc: 'Impronta del file' },
  { key: 'storage', label: 'archivio', desc: 'locale (solo browser) o server' },
  { key: 'locationConsent', label: 'posizione_con_consenso', desc: 'La posizione è conservata solo se true' },
  { key: 'retentionUntil', label: 'conservare_fino_al', desc: 'Data di fine conservazione' },
];

export function mediaToCsv(records: readonly MediaRecord[]): { csv: string; dictionary: string } {
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = CSV_COLUMNS.map((c) => c.label).join(',');
  const rows = records.map((r) => CSV_COLUMNS.map((c) => esc(c.key === 'contesto' ? '' : r[c.key as keyof MediaRecord])).join(','));
  const dictionary = ['campo,descrizione', ...CSV_COLUMNS.map((c) => `${c.label},${esc(c.desc)}`)].join('\n');
  return { csv: [header, ...rows].join('\n'), dictionary };
}
