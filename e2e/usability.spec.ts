import { expect, test, type Page } from '@playwright/test';
import { answer, expectNoHorizontalScroll, expectQuestion, LOCAL } from './helpers';

/**
 * Usabilità (Audit Anno Luce): guida in 6 domande, modalità guidata e tecnica, fonti distinte,
 * funzionamento senza Supabase e senza Open-Meteo, zoom al 200%. Verifica comportamento e
 * contenuti accessibili, non istantanee.
 */
const external: string[] = [];

test.beforeEach(async ({ page }) => {
  external.length = 0;
  await page.route(/open-meteo\.com|supabase\.co|tile\.openstreetmap\.org/, (r) => {
    external.push(r.request().url());
    return r.abort();
  });
});

const progress = (page: Page) => page.getByTestId('onboarding-progress');

async function primaryButtons(page: Page) {
  return page.locator('main .btn-primary:visible').allInnerTexts();
}

test('tecnico comunale, modalità guidata: 6 domande con avanzamento, una sola azione primaria, risposte conservate', async ({ page }) => {
  await page.goto(LOCAL + '/benvenuto');
  const questions = ['Chi sei?', 'In quale ambito lavori?', 'Quale decisione devi prendere?', 'Su quale area, parcella o progetto lavori?', 'Quali dati possiedi già?', 'Preferisci la modalità guidata o tecnica?'];
  const choices: (RegExp | null)[] = [/Tecnico comunale/, null, /Individuare le zone/, /Area dimostrativa/, null, /Guidata/];
  for (const [i, q] of questions.entries()) {
    await expectQuestion(page, q);
    await expect(progress(page)).toHaveText(`Domanda ${i + 1} di 6`);
    expect(await primaryButtons(page)).toEqual(['Continua']);
    await expectNoHorizontalScroll(page);
    if (i === 3) {
      // indietro e avanti: la risposta precedente resta selezionata
      await page.getByRole('button', { name: 'Indietro' }).click();
      await expect(page.getByRole('radio', { name: /Individuare le zone/ })).toBeChecked();
      await page.getByRole('button', { name: 'Continua' }).click();
      await expectQuestion(page, q);
    }
    await answer(page, choices[i]!);
  }
  await expect(page).toHaveURL(/\/urbano$/);
  // dove sono, cosa osservo, perché conta, prossimo passo
  const guide = page.getByTestId('path-guide');
  await expect(guide).toContainText('Passo 3 di 7 · Osserva gli indicatori');
  await expect(guide).toContainText('Cosa osservi:');
  await expect(guide).toContainText('Perché conta:');
  await expect(guide).toContainText('Prossimo passo');
  await expect(page.locator('main')).not.toContainText(/hash|inputHash|PGRST|SQLSTATE/);
});

test('agricoltore, modalità guidata: opzioni agricole, nessuna prescrizione, percorso fino alle previsioni', async ({ page }) => {
  await page.goto(LOCAL + '/benvenuto');
  await answer(page, /Agricoltore o viticoltore/);
  await expect(page.getByRole('radio', { name: /Campagna/ })).toBeChecked();
  await answer(page, null);
  for (const t of ['Controllare lo stress', 'Osservare una parcella', 'Tenere conto della fase', 'Verificare una soglia indicata dall’agronomo', 'Programmare un sopralluogo', 'Confrontare condizioni e scenari']) {
    await expect(page.getByRole('radio', { name: new RegExp(t) })).toBeVisible();
  }
  await expect(page.locator('form')).not.toContainText(/irrigazione di soccorso|serve acqua|automatic/i);
  await answer(page, /Verificare una soglia indicata dall’agronomo/);
  await answer(page, /Vigneto dimostrativo/);
  await answer(page, null, 'checkbox');
  await answer(page, /Guidata/);
  await expect(page).toHaveURL(/\/agricolo$/);
  await expect(page.getByTestId('path-guide')).toContainText('Passi 3–7 di 7');
  await page.goto(page.url().replace(/\/(urbano|agricolo)$/, '/previsioni'));
  await expect(page.getByTestId('forecast-summary')).toContainText('Fascia di possibile variazione');
  await expect(page.getByTestId('forecast-summary')).not.toContainText(/q0,|quantil|WQL|MASE/);
});

test('cambio di ambito: le risposte incompatibili vengono azzerate, le altre restano', async ({ page }) => {
  await page.goto(LOCAL + '/benvenuto');
  await answer(page, /Revisore/);
  await answer(page, /Città/);
  await answer(page, /Tenere d’occhio una soglia/);
  // dalla domanda 4 si torna all'ambito: le risposte date restano
  await page.getByRole('button', { name: 'Indietro' }).click();
  await expect(page.getByRole('radio', { name: /Tenere d’occhio una soglia/ })).toBeChecked();
  await page.getByRole('button', { name: 'Indietro' }).click();
  await expect(page.getByRole('radio', { name: /Città/ })).toBeChecked();
  await page.getByRole('button', { name: 'Indietro' }).click();
  await expect(page.getByRole('radio', { name: /Revisore/ })).toBeChecked();
  await page.getByRole('button', { name: 'Continua' }).click();
  // cambiando ambito, la decisione urbana non vale più per la campagna e viene azzerata
  await answer(page, /Campagna/);
  await expectQuestion(page, 'Quale decisione devi prendere?');
  await expect(page.getByRole('radio', { checked: true })).toHaveCount(0);
});

test('guida completamente da tastiera, uscita e ripresa senza perdere le risposte', async ({ page }) => {
  await page.goto(LOCAL + '/benvenuto');
  await expect(page.getByRole('heading', { level: 1, name: 'Chi sei?' })).toBeFocused();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Space'); // primo profilo
  await page.getByRole('button', { name: 'Continua' }).focus();
  await page.keyboard.press('Enter');
  await expect(progress(page)).toHaveText('Domanda 2 di 6');
  await page.getByRole('button', { name: 'Esci e riprendi dopo' }).focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(LOCAL + '/');
  await page.goto(LOCAL + '/benvenuto');
  await expect(progress(page)).toHaveText('Domanda 2 di 6');
  await expect(page.getByRole('status')).toContainText('ripreso la guida');
  await expect(page.getByRole('radio', { name: /Città/ })).toBeChecked();
});

test('demo senza registrazione, senza Supabase e senza Open-Meteo: messaggi semplici, previsione di base, modello avanzato non attivo', async ({ page }) => {
  await page.goto(LOCAL + '/');
  // home: "Inizia" è l'unica azione principale; le demo sono azioni secondarie, senza registrazione
  await expect(page.getByRole('link', { name: /Inizia: 6 domande/ })).toBeVisible();
  expect(await primaryButtons(page)).toEqual([]);
  await expect(page.getByRole('button', { name: 'Apri la demo urbana' })).toHaveClass(/btn-secondary/);
  await page.getByRole('button', { name: 'Apri la demo urbana' }).click();
  await expect(page).toHaveURL(/\/urbano$/);
  const panel = page.getByTestId('weather-panel');
  await expect(panel).toContainText('Dati meteo non ancora collegati.');
  await expect(panel).toContainText('Puoi continuare usando la modalità dimostrativa.');
  await expect(panel).not.toContainText(/Supabase|Edge Function|stack|Error/);
  await page.goto(page.url().replace(/\/(urbano|agricolo)$/, '/previsioni'));
  await expect(page.getByTestId('forecast-badge')).toContainText('previsione di base');
  await expect(page.getByRole('option', { name: 'Timestral-5M' })).toHaveCount(0);
  await expect(page.getByTestId('forecast-badge')).toContainText('previsione di base');
  await expect(page.locator('main')).not.toContainText(/Timestral-5M \[|bdd20cf/);
  await expect(page.getByTestId('forecast-summary')).toBeVisible();
  expect(external.filter((u) => /supabase\.co|open-meteo\.com/.test(u))).toEqual([]);
});

test('Lab urbano: meteo attuale, periodo storico e simulazione sono distinti e i dettagli restano chiusi', async ({ page }) => {
  await page.goto(LOCAL + '/');
  await page.getByRole('button', { name: 'Apri la demo urbana' }).click();
  await expect(page.getByRole('heading', { name: 'SITUAZIONE ATTUALE' })).toBeVisible();
  const history = page.locator('#u3');
  await expect(history.getByRole('heading', { name: 'PERIODO STORICO DI RIFERIMENTO' })).toBeVisible();
  await expect(history).toContainText('Non rappresenta il meteo di oggi.');
  await expect(history).toContainText(/Periodo selezionato.*2025/s);
  await expect(page.getByTestId('baseline-technical')).not.toHaveAttribute('open', '');
  await expect(page.getByRole('heading', { name: 'Cosa vuoi provare?' })).toBeVisible();
  await expect(page.getByText('SCENARI DIMOSTRATIVI — gli effetti degli interventi sono simulati.')).toBeVisible();
  await expect(page.getByText(/Gli effetti di alberi, superfici e nebulizzazione sono stime comparative illustrative/)).toBeVisible();
  await expect(page.locator('#u6 details').filter({ hasText: 'Modifica parametri' }).first()).not.toHaveAttribute('open', '');
  const results = page.getByTestId('scenario-main-results');
  if (await results.count()) expect(await results.locator(':scope > div').count()).toBeLessThanOrEqual(3);
  await expect(page.locator('#u7').getByText(/Alcuni indicatori non sono disponibili/)).toHaveCount(1);
  await expect(page.getByTestId('scenario-technical')).not.toHaveAttribute('open', '');
});

test('dettagli tecnici chiusi all’inizio e apribili su richiesta, senza ripetizioni', async ({ page }) => {
  await page.goto(LOCAL + '/');
  await page.getByRole('button', { name: 'Apri la demo urbana' }).click();
  await page.goto(page.url().replace(/\/(urbano|agricolo)$/, '/previsioni'));
  const tech = page.getByTestId('forecast-technical');
  await expect(tech).not.toHaveAttribute('open', '');
  await expect(page.getByText('WQL')).toBeHidden();
  await expect(page.getByText(/Impronta dell’input/)).toBeHidden();
  await tech.locator('summary').click();
  await expect(tech).toHaveAttribute('open', '');
  await expect(page.getByRole('columnheader', { name: 'WQL' })).toBeVisible();
  await expect(page.getByText('Impronta dell’input')).toBeVisible();
  await expect(page.getByText(/21 quantili/)).toBeVisible();
  // la soglia si legge in una frase; i campi si aprono a richiesta
  await expect(page.getByTestId('threshold-plain')).toBeVisible();
  await expect(page.getByLabel(/Valore soglia/)).toBeHidden();
});

test('modalità tecnica: dettagli già aperti, nessuna guida passo-passo', async ({ page }) => {
  await page.goto(LOCAL + '/benvenuto');
  await answer(page, /Tecnico comunale/);
  await answer(page, null);
  await answer(page, /Confrontare possibili interventi/);
  await answer(page, /Area dimostrativa/);
  await answer(page, null, 'checkbox');
  await answer(page, /Tecnica/);
  await expect(page).toHaveURL(/\/urbano$/);
  await expect(page.getByTestId('path-guide')).toHaveCount(0);
  await expect(page.getByTestId('baseline-technical')).toHaveAttribute('open', '');
  await page.goto(page.url().replace(/\/(urbano|agricolo)$/, '/previsioni'));
  await expect(page.getByTestId('forecast-technical')).toHaveAttribute('open', '');
  await expect(page.getByTestId('forecast-badge')).toContainText('Persistenza stagionale');
  await expect(page.getByRole('combobox', { name: /^Modello/ }).locator('option')).toHaveCount(2);
  await expect(page.getByRole('option', { name: /Timestral/ })).toHaveCount(0);
});

test('quattro fonti distinte: testo, simbolo, stile e descrizione accessibile, non solo colore', async ({ page }) => {
  await page.goto(LOCAL + '/');
  await page.getByRole('button', { name: 'Apri la demo agricola' }).click();
  const badges = page.getByTestId('weather-panel').locator('[data-source]');
  await expect(badges).toHaveCount(4);
  const info = await badges.evaluateAll((els) =>
    els.map((e) => ({ text: e.textContent ?? '', title: e.getAttribute('title') ?? '', symbol: e.querySelector('[aria-hidden=true]')?.textContent ?? '', sr: e.querySelector('.sr-only')?.textContent ?? '', border: getComputedStyle(e).borderStyle })),
  );
  expect(info.map((i) => i.text.split(':')[0]!.replace(/^\W+/, ''))).toEqual(['DATO OPEN-METEO', 'MISURATO DA SENSORE', 'STIMATO DA MODELLO', 'SIMULATO']);
  expect(new Set(info.map((i) => i.symbol)).size).toBe(4);
  expect(new Set(info.map((i) => i.border)).size).toBeGreaterThanOrEqual(3);
  for (const i of info) {
    expect(i.title.length).toBeGreaterThan(20);
    expect(i.sr).toContain(i.title);
  }
});

test('zoom al 200% (finestra di 640 px): nessuno scorrimento orizzontale, azione principale visibile', async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 400 });
  await page.goto(LOCAL + '/benvenuto');
  await expectNoHorizontalScroll(page);
  await page.getByRole('button', { name: 'Continua' }).scrollIntoViewIfNeeded();
  await expect(page.getByRole('button', { name: 'Continua' })).toBeInViewport();
  await page.goto(LOCAL + '/');
  await page.getByRole('button', { name: 'Apri la demo urbana' }).click();
  await expect(page).toHaveURL(/\/urbano$/);
  await expectNoHorizontalScroll(page);
  const pid = page.url().split('/progetti/')[1]!.split('/')[0]!;
  await page.goto(`${LOCAL}/progetti/${pid}/previsioni`);
  await expect(page.getByTestId('forecast-summary')).toBeVisible();
  await expectNoHorizontalScroll(page);
});
