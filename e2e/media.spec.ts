import { expect, test, type Page } from '@playwright/test';
import { LOCAL, REMOTE } from './helpers';
import { FAKE_JPG_PDF, HEIC, jpegWithGps } from './mediaFiles';
import { initialState, installFakeSupabase, ORG_B, USER, type FakeState } from './fakeSupabase';

const LOCAL_BADGE = 'File locale — non sincronizzato con il server.';

/** Richiesta dalla pagina (passa dal backend simulato, come farebbe il browser). */
const statusOf = (page: Page, url: string) => page.evaluate(async (u) => (await fetch(u, { cache: 'no-store' })).status, url);

test.beforeEach(async ({ page }) => {
  await page.route(/open-meteo\.com|tile\.openstreetmap\.org/, (r) => r.abort());
});

async function openDemoMedia(page: Page, base: string, kind: 'urbana' | 'agricola') {
  await page.goto(base + '/');
  await page.getByRole('button', { name: `Apri la demo ${kind}` }).click();
  await expect(page).toHaveURL(kind === 'urbana' ? /\/urbano$/ : /\/agricolo$/);
  await page.getByRole('link', { name: 'Foto e documenti' }).click();
  await expect(page.getByRole('heading', { name: 'Foto e documenti' })).toBeVisible();
}

test.describe('Ospite: file solo nel browser', () => {
  test('agricolo: carica → controlla → anteprima → collega → salva → consulta → scarica → elimina', async ({ page }) => {
    await openDemoMedia(page, LOCAL, 'agricola');
    await page.getByTestId('file-input').setInputFiles({ name: 'Foto Vite.JPG', mimeType: 'image/jpeg', buffer: jpegWithGps() });
    await expect(page.getByText('File accettato')).toBeVisible();
    await expect(page.getByText(/EXIF \(incluse eventuali coordinate GPS/)).toBeVisible();
    const preview = page.getByRole('img', { name: /Anteprima di foto-vite\.jpg/ });
    await expect(preview).toBeVisible();
    expect(await preview.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
    await expect(page.getByText('La fotografia documenta l’osservazione ed è associata ai dati disponibili. Non costituisce una diagnosi agronomica.').first()).toBeVisible();

    await page.getByLabel('Sottozona', { exact: true }).selectOption({ label: 'Zona A' });
    await page.getByLabel('Osservazione sul campo').selectOption({ index: 1 });
    await page.getByLabel(/^Descrizione/).fill('Foglie basali ingiallite');
    await page.getByLabel('Autore').fill('Viticoltore');
    await page.getByRole('button', { name: 'Salva nel browser' }).click();
    await expect(page.getByText(LOCAL_BADGE)).toBeVisible();
    await expect(page.getByText(/Sottozona: Zona A/)).toBeVisible();

    // persistenza dopo il ricaricamento
    await page.reload();
    await expect(page.getByText('Foglie basali ingiallite')).toBeVisible();

    await page.getByRole('button', { name: 'Mostra anteprima' }).click();
    const img = page.getByRole('img', { name: /Immagine del terreno o della coltura: Foglie basali/ });
    await expect(img).toBeVisible();

    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Scarica' }).click()]);
    expect(download.suggestedFilename()).toBe('foto-vite.jpg');
    const chunks: Buffer[] = [];
    for await (const c of (await download.createReadStream())!) chunks.push(c as Buffer);
    const bytes = Buffer.concat(chunks);
    expect([...bytes.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
    expect(bytes.includes(Buffer.from('Exif'))).toBe(false);
    expect(bytes.includes(Buffer.from('Modello-XYZ'))).toBe(false);

    await page.getByRole('button', { name: 'Elimina', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Eliminare il file?' })).toBeVisible();
    await page.getByRole('button', { name: 'Elimina definitivamente' }).click();
    await expect(page.getByText(LOCAL_BADGE)).toHaveCount(0);
    await page.reload();
    await expect(page.getByText('Foglie basali ingiallite')).toHaveCount(0);
  });

  test('formati non ammessi, estensione contraffatta e file troppo grande: rifiutati con messaggi chiari', async ({ page }) => {
    await openDemoMedia(page, LOCAL, 'urbana');
    const input = page.getByTestId('file-input');
    await input.setInputFiles({ name: 'foto.jpg', mimeType: 'image/jpeg', buffer: FAKE_JPG_PDF });
    await expect(page.getByText(/Il contenuto è Documento PDF, ma il nome dice “\.jpg”/)).toBeVisible();
    await input.setInputFiles({ name: 'IMG_0001.HEIC', mimeType: 'image/heic', buffer: HEIC });
    await expect(page.getByText(/Sul telefono scegli “Più compatibile”/)).toBeVisible();
    await input.setInputFiles({ name: 'setup.exe', mimeType: 'application/octet-stream', buffer: Buffer.from([0x4d, 0x5a, 0x90, 0]) });
    await expect(page.getByText(/Programmi, script e pagine web non sono ammessi/)).toBeVisible();
    const big = Buffer.alloc(21 * 1024 * 1024);
    jpegWithGps().copy(big);
    await input.setInputFiles({ name: 'grande.jpg', mimeType: 'image/jpeg', buffer: big });
    await expect(page.getByText(/troppo grande \(21 MB\)/)).toBeVisible();
    await expect(page.getByRole('button', { name: /Salva/ })).toHaveCount(0);
  });

  test('solo tastiera: scelta file, collegamenti, salvataggio ed eliminazione con conferma', async ({ page }) => {
    await openDemoMedia(page, LOCAL, 'urbana');
    const tabTo = async (name: RegExp) => {
      for (let i = 0; i < 60; i++) {
        await page.keyboard.press('Tab');
        const t = await page.evaluate(() => (document.activeElement as HTMLElement | null)?.innerText?.trim() ?? '');
        if (name.test(t)) return;
      }
      throw new Error(`non raggiungibile: ${name}`);
    };
    await page.locator('main h1').focus();
    await tabTo(/^Scegli dal dispositivo$/);
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.keyboard.press('Enter')]);
    await chooser.setFiles({ name: 'piazza.jpg', mimeType: 'image/jpeg', buffer: jpegWithGps() });
    await expect(page.getByText('File accettato')).toBeVisible();
    await page.getByLabel(/^Descrizione/).focus();
    await page.keyboard.type('Pavimentazione al sole');
    await page.getByLabel('Autore').focus();
    await page.keyboard.type('Tecnico');
    await page.getByLabel('Scenario').focus();
    await page.keyboard.press('ArrowDown');
    await tabTo(/^Salva nel browser$/);
    await page.keyboard.press('Enter');
    await expect(page.getByText(LOCAL_BADGE)).toBeVisible();
    await expect(page.getByText(/Scenario: A/)).toBeVisible();
    await tabTo(/^Elimina$/);
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: 'Annulla' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Elimina definitivamente' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByText(LOCAL_BADGE)).toHaveCount(0);
  });

  test('associazione dalla mappa alla cella (se il browser offre WebGL)', async ({ page }) => {
    await openDemoMedia(page, LOCAL, 'urbana');
    await page.getByTestId('file-input').setInputFiles({ name: 'p.jpg', mimeType: 'image/jpeg', buffer: jpegWithGps() });
    await expect(page.getByText('File accettato')).toBeVisible();
    const canvas = page.locator('.maplibregl-canvas');
    test.skip((await canvas.count()) === 0, 'WebGL non disponibile in questo browser: associazione verificata con i selettori');
    await page.getByRole('button', { name: 'Scegli il punto sulla mappa' }).click();
    const box = (await canvas.boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.getByRole('button', { name: 'Conferma punti' }).click();
    await expect(page.getByText(/Associato alla cella r\d+c\d+/)).toBeVisible();
  });
});

test.describe('Organizzazione (backend Supabase simulato)', () => {
  let state: FakeState;

  test.beforeEach(async ({ page }) => {
    state = initialState();
    state.memberships = state.memberships.map((m) => (m.organization_id === ORG_B ? { ...m, role: 'admin' } : m));
    await installFakeSupabase(page, state);
  });

  async function loginTo(page: Page, org: RegExp) {
    await page.goto(REMOTE + '/accesso');
    await page.getByLabel('Email').fill(USER.email);
    await page.getByLabel('Password').fill(USER.password);
    await page.getByRole('button', { name: 'Accedi' }).click();
    await page.getByRole('radio', { name: org }).check();
  }

  async function demoMediaInOrg(page: Page) {
    await page.goto(REMOTE + '/progetti');
    await page.getByRole('button', { name: 'Carica demo urbana' }).click();
    await expect(page).toHaveURL(/\/urbano$/);
    await page.getByRole('link', { name: 'Foto e documenti' }).click();
    await expect(page.getByText(/Archivio privato di Comune B/)).toBeVisible();
  }

  test('upload sul server privato, URL firmato che scade, eliminazione che invalida i link', async ({ page }) => {
    await loginTo(page, /Comune B/);
    await demoMediaInOrg(page);
    await page.getByTestId('file-input').setInputFiles({ name: 'piazza.jpg', mimeType: 'image/jpeg', buffer: jpegWithGps() });
    await page.getByRole('button', { name: 'Salva e carica' }).click();
    await expect(page.getByText('Sul server (privato)')).toBeVisible();
    expect(state.mediaCalls.filter((c) => /^(POST|UPLOAD|PATCH|GATEWAY complete)/.test(c)).map((c) => c.split(' ')[0])).toEqual(['POST', 'UPLOAD', 'GATEWAY']);
    const stored = [...state.objects.values()][0]!.bytes;
    expect(stored.includes(Buffer.from('Exif'))).toBe(false);

    await page.getByRole('button', { name: 'Mostra anteprima' }).click();
    const img = page.locator('main li img');
    await expect(img).toBeVisible();
    const signed = (await img.getAttribute('src'))!;
    expect(state.mediaCalls).toContain('AUDIT consultazione'); // la firma passa dal gateway, che registra prima l'accesso
    expect((await statusOf(page, signed))).toBe(200);

    state.clockOffsetMs = 61_000; // il link dura 60 secondi
    expect((await statusOf(page, signed))).toBe(400);
    await page.getByRole('button', { name: 'Aggiorna anteprima' }).click();
    await expect(img).not.toHaveAttribute('src', signed);
    const fresh = (await img.getAttribute('src'))!;
    expect((await statusOf(page, fresh))).toBe(200);

    await page.getByRole('button', { name: 'Elimina', exact: true }).click();
    await page.getByRole('button', { name: 'Elimina definitivamente' }).click();
    await expect(page.getByText(/File eliminato dallo storage/)).toBeVisible();
    expect(state.objects.size).toBe(0);
    expect(Object.keys(state.media)).toHaveLength(0);
    expect((await statusOf(page, fresh))).toBe(404);
  });

  test('ruolo lettura: consulta senza comandi; caricamento diretto via API rifiutato', async ({ page }) => {
    await loginTo(page, /Comune B/);
    await demoMediaInOrg(page);
    await page.getByTestId('file-input').setInputFiles({ name: 'doc.jpg', mimeType: 'image/jpeg', buffer: jpegWithGps() });
    await page.getByRole('button', { name: 'Salva e carica' }).click();
    await expect(page.getByText('Sul server (privato)')).toBeVisible();

    // l'amministratore riduce il ruolo: alla riapertura l'app rilegge i permessi
    state.memberships = state.memberships.map((m) => (m.organization_id === ORG_B ? { ...m, role: 'viewer' } : m));
    await page.goto(REMOTE + '/accesso');
    await page.getByRole('radio', { name: /Comune B.*lettura/ }).check();
    await page.goto(REMOTE + '/progetti');
    await page.getByRole('link', { name: /Campobasso/ }).click();
    await page.getByRole('link', { name: 'Foto e documenti' }).click();
    await expect(page.getByText('Sul server (privato)')).toBeVisible();
    await expect(page.getByText('Trascina qui una foto o un documento')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Elimina|Modifica collegamenti/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Scarica' })).toBeVisible();

    const r = await page.evaluate(async (args) => {
      const res = await fetch('http://supabase.e2e.test/rest/v1/media_assets', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer token-${args.user}`, apikey: 'x' },
        body: JSON.stringify({ id: 'x', organization_id: args.org, uploaded_by: args.user }),
      });
      return res.status;
    }, { user: USER.id, org: ORG_B });
    expect(r).toBe(403);
  });

  test('senza rete: salvataggio locale “non sincronizzato”, poi sincronizzazione confermata', async ({ page, context }) => {
    await loginTo(page, /Comune B/);
    await demoMediaInOrg(page);
    await context.setOffline(true);
    await expect(page.getByText('Connessione assente')).toBeVisible();
    await page.getByTestId('file-input').setInputFiles({ name: 'offline.jpg', mimeType: 'image/jpeg', buffer: jpegWithGps() });
    await page.getByRole('button', { name: 'Salva nel browser' }).click();
    await expect(page.getByText(LOCAL_BADGE)).toBeVisible();
    expect(state.objects.size).toBe(0);

    await context.setOffline(false);
    await expect(page.getByText('1 file in attesa di sincronizzazione')).toBeVisible();
    expect(state.objects.size).toBe(0); // nessun invio senza conferma
    await page.getByRole('button', { name: 'Sincronizza ora' }).click();
    await expect(page.getByText('Sul server (privato)')).toBeVisible();
    expect(state.objects.size).toBe(1);
    await expect(page.getByText(LOCAL_BADGE)).toHaveCount(0);
  });

  test('cambio organizzazione: i file di un’organizzazione non compaiono nell’altra', async ({ page }) => {
    await loginTo(page, /Comune B/);
    await demoMediaInOrg(page);
    await page.getByTestId('file-input').setInputFiles({ name: 'b.jpg', mimeType: 'image/jpeg', buffer: jpegWithGps() });
    await page.getByLabel(/^Descrizione/).fill('Solo del Comune B');
    await page.getByRole('button', { name: 'Salva e carica' }).click();
    await expect(page.getByText('Solo del Comune B')).toBeVisible();

    await page.goto(REMOTE + '/accesso');
    await page.getByRole('radio', { name: /Comune A/ }).check();
    await page.goto(REMOTE + '/progetti');
    await page.getByRole('link', { name: /Campobasso/ }).click();
    await page.getByRole('link', { name: 'Foto e documenti' }).click();
    await expect(page.getByText(/Archivio privato di Comune A/)).toBeVisible();
    await expect(page.getByText('Solo del Comune B')).toHaveCount(0);
    await expect(page.getByText(/File del progetto \(0\)/)).toBeVisible();
  });
});
