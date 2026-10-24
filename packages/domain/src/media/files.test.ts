import { describe, expect, it } from 'vitest';
// @ts-expect-error libreria senza tipi, usata solo nei test per scrivere/leggere EXIF reali
import piexif from 'piexifjs';
import { checkFile, inspectContent, inspectPdf, normalizeFileName, sniffKind, stripMetadata, stripPngMetadata, stripWebpMetadata } from './files';

/** JPEG 1×1 reale (baseline). */
const TINY_JPEG_B64 =
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';

const toBin = (b: Uint8Array) => String.fromCharCode(...b);
const fromBin = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));
const b64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** Inserisce un EXIF reale con coordinate GPS (Campobasso) e modello della fotocamera. */
function jpegWithGps(): Uint8Array {
  const exif = {
    '0th': { [piexif.ImageIFD.Make]: 'FotocameraTest', [piexif.ImageIFD.Model]: 'Modello-XYZ' },
    Exif: { [piexif.ExifIFD.DateTimeOriginal]: '2026:07:20 15:00:00' },
    GPS: {
      [piexif.GPSIFD.GPSLatitudeRef]: 'N',
      [piexif.GPSIFD.GPSLatitude]: [
        [41, 1],
        [33, 1],
        [3801, 100],
      ],
      [piexif.GPSIFD.GPSLongitudeRef]: 'E',
      [piexif.GPSIFD.GPSLongitude]: [
        [14, 1],
        [39, 1],
        [4800, 100],
      ],
    },
  };
  return fromBin(piexif.insert(piexif.dump(exif), toBin(b64(TINY_JPEG_B64))));
}

describe('Rimozione effettiva di EXIF e GPS', () => {
  it('JPEG: prima ci sono GPS e modello, dopo non c’è più nulla', () => {
    const withGps = jpegWithGps();
    const before = piexif.load(toBin(withGps));
    expect(before.GPS[piexif.GPSIFD.GPSLatitude]).toBeDefined();
    expect(toBin(withGps)).toContain('Modello-XYZ');

    const r = stripMetadata(withGps, 'image/jpeg');
    expect(r.stripped).toBe(true);
    expect(r.removed.join(' ')).toMatch(/EXIF.*GPS/);
    const after = piexif.load(toBin(r.bytes));
    expect(Object.keys(after.GPS)).toHaveLength(0);
    expect(Object.keys(after['0th'])).toHaveLength(0);
    expect(toBin(r.bytes)).not.toContain('Modello-XYZ');
    expect(toBin(r.bytes)).not.toContain('Exif');
    // l'immagine resta un JPEG con i dati compressi intatti
    expect(sniffKind(r.bytes)).toBe('jpeg');
    expect(Array.from(r.bytes.slice(-12))).toEqual(Array.from(withGps.slice(-12)));
  });

  it('PNG: elimina eXIf e testo, conserva i dati immagine', () => {
    const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    const chunk = (type: string, data: number[]) => [0, 0, 0, data.length, ...[...type].map((c) => c.charCodeAt(0)), ...data, 0, 0, 0, 0];
    const gpsTiff = [...'GPSLatitude41.5605'].map((c) => c.charCodeAt(0));
    const png = Uint8Array.from([...sig, ...chunk('IHDR', [1, 2]), ...chunk('eXIf', gpsTiff), ...chunk('tEXt', [65]), ...chunk('IDAT', [9, 9]), ...chunk('IEND', [])]);
    const out = stripPngMetadata(png);
    expect(toBin(out)).not.toContain('GPSLatitude');
    expect(toBin(out)).toContain('IDAT');
  });

  it('WebP: elimina EXIF e XMP, azzera i flag e corregge la dimensione RIFF', () => {
    const u32 = (n: number) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];
    const ch = (cc: string, data: number[]) => [...[...cc].map((c) => c.charCodeAt(0)), ...u32(data.length), ...data, ...(data.length % 2 ? [0] : [])];
    const vp8x = ch('VP8X', [0x0c, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const body = [...vp8x, ...ch('VP8L', [1, 2, 3, 4]), ...ch('EXIF', [...'GPS41.56'].map((c) => c.charCodeAt(0))), ...ch('XMP ', [1, 2])];
    const webp = Uint8Array.from([...'RIFF'].map((c) => c.charCodeAt(0)).concat(u32(4 + body.length), [...'WEBP'].map((c) => c.charCodeAt(0)), body));
    const out = stripWebpMetadata(webp);
    expect(toBin(out)).not.toContain('GPS41');
    expect(toBin(out)).not.toContain('XMP ');
    expect(out[20]! & 0x0c).toBe(0);
    expect(new DataView(out.buffer).getUint32(4, true)).toBe(out.length - 8);
  });

  it('PDF: non viene modificato e lo dichiara', () => {
    const pdf = new TextEncoder().encode('%PDF-1.7\n...');
    expect(stripMetadata(pdf, 'application/pdf')).toEqual({ bytes: pdf, removed: [], stripped: false });
  });
});

describe('Tipo reale del file e blocchi di sicurezza', () => {
  const jpeg = jpegWithGps();
  const pdf = new TextEncoder().encode('%PDF-1.7 documento');

  it('accetta un JPEG coerente', () => {
    const c = checkFile({ name: 'Foto Sopralluogo.JPG', size: jpeg.length, declaredMime: 'image/jpeg', head: jpeg });
    expect(c).toMatchObject({ ok: true, mime: 'image/jpeg', ext: 'jpg', normalizedName: 'foto-sopralluogo.jpg' });
  });

  it('estensione contraffatta: un PDF chiamato .jpg viene rifiutato', () => {
    const c = checkFile({ name: 'foto.jpg', size: pdf.length, declaredMime: 'image/jpeg', head: pdf });
    expect(c.ok).toBe(false);
    expect(c.errors.join(' ')).toMatch(/Documento PDF.*\.jpg/);
  });

  it('MIME falso dichiarato dal dispositivo viene rifiutato', () => {
    const c = checkFile({ name: 'relazione.pdf', size: pdf.length, declaredMime: 'image/png', head: pdf });
    expect(c.ok).toBe(false);
    expect(c.errors.join(' ')).toMatch(/tipo dichiarato/);
  });

  it('eseguibile rinominato in .jpg, script e pagine web: bloccati', () => {
    const exe = Uint8Array.from([0x4d, 0x5a, 0x90, 0, 3, 0]);
    expect(checkFile({ name: 'foto.jpg', size: 6, declaredMime: 'image/jpeg', head: exe }).errors.join(' ')).toMatch(/Programmi, script/);
    expect(checkFile({ name: 'x.svg', size: 10, declaredMime: 'image/svg+xml', head: new TextEncoder().encode('<svg onload=') }).ok).toBe(false);
    expect(checkFile({ name: 'run.sh', size: 10, declaredMime: 'text/plain', head: new TextEncoder().encode('#!/bin/sh') }).ok).toBe(false);
  });

  it('HEIC: rifiutato con un messaggio comprensibile (non dichiarato supportato)', () => {
    const heic = Uint8Array.from([0, 0, 0, 24, ...'ftypheic'].map((c) => (typeof c === 'string' ? c.charCodeAt(0) : c)));
    const c = checkFile({ name: 'IMG_0001.HEIC', size: 2_000_000, declaredMime: 'image/heic', head: heic });
    expect(c.ok).toBe(false);
    expect(c.kind).toBe('heic');
    expect(c.errors[0]).toMatch(/HEIC.*non sono ancora supportate.*JPEG/);
  });

  it('file troppo grande rispetto al limite configurato', () => {
    const c = checkFile({ name: 'foto.jpg', size: 6 * 1024 * 1024, declaredMime: 'image/jpeg', head: jpeg, maxBytes: 5 * 1024 * 1024 });
    expect(c.ok).toBe(false);
    expect(c.errors[0]).toMatch(/troppo grande \(6 MB\).*5 MB/);
  });

  it('archivi e formati sconosciuti: rifiutati', () => {
    expect(checkFile({ name: 'a.zip', size: 4, declaredMime: 'application/zip', head: Uint8Array.from([0x50, 0x4b, 3, 4]) }).ok).toBe(false);
    expect(checkFile({ name: 'a.txt', size: 4, declaredMime: 'text/plain', head: new TextEncoder().encode('ciao') }).errors.join(' ')).toMatch(/Formato non supportato/);
  });

  it('nomi normalizzati: niente percorsi, accenti o caratteri speciali', () => {
    expect(normalizeFileName('C:\\dati\\Relazione Geologica – Città (v2).PDF')).toBe('relazione-geologica-citta-v2.pdf');
    expect(normalizeFileName('../../etc/passwd')).toBe('passwd');
    expect(normalizeFileName('.....jpg')).toBe('jpg');
  });
});

describe('PDF: controllo euristico (non è una sanitizzazione)', () => {
  const pdf = (body: string) => new TextEncoder().encode(`%PDF-1.7\n${body}\n%%EOF`);

  it('rifiuta JavaScript, azioni di avvio, allegati incorporati, contenuti attivi e cifratura', () => {
    expect(inspectPdf(pdf('<< /OpenAction << /S /JavaScript /JS (app.alert(1)) >> >>'))).toContain('JavaScript incorporato');
    expect(inspectPdf(pdf('<< /JS 12 0 R >>'))).toContain('JavaScript incorporato');
    expect(inspectPdf(pdf('<< /S /Launch /F (cmd.exe) >>'))).toContain('azioni che avviano programmi');
    expect(inspectPdf(pdf('<< /Names << /EmbeddedFiles 5 0 R >> >>'))).toContain('file allegati incorporati');
    expect(inspectPdf(pdf('<< /Type /Annot /Subtype /RichMedia >>'))).toContain('contenuti multimediali attivi');
    expect(inspectPdf(pdf('trailer << /Encrypt 9 0 R >>'))).toContain('cifratura (il contenuto non può essere verificato)');
  });

  it('accetta un PDF semplice e dichiara che i metadati restano', () => {
    const plain = pdf('1 0 obj << /Type /Catalog >> endobj 2 0 obj << /Author (Mario Rossi) /Producer (Writer) >> endobj');
    expect(inspectPdf(plain)).toEqual([]);
    expect(inspectContent(plain, 'application/pdf')).toEqual([]);
    // i metadati non vengono toccati: lo dichiara stripMetadata
    expect(stripMetadata(plain, 'application/pdf')).toMatchObject({ stripped: false, removed: [] });
    expect(new TextDecoder().decode(stripMetadata(plain, 'application/pdf').bytes)).toContain('Mario Rossi');
    expect(inspectContent(pdf('<< /JS (x) >>'), 'application/pdf')[0]).toMatch(/PDF non ammesso: contiene JavaScript incorporato/);
  });
});
