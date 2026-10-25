import { expect, type Page } from '@playwright/test';

export const LOCAL = 'http://localhost:4173';
export const REMOTE = 'http://localhost:4174';

/** Risponde a una domanda dell'onboarding scegliendo un'opzione (o nessuna) e prosegue. */
export async function answer(page: Page, option: RegExp | null, role: 'radio' | 'checkbox' = 'radio') {
  if (option) await page.getByRole(role, { name: option }).check();
  await page.getByRole('button', { name: /^Continua$/ }).click();
}

export async function expectQuestion(page: Page, text: string) {
  await expect(page.getByRole('heading', { level: 1, name: text })).toBeVisible();
}

/**
 * Nessuno scroll orizzontale della pagina. Il confronto è anche con la larghezza del viewport
 * impostata dal test: sui dispositivi mobili emulati `innerWidth` e `clientWidth` si allargano
 * insieme a un contenuto troppo largo e da soli non rivelano lo sforamento.
 */
export async function expectNoHorizontalScroll(page: Page) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
  const viewport = page.viewportSize();
  if (viewport) expect(scrollWidth).toBeLessThanOrEqual(viewport.width);
}

/** Ogni etichetta di fonte visibile sta dentro il proprio contenitore e dentro il viewport. */
export async function expectSourceBadgesInside(page: Page) {
  const width = page.viewportSize()?.width ?? Number.MAX_SAFE_INTEGER;
  const outside = await page.locator('[data-source]:visible').evaluateAll(
    (els, w) =>
      els
        .map((e) => {
          const r = e.getBoundingClientRect();
          const p = e.parentElement!.getBoundingClientRect();
          return { text: e.textContent ?? '', left: r.left, right: r.right, pLeft: p.left, pRight: p.right };
        })
        .filter((b) => b.left < -1 || b.right > w + 1 || b.left < b.pLeft - 1 || b.right > b.pRight + 1),
    width,
  );
  expect(outside).toEqual([]);
}

export const EDIT_BUTTONS = /^(Calcola|Aggiungi|Registra|Crea|Elimina|Salva|Disegna|Importa|Conferm|Aggiorna|Invia|Usa valori|Posiziona|Carica|Rimuovi|Copia qui)/;

export async function editButtonTexts(page: Page): Promise<string[]> {
  const texts = await page.locator('main button:visible').allInnerTexts();
  return texts.map((t) => t.trim()).filter((t) => EDIT_BUTTONS.test(t));
}

/** Accesso come editor di "Comune B" (backend simulato) e apertura del Decision Lab urbano del progetto demo. */
export async function openUrbanLabAsEditor(page: Page, s: { docs: Record<string, unknown> }): Promise<string> {
  const { USER } = await import('./fakeSupabase');
  await page.goto(REMOTE + '/accesso');
  await page.getByLabel('Email').fill(USER.email);
  await page.getByLabel('Password').fill(USER.password);
  await page.getByRole('button', { name: 'Accedi' }).click();
  await expect(page.getByText(`Accesso effettuato come ${USER.email}`)).toBeVisible();
  await page.getByRole('radio', { name: /Comune B.*modifica/ }).check();
  const pid = Object.keys(s.docs)[0]!;
  await page.goto(`${REMOTE}/progetti/${pid}/urbano`);
  await expect(page.getByRole('heading', { name: 'Decision Lab urbano' })).toBeVisible();
  return pid;
}
