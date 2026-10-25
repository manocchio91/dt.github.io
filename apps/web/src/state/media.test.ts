import { describe, expect, it, vi } from 'vitest';
import { mediaPath, stripJpegMetadata, stripMetadata, stripPngMetadata } from './media';
import { isSecretKey, readSupabaseConfig } from './supabase';

const ORG = '00000000-0000-4000-8000-00000000d3e0';
const PRJ = '00000000-0000-4000-8000-0000000c0b01';

function seg(marker: number, payload: number[]): number[] {
  const len = payload.length + 2;
  return [0xff, marker, len >> 8, len & 0xff, ...payload];
}

describe('Percorsi media per tenant', () => {
  it('costruisce {org}/{progetto}/{uuid}.{ext}', () => {
    expect(mediaPath(ORG, PRJ, 'image/jpeg', 'abc')).toBe(`${ORG}/${PRJ}/abc.jpg`);
  });
  it('rifiuta tipi non ammessi e id non validi', () => {
    expect(() => mediaPath(ORG, PRJ, 'application/x-msdownload')).toThrow(/non ammesso/);
    expect(() => mediaPath('../etc', PRJ, 'image/png')).toThrow(/non validi/);
  });
});

describe('Rimozione metadati (EXIF/GPS)', () => {
  it('JPEG: elimina APP1 e conserva gli altri segmenti e i dati compressi', () => {
    const exif = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, 0x47, 0x50, 0x53]; // "Exif\0\0GPS"
    const app0 = [0x4a, 0x46, 0x49, 0x46, 0x00];
    const scan = [0xff, 0xda, 0x00, 0x04, 0x01, 0x02, 0x33, 0x44, 0xff, 0xd9];
    const jpeg = Uint8Array.from([0xff, 0xd8, ...seg(0xe0, app0), ...seg(0xe1, exif), ...seg(0xdb, [1, 2, 3]), ...scan]);
    const out = stripJpegMetadata(jpeg);
    expect(Array.from(out)).toEqual([0xff, 0xd8, ...seg(0xe0, app0), ...seg(0xdb, [1, 2, 3]), ...scan]);
    expect(new TextDecoder().decode(out)).not.toContain('GPS');
  });

  it('JPEG malformato: errore, nessun caricamento silenzioso', () => {
    expect(() => stripJpegMetadata(Uint8Array.from([0x00, 0x01]))).toThrow();
    expect(() => stripJpegMetadata(Uint8Array.from([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x40, 0x01]))).toThrow(/troncato/);
  });

  it('PNG: elimina eXIf e chunk di testo', () => {
    const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    const chunk = (type: string, data: number[]) => [0, 0, 0, data.length, ...[...type].map((c) => c.charCodeAt(0)), ...data, 0, 0, 0, 0];
    const png = Uint8Array.from([...sig, ...chunk('IHDR', [1, 2]), ...chunk('eXIf', [9, 9, 9]), ...chunk('tEXt', [7]), ...chunk('IEND', [])]);
    expect(Array.from(stripPngMetadata(png))).toEqual([...sig, ...chunk('IHDR', [1, 2]), ...chunk('IEND', [])]);
  });

  it('PDF: invariato e dichiarato non ripulito', () => {
    const pdf = Uint8Array.from([0x25, 0x50, 0x44, 0x46]);
    expect(stripMetadata(pdf, 'application/pdf')).toEqual({ bytes: pdf, removed: [], stripped: false });
  });
});

describe('Configurazione Supabase', () => {
  it('assente o incompleta → modalità solo locale', () => {
    expect(readSupabaseConfig({} as ImportMetaEnv)).toBeNull();
    expect(readSupabaseConfig({ VITE_SUPABASE_URL: 'https://x.supabase.co' } as ImportMetaEnv)).toBeNull();
    expect(readSupabaseConfig({ VITE_SUPABASE_URL: 'ftp://x', VITE_SUPABASE_ANON_KEY: 'k' } as ImportMetaEnv)).toBeNull();
    expect(readSupabaseConfig({ VITE_SUPABASE_URL: 'https://x.supabase.co', VITE_SUPABASE_ANON_KEY: 'k' } as ImportMetaEnv)).toEqual({ url: 'https://x.supabase.co', key: 'k' });
  });

  it('la publishable key ha la precedenza sulla vecchia anon key', () => {
    const env = { VITE_SUPABASE_URL: 'https://x.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_abc', VITE_SUPABASE_ANON_KEY: 'k' } as ImportMetaEnv;
    expect(readSupabaseConfig(env)).toEqual({ url: 'https://x.supabase.co', key: 'sb_publishable_abc' });
  });

  it('una chiave segreta o di servizio non entra mai nel client', () => {
    const jwt = (role: string) => `eyJhbGciOiJIUzI1NiJ9.${btoa(JSON.stringify({ role })).replace(/=+$/, '')}.firma`;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    for (const key of ['sb_secret_abc', jwt('service_role'), jwt('authenticated'), 'eyJ.non-decodificabile.x']) {
      expect(readSupabaseConfig({ VITE_SUPABASE_URL: 'https://x.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: key } as ImportMetaEnv), key).toBeNull();
    }
    expect(isSecretKey(jwt('anon'))).toBe(false);
    expect(isSecretKey('sb_publishable_abc')).toBe(false);
  });
});
