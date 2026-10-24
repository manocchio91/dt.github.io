/**
 * Controlli sui file caricati: tipo reale dai primi byte (non dall'estensione),
 * dimensione, nome normalizzato, rimozione dei metadati (EXIF/GPS/XMP).
 * Nessun antivirus: la scansione malware è in roadmap (B-123).
 */

export const ALLOWED_MEDIA: Record<string, { ext: string; label: string; image: boolean }> = {
  'image/jpeg': { ext: 'jpg', label: 'Immagine JPEG', image: true },
  'image/png': { ext: 'png', label: 'Immagine PNG', image: true },
  'image/webp': { ext: 'webp', label: 'Immagine WebP', image: true },
  'application/pdf': { ext: 'pdf', label: 'Documento PDF', image: false },
};

export const DEFAULT_MAX_BYTES = 20 * 1024 * 1024;

export type SniffKind = 'jpeg' | 'png' | 'webp' | 'pdf' | 'heic' | 'eseguibile' | 'archivio' | 'sconosciuto';

const startsWith = (b: Uint8Array, sig: number[], offset = 0) => sig.every((x, i) => b[offset + i] === x);
const ascii = (b: Uint8Array, from: number, len: number) => String.fromCharCode(...b.slice(from, from + len));

/** Riconosce il formato dai "magic bytes". */
export function sniffKind(b: Uint8Array): SniffKind {
  if (startsWith(b, [0xff, 0xd8, 0xff])) return 'jpeg';
  if (startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') return 'webp';
  if (ascii(b, 0, 5) === '%PDF-') return 'pdf';
  if (ascii(b, 4, 4) === 'ftyp' && /^(heic|heix|hevc|hevx|heim|heis|mif1|msf1|avif)$/.test(ascii(b, 8, 4))) return 'heic';
  if (startsWith(b, [0x4d, 0x5a]) || startsWith(b, [0x7f, 0x45, 0x4c, 0x46]) || startsWith(b, [0xcf, 0xfa, 0xed, 0xfe]) || startsWith(b, [0xfe, 0xed, 0xfa, 0xcf]) || ascii(b, 0, 2) === '#!') {
    return 'eseguibile';
  }
  if (startsWith(b, [0x50, 0x4b, 0x03, 0x04]) || startsWith(b, [0x52, 0x61, 0x72, 0x21]) || startsWith(b, [0x37, 0x7a, 0xbc, 0xaf])) return 'archivio';
  return 'sconosciuto';
}

const KIND_MIME: Partial<Record<SniffKind, string>> = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', pdf: 'application/pdf' };

const EXT_MIME: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', pdf: 'application/pdf' };

const BLOCKED_EXT = /\.(exe|msi|bat|cmd|com|scr|ps1|vbs|js|mjs|jar|sh|app|dmg|apk|dll|so|html?|svg|zip|rar|7z)$/i;

/** Nome leggibile e sicuro: niente percorsi, accenti o caratteri speciali. */
export function normalizeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'file';
  const cleaned = base
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '');
  const dot = cleaned.lastIndexOf('.');
  const stem = (dot > 0 ? cleaned.slice(0, dot) : cleaned).slice(0, 80).replace(/[-.]+$/, '') || 'file';
  const ext = dot > 0 ? cleaned.slice(dot + 1, dot + 6) : '';
  return ext ? `${stem}.${ext}` : stem;
}

export interface FileCheck {
  ok: boolean;
  mime: string | null;
  ext: string | null;
  kind: SniffKind;
  errors: string[];
  normalizedName: string;
}

export function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toLocaleString('it-IT', { maximumFractionDigits: 1 })} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} kB`;
  return `${n} byte`;
}

/** Controllo completo prima del caricamento. Il tipo dichiarato dal browser non basta. */
export function checkFile(input: { name: string; size: number; declaredMime: string; head: Uint8Array; maxBytes?: number }): FileCheck {
  const maxBytes = input.maxBytes ?? DEFAULT_MAX_BYTES;
  const kind = sniffKind(input.head);
  const errors: string[] = [];
  const normalizedName = normalizeFileName(input.name);
  const extMatch = /\.([a-z0-9]+)$/i.exec(input.name);
  const ext = extMatch?.[1]?.toLowerCase() ?? '';

  if (input.size === 0) errors.push('Il file è vuoto.');
  if (input.size > maxBytes) errors.push(`Il file è troppo grande (${formatBytes(input.size)}): il limite è ${formatBytes(maxBytes)}.`);

  if (kind === 'eseguibile' || BLOCKED_EXT.test(input.name)) {
    errors.push('Programmi, script e pagine web non sono ammessi per motivi di sicurezza.');
  } else if (kind === 'heic') {
    errors.push('Le foto HEIC (iPhone) non sono ancora supportate. Sul telefono scegli “Più compatibile” (JPEG) nelle impostazioni della fotocamera, oppure esporta la foto in JPEG.');
  } else if (kind === 'archivio') {
    errors.push('Gli archivi compressi (ZIP, RAR, 7z) non sono ammessi: carica i singoli file.');
  } else if (kind === 'sconosciuto') {
    errors.push('Formato non supportato. Puoi caricare foto JPEG, PNG o WebP e documenti PDF.');
  }

  const realMime = KIND_MIME[kind] ?? null;
  if (realMime) {
    const extMime = EXT_MIME[ext];
    if (!extMime) errors.push(`L’estensione “.${ext || '?'}” non corrisponde a un formato ammesso.`);
    else if (extMime !== realMime) errors.push(`Il contenuto è ${ALLOWED_MEDIA[realMime]!.label}, ma il nome dice “.${ext}”: rinomina il file correttamente.`);
    if (input.declaredMime && input.declaredMime !== realMime && input.declaredMime !== 'application/octet-stream') {
      errors.push('Il tipo dichiarato dal dispositivo non corrisponde al contenuto reale del file.');
    }
  }

  return {
    ok: errors.length === 0 && realMime !== null,
    mime: realMime,
    ext: realMime ? ALLOWED_MEDIA[realMime]!.ext : null,
    kind,
    errors,
    normalizedName,
  };
}

// ------------------------------------------------------------------ metadati

export interface StripResult {
  bytes: Uint8Array;
  /** cosa è stato trovato e rimosso */
  removed: string[];
  /** true se il formato è stato ripulito; false per i PDF (metadati non toccati) */
  stripped: boolean;
}

/** JPEG: elimina APP1 (EXIF/XMP, incluso GPS), APP13 (IPTC) e commenti, senza ricodificare. */
export function stripJpegMetadata(bytes: Uint8Array): Uint8Array {
  return stripJpeg(bytes).bytes;
}

function stripJpeg(bytes: Uint8Array): { bytes: Uint8Array; removed: string[] } {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error('Non è un JPEG valido.');
  const out: number[] = [0xff, 0xd8];
  const removed = new Set<string>();
  let i = 2;
  while (i + 4 <= bytes.length) {
    if (bytes[i] !== 0xff) throw new Error('Struttura JPEG non valida.');
    const marker = bytes[i + 1]!;
    if (marker === 0xda) {
      for (let k = i; k < bytes.length; k++) out.push(bytes[k]!);
      return { bytes: Uint8Array.from(out), removed: [...removed] };
    }
    const len = (bytes[i + 2]! << 8) | bytes[i + 3]!;
    if (len < 2 || i + 2 + len > bytes.length) throw new Error('Segmento JPEG troncato.');
    if (marker === 0xe1) {
      const sig = ascii(bytes, i + 4, 4);
      removed.add(sig === 'Exif' ? 'EXIF (incluse eventuali coordinate GPS, data di scatto e modello)' : 'XMP');
    } else if (marker === 0xed) removed.add('IPTC');
    else if (marker === 0xfe) removed.add('commento');
    else for (let k = i; k < i + 2 + len; k++) out.push(bytes[k]!);
    i += 2 + len;
  }
  return { bytes: Uint8Array.from(out), removed: [...removed] };
}

/** PNG: elimina i chunk eXIf, tEXt, iTXt, zTXt e tIME. */
export function stripPngMetadata(bytes: Uint8Array): Uint8Array {
  return stripPng(bytes).bytes;
}

function stripPng(bytes: Uint8Array): { bytes: Uint8Array; removed: string[] } {
  if (sniffKind(bytes) !== 'png') throw new Error('Non è un PNG valido.');
  const drop: Record<string, string> = { eXIf: 'EXIF (incluse eventuali coordinate GPS)', tEXt: 'testo', iTXt: 'testo/XMP', zTXt: 'testo', tIME: 'data di modifica' };
  const parts: Uint8Array[] = [bytes.slice(0, 8)];
  const removed = new Set<string>();
  let i = 8;
  while (i + 12 <= bytes.length) {
    const len = ((bytes[i]! << 24) >>> 0) + (bytes[i + 1]! << 16) + (bytes[i + 2]! << 8) + bytes[i + 3]!;
    const type = ascii(bytes, i + 4, 4);
    const end = i + 12 + len;
    if (end > bytes.length) throw new Error('Chunk PNG troncato.');
    if (drop[type]) removed.add(drop[type]);
    else parts.push(bytes.slice(i, end));
    i = end;
  }
  return { bytes: concat(parts), removed: [...removed] };
}

/** WebP: elimina i chunk EXIF e XMP e azzera i relativi flag del chunk VP8X. */
export function stripWebpMetadata(bytes: Uint8Array): Uint8Array {
  return stripWebp(bytes).bytes;
}

function stripWebp(bytes: Uint8Array): { bytes: Uint8Array; removed: string[] } {
  if (sniffKind(bytes) !== 'webp') throw new Error('Non è un WebP valido.');
  const parts: Uint8Array[] = [];
  const removed = new Set<string>();
  let i = 12;
  while (i + 8 <= bytes.length) {
    const fourcc = ascii(bytes, i, 4);
    const size = bytes[i + 4]! | (bytes[i + 5]! << 8) | (bytes[i + 6]! << 16) | ((bytes[i + 7]! << 24) >>> 0);
    const end = i + 8 + size + (size % 2);
    if (i + 8 + size > bytes.length) throw new Error('Chunk WebP troncato.');
    if (fourcc === 'EXIF') removed.add('EXIF (incluse eventuali coordinate GPS)');
    else if (fourcc === 'XMP ') removed.add('XMP');
    else {
      const chunk = bytes.slice(i, Math.min(end, bytes.length));
      if (fourcc === 'VP8X') chunk[8] = chunk[8]! & ~0x0c; // flag EXIF (0x08) e XMP (0x04)
      parts.push(chunk);
    }
    i = end;
  }
  const body = concat(parts);
  const out = new Uint8Array(12 + body.length);
  out.set(bytes.slice(0, 12));
  out.set(body, 12);
  new DataView(out.buffer).setUint32(4, out.length - 8, true);
  return { bytes: out, removed: [...removed] };
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export function stripMetadata(bytes: Uint8Array, mime: string): StripResult {
  if (mime === 'image/jpeg') {
    const r = stripJpeg(bytes);
    return { bytes: r.bytes, removed: r.removed, stripped: true };
  }
  if (mime === 'image/png') {
    const r = stripPng(bytes);
    return { bytes: r.bytes, removed: r.removed, stripped: true };
  }
  if (mime === 'image/webp') {
    const r = stripWebp(bytes);
    return { bytes: r.bytes, removed: r.removed, stripped: true };
  }
  return { bytes, removed: [], stripped: false };
}

// ------------------------------------------------------------------ PDF

/**
 * Controllo EURISTICO dei PDF sul testo non compresso: rifiuta JavaScript,
 * azioni di avvio, allegati incorporati, contenuti multimediali attivi e file
 * cifrati (non ispezionabili). Non è una sanitizzazione: i metadati (autore,
 * software, XMP) NON vengono rimossi e oggetti dentro flussi compressi possono
 * sfuggire al controllo (backlog B-127).
 */
export function inspectPdf(bytes: Uint8Array): string[] {
  const text = new TextDecoder('latin1').decode(bytes);
  const found: string[] = [];
  if (/\/JavaScript\b|\/JS\s*[(<[]|\/JS\s+\d+\s+\d+\s+R/.test(text)) found.push('JavaScript incorporato');
  if (/\/Launch\b/.test(text)) found.push('azioni che avviano programmi');
  if (/\/EmbeddedFiles?\b|\/FileAttachment\b/.test(text)) found.push('file allegati incorporati');
  if (/\/RichMedia\b/.test(text)) found.push('contenuti multimediali attivi');
  if (/\/Encrypt\b/.test(text)) found.push('cifratura (il contenuto non può essere verificato)');
  return found;
}

/** Controlli sul contenuto completo (oltre ai primi byte). */
export function inspectContent(bytes: Uint8Array, mime: string): string[] {
  if (mime === 'application/pdf') {
    const f = inspectPdf(bytes);
    return f.length ? [`PDF non ammesso: contiene ${f.join(', ')}. Esporta di nuovo il documento come PDF semplice.`] : [];
  }
  return [];
}
