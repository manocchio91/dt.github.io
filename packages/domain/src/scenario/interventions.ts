import type { MultiPoint, Polygon } from 'geojson';
import { geodesicAreaM2, pointInPolygon } from '../geo/geo';

/** Interventi urbani tipizzati (§5.4). Le quantità sono derivate dalla geometria. */

export type InterventionType = 'albero' | 'depaving' | 'schermatura' | 'albedo' | 'nebulizzazione' | 'verde_tecnico';

interface Base {
  id: string;
  label: string;
}

export interface TreeIntervention extends Base {
  type: 'albero';
  geometry: MultiPoint;
  params: {
    tipologia: string;
    diametroChiomaInizialeM: number;
    diametroChiomaMaturaM: number;
    etaAnni: number;
  };
}

export type NewSurface = 'verde' | 'permeabile_drenante' | 'ghiaia';

export interface DepavingIntervention extends Base {
  type: 'depaving';
  geometry: Polygon;
  params: { materialeRimosso: string; nuovaSuperficie: NewSurface; permeabilitaPct: number };
}

export interface ShadeIntervention extends Base {
  type: 'schermatura';
  geometry: Polygon;
  params: { orientamento: string; oreOmbraGiorno: number; materiale: string; ombraAllOraDiRiferimento: boolean };
}

export interface AlbedoIntervention extends Base {
  type: 'albedo';
  geometry: Polygon;
  params: { albedoIniziale: number; albedoFinale: number; materiale: string };
}

export interface MistIntervention extends Base {
  type: 'nebulizzazione';
  geometry: MultiPoint;
  params: {
    portataLH: number;
    durataOreGiorno: number;
    giorniAnno: number;
    raggioInfluenzaM: number;
    urMassimaAttivazionePct: number;
  };
}

export interface TechnicalGreenIntervention extends Base {
  type: 'verde_tecnico';
  geometry: Polygon;
  params: { tipo: 'tetto' | 'parete'; irrigato: boolean };
}

export type Intervention =
  | TreeIntervention
  | DepavingIntervention
  | ShadeIntervention
  | AlbedoIntervention
  | MistIntervention
  | TechnicalGreenIntervention;

export const INTERVENTION_LABEL: Record<InterventionType, string> = {
  albero: 'Alberature',
  depaving: 'Depaving / superficie permeabile',
  schermatura: 'Schermatura / vela ombreggiante',
  albedo: 'Variazione albedo (materiali cool)',
  nebulizzazione: 'Micro-nebulizzazione',
  verde_tecnico: 'Tetto o parete verde',
};

export const INTERVENTION_GEOMETRY: Record<InterventionType, 'points' | 'polygon'> = {
  albero: 'points',
  depaving: 'polygon',
  schermatura: 'polygon',
  albedo: 'polygon',
  nebulizzazione: 'points',
  verde_tecnico: 'polygon',
};

export interface Quantity {
  value: number;
  unit: string;
}

export function interventionQuantity(i: Intervention): Quantity {
  switch (i.type) {
    case 'albero':
      return { value: i.geometry.coordinates.length, unit: 'alberi' };
    case 'nebulizzazione':
      return { value: i.geometry.coordinates.length, unit: 'punti' };
    default:
      return { value: Math.round(geodesicAreaM2(i.geometry)), unit: 'm²' };
  }
}

export function treeCanopyM2(i: TreeIntervention, horizon: Horizon): number {
  const d = horizon === 'maturita' ? i.params.diametroChiomaMaturaM : i.params.diametroChiomaInizialeM;
  return i.geometry.coordinates.length * Math.PI * (d / 2) ** 2;
}

/** Orizzonte temporale della valutazione: all'impianto o a maturità della chioma. */
export type Horizon = 'impianto' | 'maturita';

export interface PlausibilityIssue {
  interventionId: string | null;
  severity: 'errore' | 'avviso';
  message: string;
}

/** Controlli di plausibilità fisica e coerenza con l'AOI (F08). */
export function checkInterventions(
  interventions: readonly Intervention[],
  aoi: Polygon,
  aoiAreaM2: number,
  horizon: Horizon,
): PlausibilityIssue[] {
  const issues: PlausibilityIssue[] = [];
  const err = (i: Intervention | null, message: string) =>
    issues.push({ interventionId: i?.id ?? null, severity: 'errore', message });
  const warn = (i: Intervention | null, message: string) =>
    issues.push({ interventionId: i?.id ?? null, severity: 'avviso', message });

  let polygonAreaSum = 0;
  for (const i of interventions) {
    const points = i.geometry.type === 'MultiPoint' ? i.geometry.coordinates : (i.geometry.coordinates[0] ?? []);
    if (points.length === 0) {
      err(i, `${i.label}: geometria vuota, posiziona l'intervento sulla mappa.`);
      continue;
    }
    const outside = points.filter((p) => !pointInPolygon(p[0]!, p[1]!, aoi)).length;
    if (outside > 0) err(i, `${i.label}: ${outside} vertici/punti fuori dall'area di interesse.`);

    switch (i.type) {
      case 'albero': {
        const p = i.params;
        if (p.diametroChiomaInizialeM < 0.5 || p.diametroChiomaInizialeM > 15)
          err(i, `${i.label}: diametro chioma iniziale fuori da 0,5–15 m.`);
        if (p.diametroChiomaMaturaM < p.diametroChiomaInizialeM || p.diametroChiomaMaturaM > 30)
          err(i, `${i.label}: diametro chioma matura deve essere ≥ iniziale e ≤ 30 m.`);
        const canopy = treeCanopyM2(i, horizon);
        if (canopy > aoiAreaM2) warn(i, `${i.label}: chioma totale (${Math.round(canopy)} m²) superiore all'AOI: possibili sovrapposizioni.`);
        const density = i.geometry.coordinates.length / (aoiAreaM2 / 10_000);
        if (density > 400) warn(i, `${i.label}: densità ${Math.round(density)} alberi/ha non plausibile in uno spazio pubblico.`);
        break;
      }
      case 'albedo':
        if (i.params.albedoIniziale < 0 || i.params.albedoFinale > 1 || i.params.albedoFinale <= i.params.albedoIniziale)
          err(i, `${i.label}: albedo deve essere in [0,1] con valore finale > iniziale.`);
        warn(i, `${i.label}: superfici ad alta riflettanza possono aumentare abbagliamento e radiazione riflessa sui pedoni.`);
        break;
      case 'nebulizzazione':
        if (i.params.portataLH <= 0 || i.params.portataLH > 200) err(i, `${i.label}: portata per punto fuori da 0–200 l/h.`);
        if (i.params.raggioInfluenzaM <= 0 || i.params.raggioInfluenzaM > 15) err(i, `${i.label}: raggio d'influenza fuori da 0–15 m.`);
        break;
      case 'depaving':
        if (i.params.permeabilitaPct < 0 || i.params.permeabilitaPct > 100) err(i, `${i.label}: permeabilità fuori da 0–100%.`);
        break;
      case 'verde_tecnico':
        warn(i, `${i.label}: effetto sul piano pedonale molto limitato; valuta soprattutto benefici sull'edificio e sul drenaggio.`);
        break;
      case 'schermatura':
        if (i.params.oreOmbraGiorno < 0 || i.params.oreOmbraGiorno > 16) err(i, `${i.label}: ore di ombra fuori da 0–16.`);
        break;
    }
    if (i.geometry.type === 'Polygon') {
      const a = geodesicAreaM2(i.geometry);
      polygonAreaSum += a;
      if (a > aoiAreaM2) err(i, `${i.label}: superficie (${Math.round(a)} m²) maggiore dell'AOI.`);
    }
  }
  if (polygonAreaSum > aoiAreaM2 * 1.2) {
    warn(null, 'La somma delle superfici di intervento supera l’AOI: verifica le sovrapposizioni.');
  }
  return issues;
}
