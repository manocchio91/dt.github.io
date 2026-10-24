import { describe, expect, it } from 'vitest';
import { canonicalJson, deepFreeze, hashOf, sha256Hex } from './hash';

describe('hash', () => {
  it('SHA-256 conforme ai vettori di test', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256Hex('a'.repeat(1000))).toBe('41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3');
  });

  it('JSON canonico indipendente dall’ordine delle chiavi', () => {
    expect(canonicalJson({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe(canonicalJson({ a: [2, { c: 2, d: 1 }], b: 1 }));
    expect(hashOf({ x: 1, y: 2 })).toBe(hashOf({ y: 2, x: 1 }));
  });

  it('deepFreeze impedisce modifiche annidate', () => {
    const o = deepFreeze({ a: { b: [1] } });
    expect(() => {
      (o.a.b as number[]).push(2);
    }).toThrow();
  });
});
