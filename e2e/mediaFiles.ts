// @ts-expect-error libreria senza tipi, usata solo nei test per scrivere EXIF reali
import piexif from 'piexifjs';

/** JPEG 1×1 reale. */
export const TINY_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=',
  'base64',
);

/** Lo stesso JPEG con EXIF reale: modello della fotocamera e coordinate GPS. */
export function jpegWithGps(): Buffer {
  const exif = piexif.dump({
    '0th': { [piexif.ImageIFD.Model]: 'Modello-XYZ' },
    GPS: {
      [piexif.GPSIFD.GPSLatitudeRef]: 'N',
      [piexif.GPSIFD.GPSLatitude]: [
        [41, 1],
        [33, 1],
        [3801, 100],
      ],
    },
  });
  return Buffer.from(piexif.insert(exif, TINY_JPEG.toString('binary')), 'binary');
}

export const FAKE_JPG_PDF = Buffer.from('%PDF-1.7\n% documento rinominato in .jpg\n');
export const HEIC = Buffer.from([0, 0, 0, 24, ...Buffer.from('ftypheic'), 0, 0, 0, 0]);
