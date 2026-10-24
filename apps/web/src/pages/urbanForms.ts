import type { Intervention, InterventionType, MultiPoint, Polygon, Position, Scenario } from '@mdt/domain';
import { newId, polygonFromVertices } from '@mdt/domain';

export type ParamValue = string | number | boolean;

export const PARAM_DEFAULTS: Record<InterventionType, Record<string, ParamValue>> = {
  albero: { tipologia: 'latifoglia media grandezza', diametroChiomaInizialeM: 3, diametroChiomaMaturaM: 8, etaAnni: 4 },
  depaving: { materialeRimosso: 'asfalto', nuovaSuperficie: 'verde', permeabilitaPct: 90 },
  schermatura: { orientamento: 'est-ovest', oreOmbraGiorno: 6, materiale: 'tessuto tecnico', ombraAllOraDiRiferimento: true },
  albedo: { albedoIniziale: 0.1, albedoFinale: 0.4, materiale: 'pavimentazione chiara' },
  nebulizzazione: { portataLH: 20, durataOreGiorno: 6, giorniAnno: 60, raggioInfluenzaM: 5, urMassimaAttivazionePct: 60 },
  verde_tecnico: { tipo: 'parete', irrigato: true },
};

export const PARAM_LABEL: Record<string, string> = {
  tipologia: 'Specie o tipologia',
  diametroChiomaInizialeM: 'Diametro chioma all’impianto (m)',
  diametroChiomaMaturaM: 'Diametro chioma a maturità (m)',
  etaAnni: 'Età all’impianto (anni)',
  materialeRimosso: 'Materiale rimosso',
  nuovaSuperficie: 'Nuova superficie',
  permeabilitaPct: 'Permeabilità (%)',
  orientamento: 'Orientamento',
  oreOmbraGiorno: 'Ore di ombra al giorno',
  materiale: 'Materiale',
  ombraAllOraDiRiferimento: 'Fa ombra all’ora di riferimento',
  albedoIniziale: 'Albedo iniziale (0–1)',
  albedoFinale: 'Albedo finale (0–1)',
  portataLH: 'Portata per punto (l/h)',
  durataOreGiorno: 'Funzionamento (ore/giorno)',
  giorniAnno: 'Giorni di funzionamento/anno',
  raggioInfluenzaM: 'Raggio d’influenza (m)',
  urMassimaAttivazionePct: 'UR massima di attivazione (%)',
  tipo: 'Tipo',
  irrigato: 'Irrigato',
};

export const PARAM_OPTIONS: Record<string, { value: string; label: string }[]> = {
  nuovaSuperficie: [
    { value: 'verde', label: 'Verde (prato/aiuola)' },
    { value: 'permeabile_drenante', label: 'Pavimentazione drenante' },
    { value: 'ghiaia', label: 'Ghiaia / stabilizzato' },
  ],
  tipo: [
    { value: 'parete', label: 'Parete verde' },
    { value: 'tetto', label: 'Tetto verde' },
  ],
};

export function buildIntervention(type: InterventionType, label: string, params: Record<string, ParamValue>, vertices: Position[]): Intervention {
  const id = newId();
  const isPoints = type === 'albero' || type === 'nebulizzazione';
  const geometry: MultiPoint | Polygon = isPoints ? { type: 'MultiPoint', coordinates: vertices } : polygonFromVertices(vertices);
  // le chiavi dei parametri sono quelle di PARAM_DEFAULTS[type]: il cast riflette questa corrispondenza
  return { id, type, label, geometry, params } as unknown as Intervention;
}

/** Aggiorna gli interventi degli scenari combinati quando cambia uno scenario sorgente. */
export function refreshCombined(scenarios: Scenario[]): Scenario[] {
  return scenarios.map((s) => {
    if (s.combines.length === 0) return s;
    const sources = s.combines.map((id) => scenarios.find((x) => x.id === id)).filter((x): x is Scenario => !!x);
    const next = sources.flatMap((x) => x.interventions);
    const same = next.length === s.interventions.length && next.every((i, k) => i.id === s.interventions[k]?.id);
    return same ? s : { ...s, interventions: next };
  });
}

export function nextScenarioLabel(scenarios: Scenario[]): string {
  const used = new Set(scenarios.map((s) => s.label));
  for (let i = 0; i < 26; i++) {
    const l = String.fromCharCode(65 + i);
    if (!used.has(l)) return l;
  }
  return `S${scenarios.length + 1}`;
}
