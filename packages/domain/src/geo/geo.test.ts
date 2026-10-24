import { describe, expect, it } from 'vitest';
import { buildGrid, geodesicAreaM2, parseGeoJsonPolygons, polygonFromVertices, validateAoi } from './geo';
import { CAMPOBASSO_AOI } from '../seeds/seeds';

describe('AOI', () => {
  it('calcola la superficie geodetica del rettangolo DEMO (~90 × 60 m)', () => {
    const a = geodesicAreaM2(CAMPOBASSO_AOI);
    expect(a).toBeGreaterThan(5000);
    expect(a).toBeLessThan(5700);
  });

  it('valida un poligono corretto con centroide e bbox', () => {
    const v = validateAoi(CAMPOBASSO_AOI);
    expect(v.valid).toBe(true);
    expect(v.centroid?.lat).toBeCloseTo(41.5606, 3);
  });

  it('blocca un poligono auto-intersecante (farfalla)', () => {
    const bow = polygonFromVertices([
      [14.66, 41.56],
      [14.661, 41.561],
      [14.661, 41.56],
      [14.66, 41.561],
    ]);
    const v = validateAoi(bow);
    expect(v.valid).toBe(false);
    expect(v.errors.join(' ')).toMatch(/auto-interseca/);
  });

  it('blocca coordinate non WGS84 e superfici fuori scala', () => {
    expect(validateAoi(polygonFromVertices([[500000, 4600000], [500100, 4600000], [500100, 4600100]])).valid).toBe(false);
    const huge = polygonFromVertices([[14, 41], [15, 41], [15, 42], [14, 42]]);
    expect(validateAoi(huge).errors.join(' ')).toMatch(/25 km²/);
    expect(validateAoi(null).valid).toBe(false);
  });

  it('importa GeoJSON e rifiuta CRS proiettati dichiarati', () => {
    const ok = parseGeoJsonPolygons(JSON.stringify({ type: 'Feature', properties: { name: 'Piazza' }, geometry: CAMPOBASSO_AOI }));
    expect(ok.ok).toBe(true);
    expect(ok.polygons[0]?.name).toBe('Piazza');
    const bad = parseGeoJsonPolygons(
      JSON.stringify({ type: 'FeatureCollection', crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:EPSG::32633' } }, features: [] }),
    );
    expect(bad.ok).toBe(false);
    expect(parseGeoJsonPolygons('non json').ok).toBe(false);
  });
});

describe('Griglia', () => {
  it('ogni cella ha id, geometria e centro dentro l’AOI', () => {
    const g = buildGrid(CAMPOBASSO_AOI, 5);
    expect(g.cells.length).toBeGreaterThan(150);
    const ids = new Set(g.cells.map((c) => c.id));
    expect(ids.size).toBe(g.cells.length);
    const totalArea = g.cells.reduce((s, c) => s + c.areaM2, 0);
    expect(Math.abs(totalArea - geodesicAreaM2(CAMPOBASSO_AOI)) / totalArea).toBeLessThan(0.15);
  });
});
