import turfArea from '@turf/area';
import kinks from '@turf/kinks';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import type { Feature, MultiPoint, Point, Polygon, Position } from 'geojson';

export type { Polygon, Point, MultiPoint, Position };

export const STORAGE_CRS = 'EPSG:4326';
/** Superficie massima per un "micro" twin: oltre, la scala non è più quella di una piazza o parcella. */
export const MAX_AOI_M2 = 25_000_000;
export const MIN_AOI_M2 = 50;

export interface Aoi {
  id: string;
  name: string;
  geometry: Polygon;
  crs: typeof STORAGE_CRS;
  areaM2: number;
  source: 'disegno' | 'import' | 'seed';
  isDemonstrativeGeometry: boolean;
  createdAt: string;
}

export interface AoiValidation {
  valid: boolean;
  errors: string[];
  warnings: string[];
  areaM2: number | null;
  centroid: { lon: number; lat: number } | null;
  bbox: [number, number, number, number] | null;
}

export function geodesicAreaM2(polygon: Polygon): number {
  return turfArea(polygon);
}

export function closeRing(ring: Position[]): Position[] {
  if (ring.length === 0) return ring;
  const first = ring[0]!;
  const last = ring[ring.length - 1]!;
  return first[0] === last[0] && first[1] === last[1] ? ring : [...ring, first];
}

export function polygonFromVertices(vertices: Position[]): Polygon {
  return { type: 'Polygon', coordinates: [closeRing(vertices)] };
}

export function bboxOf(coords: Position[]): [number, number, number, number] {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of coords as [number, number][]) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return [minX, minY, maxX, maxY];
}

export function validateAoi(polygon: Polygon | null | undefined): AoiValidation {
  const result: AoiValidation = { valid: false, errors: [], warnings: [], areaM2: null, centroid: null, bbox: null };
  if (!polygon || polygon.type !== 'Polygon') {
    result.errors.push('La geometria deve essere un poligono (GeoJSON Polygon).');
    return result;
  }
  const outer = polygon.coordinates[0];
  if (!outer) {
    result.errors.push('Il poligono non ha un anello esterno.');
    return result;
  }
  if (polygon.coordinates.length > 1) {
    result.warnings.push('Il poligono contiene fori: verranno esclusi dalla superficie.');
  }
  for (const p of outer) {
    const [lon, lat] = p as [number, number];
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || lon < -180 || lon > 180 || lat < -90 || lat > 90) {
      result.errors.push('Coordinate fuori dai limiti WGS84 (EPSG:4326): verifica il CRS del file.');
      return result;
    }
  }
  const first = outer[0]!;
  const last = outer[outer.length - 1]!;
  if (first[0] !== last[0] || first[1] !== last[1]) {
    result.errors.push("L'anello del poligono non è chiuso.");
  }
  const distinct = new Set(outer.map((p) => `${p[0]},${p[1]}`));
  if (distinct.size < 3) {
    result.errors.push('Servono almeno 3 vertici distinti.');
    return result;
  }
  const k = kinks(polygon);
  if (k.features.length > 0) {
    result.errors.push(`Il poligono si auto-interseca (${k.features.length} punti di intersezione).`);
  }
  const area = geodesicAreaM2(polygon);
  result.areaM2 = area;
  if (area < MIN_AOI_M2) result.errors.push(`Superficie troppo piccola (< ${MIN_AOI_M2} m²).`);
  if (area > MAX_AOI_M2) {
    result.errors.push('Superficie oltre 25 km²: non è la scala di un micro digital twin. Suddividi l’area.');
  }
  result.bbox = bboxOf(outer);
  const ring = outer.slice(0, -1);
  result.centroid = {
    lon: ring.reduce((s, p) => s + p[0]!, 0) / ring.length,
    lat: ring.reduce((s, p) => s + p[1]!, 0) / ring.length,
  };
  result.valid = result.errors.length === 0;
  return result;
}

export interface GeoJsonImport {
  ok: boolean;
  polygons: { name: string; geometry: Polygon }[];
  errors: string[];
}

/** Importa poligoni da GeoJSON (RFC 7946, WGS84). Rifiuta CRS dichiarati diversi da WGS84. */
export function parseGeoJsonPolygons(text: string): GeoJsonImport {
  const out: GeoJsonImport = { ok: false, polygons: [], errors: [] };
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    out.errors.push('Il file non è un JSON valido.');
    return out;
  }
  const obj = json as { type?: string; crs?: { properties?: { name?: string } } };
  const crsName = obj.crs?.properties?.name;
  if (crsName && !/CRS84|4326/.test(crsName)) {
    out.errors.push(
      `CRS dichiarato "${crsName}" non supportato: converti il file in WGS84 (EPSG:4326). La conversione lato server è prevista in M1.`,
    );
    return out;
  }
  const features: Feature[] = [];
  if (obj.type === 'FeatureCollection') features.push(...((json as { features: Feature[] }).features ?? []));
  else if (obj.type === 'Feature') features.push(json as Feature);
  else if (obj.type === 'Polygon' || obj.type === 'MultiPolygon')
    features.push({ type: 'Feature', properties: {}, geometry: json as Polygon });
  else {
    out.errors.push('Tipo GeoJSON non riconosciuto.');
    return out;
  }
  features.forEach((f, i) => {
    const name = String((f.properties as Record<string, unknown> | null)?.name ?? `Poligono ${i + 1}`);
    if (f.geometry?.type === 'Polygon') out.polygons.push({ name, geometry: f.geometry });
    else if (f.geometry?.type === 'MultiPolygon') {
      f.geometry.coordinates.forEach((c, j) =>
        out.polygons.push({ name: `${name} (${j + 1})`, geometry: { type: 'Polygon', coordinates: c } }),
      );
    }
  });
  if (out.polygons.length === 0) out.errors.push('Nessun poligono trovato nel file.');
  out.ok = out.errors.length === 0;
  return out;
}

export function pointInPolygon(lon: number, lat: number, polygon: Polygon): boolean {
  return booleanPointInPolygon([lon, lat], polygon);
}

/** Proiezione locale equirettangolare attorno a un'origine (errore trascurabile alla scala di centinaia di metri). */
export interface LocalFrame {
  lon0: number;
  lat0: number;
  mPerDegLon: number;
  mPerDegLat: number;
}

export function localFrame(lon0: number, lat0: number): LocalFrame {
  const phi = (lat0 * Math.PI) / 180;
  return {
    lon0,
    lat0,
    mPerDegLon: 111_412.84 * Math.cos(phi) - 93.5 * Math.cos(3 * phi),
    mPerDegLat: 111_132.92 - 559.82 * Math.cos(2 * phi) + 1.175 * Math.cos(4 * phi),
  };
}

export function toLocal(f: LocalFrame, lon: number, lat: number): [number, number] {
  return [(lon - f.lon0) * f.mPerDegLon, (lat - f.lat0) * f.mPerDegLat];
}

export function toLonLat(f: LocalFrame, x: number, y: number): [number, number] {
  return [f.lon0 + x / f.mPerDegLon, f.lat0 + y / f.mPerDegLat];
}

export function distanceM(f: LocalFrame, a: [number, number], b: [number, number]): number {
  const [ax, ay] = toLocal(f, a[0], a[1]);
  const [bx, by] = toLocal(f, b[0], b[1]);
  return Math.hypot(ax - bx, ay - by);
}

export interface GridCell {
  id: string;
  row: number;
  col: number;
  center: [number, number];
  polygon: Polygon;
  areaM2: number;
}

export interface Grid {
  cellSizeM: number;
  cells: GridCell[];
  frame: LocalFrame;
  method: string;
}

/**
 * Griglia regolare sull'AOI. Una cella è inclusa se il suo centro cade nell'AOI
 * (approssimazione dichiarata ai bordi). La dimensione cresce automaticamente
 * per non superare maxCells.
 */
export function buildGrid(polygon: Polygon, cellSizeM: number, maxCells = 3000): Grid {
  const outer = polygon.coordinates[0]!;
  const [minX, minY, maxX, maxY] = bboxOf(outer);
  const frame = localFrame(minX, minY);
  const [w, h] = toLocal(frame, maxX, maxY);
  let size = cellSizeM;
  while (Math.ceil(w / size) * Math.ceil(h / size) > maxCells * 2) size *= 1.5;
  const cols = Math.ceil(w / size);
  const rows = Math.ceil(h / size);
  const cells: GridCell[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cx = (c + 0.5) * size;
      const cy = (r + 0.5) * size;
      const center = toLonLat(frame, cx, cy);
      if (!pointInPolygon(center[0], center[1], polygon)) continue;
      const corners = [
        toLonLat(frame, c * size, r * size),
        toLonLat(frame, (c + 1) * size, r * size),
        toLonLat(frame, (c + 1) * size, (r + 1) * size),
        toLonLat(frame, c * size, (r + 1) * size),
      ];
      cells.push({
        id: `r${r}c${c}`,
        row: r,
        col: c,
        center,
        polygon: polygonFromVertices(corners),
        areaM2: size * size,
      });
    }
  }
  return {
    cellSizeM: Math.round(size * 10) / 10,
    cells,
    frame,
    method: `Griglia regolare ${Math.round(size * 10) / 10} m in proiezione locale equirettangolare; cella inclusa se il centro cade nell'AOI.`,
  };
}

export function formatArea(m2: number): string {
  if (m2 >= 10_000) return `${(m2 / 10_000).toLocaleString('it-IT', { maximumFractionDigits: 2 })} ha`;
  return `${Math.round(m2).toLocaleString('it-IT')} m²`;
}
