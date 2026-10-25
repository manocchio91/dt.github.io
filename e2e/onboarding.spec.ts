import { expect, test } from '@playwright/test';
import { answer, expectQuestion, LOCAL } from './helpers';

/**
 * Percorsi da ospite (Demo senza registrazione, archivio locale).
 * I tempi misurati qui sono di un browser automatico: indicano la lunghezza
 * del flusso, non sostituiscono i test con utenti reali (Sprint 2–3).
 */

test.beforeEach(async ({ page }) => {
  // nessuna rete esterna nei test: Open-Meteo e tile non servono ai percorsi
  await page.route(/open-meteo\.com|tile\.openstreetmap\.org/, (r) => r.abort());
});

test('urbano guidato: onboarding < 2 min e primo scenario calcolato < 5 min', async ({ page }) => {
  const t0 = Date.now();
  await page.goto(LOCAL + '/');
  await page.getByRole('link', { name: /Inizia: 6 domande/ }).click();
  await expectQuestion(page, 'Chi sei?');
  await expect(page.getByText('Non cambia i tuoi permessi')).toBeVisible();
  await answer(page, /Tecnico comunale/);
  await expect(page.getByRole('radio', { name: /Città/ })).toBeChecked();
  await answer(page, null);
  await answer(page, /Controllare una piazza/);
  await answer(page, /Area dimostrativa/);
  await answer(page, /Confini dell’area/, 'checkbox');
  await answer(page, /Guidata/);
  await expect(page).toHaveURL(/\/progetti\/[^/]+\/urbano$/);
  const onboardingMs = Date.now() - t0;

  await expect(page.getByRole('complementary', { name: 'Guida' })).toBeVisible();
  await page.getByRole('button', { name: 'Calcola A' }).click();
  await expect(page.getByText('Riduzione termica stimata — aria a 2 m').first()).toBeVisible();
  const firstScenarioMs = Date.now() - t0;

  test.info().annotations.push({ type: 'tempo', description: `onboarding ${onboardingMs} ms, primo scenario ${firstScenarioMs} ms` });
  expect(onboardingMs).toBeLessThan(120_000);
  expect(firstScenarioMs).toBeLessThan(300_000);
  // nessun indicatore agricolo nel flusso urbano
  await expect(page.getByText(/stress idrico|fenologia|vigneto/i)).toHaveCount(0);
});

test('primo scenario da zero, solo con indicazioni a schermo (nuovo progetto)', async ({ page }) => {
  const t0 = Date.now();
  await page.goto(LOCAL + '/benvenuto');
  await answer(page, /Gestore del verde/);
  await answer(page, null);
  await answer(page, /Confrontare possibili interventi/);
  await page.getByRole('radio', { name: /Una mia nuova area/ }).check();
  await page.getByLabel('Nome del progetto').fill('Piazza del mercato');
  await answer(page, null);
  await answer(page, null);
  await answer(page, /Guidata/);
  await expect(page).toHaveURL(/\/area$/);

  await page.getByLabel(/Oppure inserisci le coordinate/).fill('41.56033, 14.66276\n41.56033, 14.66384\n41.56087, 14.66384\n41.56087, 14.66276');
  await page.getByRole('button', { name: 'Usa queste coordinate' }).click();
  await expect(page.getByText('Geometria valida.')).toBeVisible();
  await page.getByRole('button', { name: 'Salva area' }).click();
  await page.getByRole('link', { name: /Vai al Decision Lab/ }).click();

  const guide = page.getByRole('complementary', { name: 'Guida' });
  await expect(guide).toContainText('crea la baseline');
  await page.getByRole('button', { name: 'Usa valori dimostrativi (SIMULATI)' }).click();
  await expect(guide).toContainText('aggiungi uno scenario');
  await page.getByRole('button', { name: /Aggiungi scenario A/ }).click();
  await expect(guide).toContainText('posiziona un intervento');
  await page.getByText('Oppure inserisci le coordinate da tastiera').click();
  await page.getByLabel(/Un punto per riga/).fill('41.56045, 14.66300\n41.56045, 14.66330\n41.56075, 14.66300');
  await page.getByRole('button', { name: 'Aggiungi con queste coordinate' }).click();
  await expect(guide).toContainText('calcola lo scenario');
  await page.getByRole('button', { name: 'Calcola A' }).click();
  await expect(page.getByText('Riduzione stimata — temperatura superficiale').first()).toBeVisible();
  await expect(page.getByText('SIMULATO').first()).toBeVisible();
  const ms = Date.now() - t0;
  test.info().annotations.push({ type: 'tempo', description: `da onboarding a primo scenario: ${ms} ms` });
  expect(ms).toBeLessThan(300_000);
});

test('agricolo solo da tastiera fino alla zona da controllare', async ({ page }) => {
  await page.goto(LOCAL + '/benvenuto');
  await expectQuestion(page, 'Chi sei?');
  const tabTo = async (name: RegExp) => {
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press('Tab');
      const label = await page.evaluate(() => (document.activeElement as HTMLElement | null)?.closest('label, button')?.textContent ?? '');
      if (name.test(label)) return;
    }
    throw new Error(`non raggiungibile da tastiera: ${name}`);
  };
  const choose = async (name: RegExp) => {
    await tabTo(name);
    await page.keyboard.press('Space');
  };
  const proceed = async () => {
    await tabTo(/^Continua$/);
    await page.keyboard.press('Enter');
  };
  await choose(/Tecnico comunale/);
  // con le frecce si sceglie un'altra voce del gruppo
  for (let i = 0; i < 2; i++) await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('radio', { name: /Agricoltore/ })).toBeChecked();
  await proceed();
  await expect(page.getByRole('radio', { name: /Campagna/ })).toBeChecked();
  await proceed();
  await choose(/quale zona controllare/);
  await proceed();
  await choose(/Vigneto dimostrativo/);
  await proceed();
  await choose(/Osservazioni in campo/);
  await proceed();
  await choose(/Guidata/);
  await proceed();
  await expect(page).toHaveURL(/\/agricolo$/);
  await expect(page.locator('#first-zone')).toContainText('Zona A');
  await expect(page.getByText('Prima zona da controllare')).toBeVisible();
  await expect(page.getByText(/temperatura superficiale|albedo|depaving/i)).toHaveCount(0);
});

test('Demo senza registrazione: si salta l’onboarding dalla landing e dal questionario', async ({ page }) => {
  await page.goto(LOCAL + '/');
  await page.getByRole('button', { name: 'Apri la demo urbana' }).click();
  await expect(page).toHaveURL(/\/urbano$/);
  await page.goto(LOCAL + '/benvenuto');
  await page.getByRole('button', { name: 'Salta e apri la demo agricola' }).click();
  await expect(page).toHaveURL(/\/agricolo$/);
  await expect(page.getByText('Prima zona da controllare')).toBeVisible();
});

test('preferenze salvate nel browser, riaperte e modificate', async ({ page }) => {
  await page.goto(LOCAL + '/benvenuto');
  await answer(page, /Agronomo/);
  await answer(page, null);
  await answer(page, /Controllare lo stress/);
  await answer(page, /Vigneto dimostrativo/);
  await answer(page, /Sonda di umidità/, 'checkbox');
  await answer(page, /Guidata/);
  await expect(page).toHaveURL(/\/agricolo$/);

  await page.reload();
  await page.goto(LOCAL + '/');
  await expect(page.getByRole('link', { name: 'Le mie preferenze' }).first()).toBeVisible();
  await expect(page.getByText(/Agronomo o consulente · Controllare lo stress da caldo o da siccità/)).toBeVisible();

  await page.getByRole('link', { name: 'Le mie preferenze' }).first().click();
  await expect(page.getByText(/Modifica preferenze/)).toBeVisible();
  await expect(page.getByRole('radio', { name: /Agronomo/ })).toBeChecked();
  for (let i = 0; i < 5; i++) await page.getByRole('button', { name: /^Continua$/ }).click();
  await answer(page, /Tecnica/);
  await expect(page).toHaveURL(/\/agricolo$/);
  await expect(page.getByRole('complementary', { name: 'Guida' })).toHaveCount(0);
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('mdt:onboarding:v1') ?? '{}'));
  expect(stored).toMatchObject({ profile: 'agronomo', mode: 'tecnica', sector: 'agriculture' });
  expect(stored).not.toHaveProperty('role');
});
