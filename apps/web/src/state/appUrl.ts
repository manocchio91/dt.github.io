/**
 * Percorso di pubblicazione dell'app. In locale è "/"; su GitHub Pages è la
 * sottocartella del repository (es. "/dt.github.io/"), impostata in build con VITE_BASE.
 */
export const APP_BASE: string = import.meta.env.BASE_URL || '/';

/** basename per React Router: senza barra finale, "/" se l'app è alla radice. */
export const ROUTER_BASENAME = APP_BASE.replace(/\/+$/, '') || '/';

/** URL assoluto di una rotta dell'app (link condivisi, ritorno dal login via email). */
export function appUrl(path: string, origin: string = window.location.origin): string {
  const base = APP_BASE.replace(/\/+$/, '');
  return `${origin}${base}${path.startsWith('/') ? path : `/${path}`}`;
}

/** Percorso di un file statico in public/ (es. favicon). */
export function assetUrl(file: string): string {
  return `${APP_BASE}${file.replace(/^\/+/, '')}`;
}
