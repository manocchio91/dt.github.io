import { describe, expect, it } from 'vitest';
import { appUrl, assetUrl, ROUTER_BASENAME } from '../state/appUrl';

describe('Percorso di pubblicazione (GitHub Pages)', () => {
  it('in locale l’app è alla radice', () => {
    expect(ROUTER_BASENAME).toBe('/');
    expect(appUrl('/condiviso/abc', 'https://esempio.it')).toBe('https://esempio.it/condiviso/abc');
    expect(assetUrl('/favicon.svg')).toBe('/favicon.svg');
  });
});
