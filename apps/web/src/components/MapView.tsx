import { useEffect, useRef, useState } from 'react';
import maplibregl, { type GeoJSONSource, type StyleSpecification } from 'maplibre-gl';
import type { Feature, FeatureCollection } from 'geojson';
import { bboxOf, localFrame, polygonFromVertices, toLonLat, type Polygon, type Position } from '@mdt/domain';

export interface MapPolygon {
  id: string;
  geometry: Polygon;
  kind: 'aoi' | 'zona' | 'intervento' | 'cella';
  label?: string;
  color?: string;
}

export interface MapPoint {
  id: string;
  coordinates: Position;
  kind: 'albero' | 'nebulizzatore' | 'punto';
  label?: string;
  radiusM?: number;
}

const OSM_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      maxzoom: 19,
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors (ODbL)',
    },
  },
  layers: [{ id: 'osm', type: 'raster', source: 'osm', paint: { 'raster-saturation': -0.4 } }],
};

const KIND_COLOR: Record<MapPolygon['kind'], string> = {
  aoi: '#0f4c5c',
  zona: '#3d7a47',
  intervento: '#c8963e',
  cella: '#2a7186',
};

function circlePolygon(center: Position, radiusM: number, steps = 24): Polygon {
  const f = localFrame(center[0]!, center[1]!);
  const ring: Position[] = [];
  for (let k = 0; k < steps; k++) {
    const a = (k / steps) * 2 * Math.PI;
    ring.push(toLonLat(f, Math.cos(a) * radiusM, Math.sin(a) * radiusM));
  }
  return polygonFromVertices(ring);
}

const empty: FeatureCollection = { type: 'FeatureCollection', features: [] };

export interface MapViewProps {
  ariaLabel: string;
  polygons: MapPolygon[];
  points?: MapPoint[];
  fitTo?: Polygon | null;
  center?: [number, number];
  drawMode?: 'polygon' | 'points' | null;
  onDrawComplete?: (coords: Position[]) => void;
  onDrawCancel?: () => void;
  height?: string;
}

export function MapView({ ariaLabel, polygons, points = [], fitTo, center, drawMode = null, onDrawComplete, onDrawCancel, height = '22rem' }: MapViewProps) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [cursor, setCursor] = useState<[number, number] | null>(null);
  const [vertices, setVertices] = useState<Position[]>([]);
  const drawRef = useRef(drawMode);
  useEffect(() => {
    drawRef.current = drawMode;
  }, [drawMode]);

  // inizializzazione unica della mappa
  useEffect(() => {
    if (!container.current) return;
    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container: container.current,
        style: OSM_STYLE,
        center: center ?? [14.6633, 41.5606],
        zoom: 16,
        attributionControl: { compact: true },
      });
    } catch {
      // WebGL non disponibile
      queueMicrotask(() => setFailed(true));
      return;
    }
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');
    map.on('load', () => {
      map.addSource('polys', { type: 'geojson', data: empty });
      map.addSource('pts', { type: 'geojson', data: empty });
      map.addSource('draw', { type: 'geojson', data: empty });
      map.addLayer({
        id: 'polys-fill',
        type: 'fill',
        source: 'polys',
        paint: { 'fill-color': ['get', 'color'], 'fill-opacity': ['get', 'opacity'] },
      });
      map.addLayer({
        id: 'polys-line',
        type: 'line',
        source: 'polys',
        filter: ['!=', ['get', 'kind'], 'cella'],
        paint: { 'line-color': ['get', 'lineColor'], 'line-width': ['get', 'lineWidth'], 'line-dasharray': [2, 1] },
      });
      map.addLayer({
        id: 'pts-circle',
        type: 'circle',
        source: 'pts',
        paint: { 'circle-radius': 5, 'circle-color': ['get', 'color'], 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2 },
      });
      map.addLayer({ id: 'draw-line', type: 'line', source: 'draw', paint: { 'line-color': '#8a2417', 'line-width': 3 } });
      map.addLayer({
        id: 'draw-pts',
        type: 'circle',
        source: 'draw',
        filter: ['==', ['geometry-type'], 'Point'],
        paint: { 'circle-radius': 6, 'circle-color': '#8a2417', 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 },
      });
      setLoaded(true);
    });
    map.on('mousemove', (e) => setCursor([e.lngLat.lng, e.lngLat.lat]));
    map.on('click', (e) => {
      if (!drawRef.current) return;
      setVertices((v) => [...v, [Number(e.lngLat.lng.toFixed(7)), Number(e.lngLat.lat.toFixed(7))]]);
    });
    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (map) map.getCanvas().style.cursor = drawMode ? 'crosshair' : '';
    queueMicrotask(() => setVertices([]));
  }, [drawMode]);

  // dati
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    const polyFeatures: Feature[] = polygons.map((p) => ({
      type: 'Feature',
      geometry: p.geometry,
      properties: {
        kind: p.kind,
        color: p.color ?? KIND_COLOR[p.kind],
        opacity: p.kind === 'cella' ? 0.75 : p.kind === 'aoi' ? 0.08 : 0.35,
        lineColor: p.kind === 'aoi' ? '#0b3440' : KIND_COLOR[p.kind],
        lineWidth: p.kind === 'aoi' ? 3 : 2,
      },
    }));
    for (const pt of points) {
      if (pt.radiusM) {
        polyFeatures.push({
          type: 'Feature',
          geometry: circlePolygon(pt.coordinates, pt.radiusM),
          properties: { kind: 'intervento', color: pt.kind === 'albero' ? '#3d7a47' : '#2a7186', opacity: 0.3, lineColor: '#24552d', lineWidth: 1 },
        });
      }
    }
    (map.getSource('polys') as GeoJSONSource).setData({ type: 'FeatureCollection', features: polyFeatures });
    (map.getSource('pts') as GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: points.map((pt) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: pt.coordinates },
        properties: { color: pt.kind === 'albero' ? '#24552d' : pt.kind === 'nebulizzatore' ? '#2a7186' : '#8a2417' },
      })),
    });
  }, [polygons, points, loaded]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    const features: Feature[] = vertices.map((v) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: v }, properties: {} }));
    if (drawMode === 'polygon' && vertices.length >= 2) {
      features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: [...vertices, vertices[0]!] }, properties: {} });
    }
    (map.getSource('draw') as GeoJSONSource).setData({ type: 'FeatureCollection', features });
  }, [vertices, loaded, drawMode]);

  const fitKey = fitTo ? JSON.stringify(bboxOf(fitTo.coordinates[0] ?? [])) : '';
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !fitTo || !loaded) return;
    const [a, b, c, d] = bboxOf(fitTo.coordinates[0] ?? []);
    map.fitBounds(
      [
        [a, b],
        [c, d],
      ],
      { padding: 40, duration: 0, maxZoom: 19 },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey, loaded]);

  const canFinish = drawMode === 'polygon' ? vertices.length >= 3 : vertices.length >= 1;

  return (
    <div className="space-y-2">
      {drawMode && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border-2 border-alert-800 bg-alert-100 p-2 text-sm" role="group" aria-label="Strumenti di disegno">
          <span className="font-semibold text-alert-800">
            {drawMode === 'polygon' ? 'Clicca sulla mappa per aggiungere i vertici del poligono.' : 'Clicca sulla mappa per posizionare i punti.'} ({vertices.length})
          </span>
          <button type="button" className="btn-primary" disabled={!canFinish} onClick={() => onDrawComplete?.(vertices)}>
            {drawMode === 'polygon' ? 'Chiudi poligono' : 'Conferma punti'}
          </button>
          <button type="button" className="btn-secondary" disabled={vertices.length === 0} onClick={() => setVertices((v) => v.slice(0, -1))}>
            Annulla ultimo
          </button>
          <button type="button" className="btn-ghost" onClick={() => onDrawCancel?.()}>
            Esci dal disegno
          </button>
        </div>
      )}
      <div className="relative overflow-hidden rounded-xl border border-sand-200" style={{ height }}>
        {failed ? (
          <div className="flex h-full items-center justify-center bg-sand-100 p-4 text-center text-sm">
            Mappa non disponibile (WebGL assente). Usa l’import GeoJSON o l’inserimento di coordinate.
          </div>
        ) : (
          <div ref={container} className="h-full w-full" role="region" aria-label={ariaLabel} />
        )}
        {cursor && (
          <p className="pointer-events-none absolute right-2 bottom-2 rounded bg-white/90 px-2 py-0.5 font-mono text-[0.7rem] text-sand-900">
            {cursor[1].toFixed(5)}, {cursor[0].toFixed(5)} · EPSG:4326
          </p>
        )}
      </div>
    </div>
  );
}

/** Scala sequenziale per le riduzioni di temperatura (0 → −15 °C). */
export const COOLING_BINS: { max: number; min: number; color: string; label: string }[] = [
  { max: 0, min: -0.5, color: '#f3efe7', label: '0 … −0,5' },
  { max: -0.5, min: -2, color: '#cfe3e8', label: '−0,5 … −2' },
  { max: -2, min: -4, color: '#9cc6d1', label: '−2 … −4' },
  { max: -4, min: -7, color: '#5b9db0', label: '−4 … −7' },
  { max: -7, min: -10, color: '#2a7186', label: '−7 … −10' },
  { max: -10, min: -100, color: '#0b3440', label: '< −10' },
];

export function coolingColor(v: number): string {
  return (COOLING_BINS.find((b) => v <= b.max && v > b.min) ?? COOLING_BINS[COOLING_BINS.length - 1]!).color;
}

export function CoolingLegend({ title }: { title: string }) {
  return (
    <figure className="text-xs">
      <figcaption className="mb-1 font-semibold">{title}</figcaption>
      <ul className="flex flex-wrap gap-x-3 gap-y-1">
        {COOLING_BINS.map((b) => (
          <li key={b.label} className="flex items-center gap-1">
            <span className="inline-block size-4 rounded-sm border border-sand-400" style={{ background: b.color }} aria-hidden="true" />
            {b.label} °C
          </li>
        ))}
      </ul>
    </figure>
  );
}
