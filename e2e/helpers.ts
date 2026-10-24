import { expect, type Page } from '@playwright/test';

export const LOCAL = 'http://localhost:4173';
export const REMOTE = 'http://localhost:4174';

/** Risponde a una domanda dell'onboarding scegliendo un'opzione (o nessuna) e prosegue. */
export async function answer(page: Page, option: RegExp | null, role: 'radio' | 'checkbox' = 'radio') {
  if (option) await page.getByRole(role, { name: option }).check();
  await page.getByRole('button', { name: /Avanti|Inizia|Salva e apri/ }).click();
}

export async function expectQuestion(page: Page, text: string) {
  await expect(page.getByRole('heading', { level: 1, name: text })).toBeVisible();
}

/** Nessuno scroll orizzontale della pagina. */
export async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

export const EDIT_BUTTONS = /^(Calcola|Aggiungi|Registra|Crea|Elimina|Salva|Disegna|Importa|Conferm|Aggiorna|Invia|Usa valori|Posiziona|Carica|Rimuovi|Copia qui)/;

export async function editButtonTexts(page: Page): Promise<string[]> {
  const texts = await page.locator('main button:visible').allInnerTexts();
  return texts.map((t) => t.trim()).filter((t) => EDIT_BUTTONS.test(t));
}
