import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

// jsdom non ha WebGL: la mappa mostra il proprio stato di errore accessibile
vi.mock('maplibre-gl', () => {
  class Unavailable {
    constructor() {
      throw new Error('WebGL non disponibile nei test');
    }
  }
  class Control {}
  return { default: { Map: Unavailable, NavigationControl: Control, ScaleControl: Control } };
});

if (!HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
}

afterEach(() => cleanup());

// jsdom non implementa gli URL di oggetti: un doppio sufficiente per anteprime e download
if (!URL.createObjectURL) {
  let n = 0;
  URL.createObjectURL = () => `blob:test/${++n}`;
  URL.revokeObjectURL = () => {};
}
