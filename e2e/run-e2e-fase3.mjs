// E2E Fase 3 (v1.5.0): biblioteca, descargas offline + precarga, CBZ,
// modo por páginas con dirección configurable, progreso y logo→inicio.
// Corre contra la app real con el proxy del usuario en la cadena.
import puppeteer from 'puppeteer-core';

const BASE = process.env.TINTA_BASE || 'http://localhost:8789/';
const CBZ = process.env.TINTA_CBZ || '/tmp/tinta-test.cbz';
const EXE = '/home/hatch/workspace/tinta/e2e/chrome-headless-shell/linux-155.0.8059.84/chrome-headless-shell-linux64/chrome-headless-shell';
const log = (...a) => console.log(...a);
const out = { base: BASE, steps: {}, consoleErrors: [] };
const S = out.steps;

import { lookup } from 'node:dns/promises';
const proxyEnv = process.env.https_proxy || process.env.http_proxy || '';
let proxy = '';
if (proxyEnv) {
  const u = new URL(proxyEnv);
  const { address, family } = await lookup(u.hostname);
  const host = family === 6 ? `[${address}]` : address;
  proxy = `${u.protocol}//${host}:${u.port}`;
}
const launchArgs = ['--no-sandbox', '--disable-dev-shm-usage', '--ignore-certificate-errors'];
if (proxy) launchArgs.push(`--proxy-server=${proxy}`, '--proxy-bypass-list=localhost;127.0.0.1');
const browser = await puppeteer.launch({ executablePath: EXE, args: launchArgs, protocolTimeout: 300000 });
const page = await browser.newPage();
await page.setViewport({ width: 420, height: 900 });
await page.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36');
if (process.env.TINTA_PROXYBASE) {
  await page.evaluateOnNewDocument((v) => {
    try { localStorage.setItem('tinta.proxyBase', v); } catch { /* sin acceso */ }
  }, process.env.TINTA_PROXYBASE);
}
page.on('console', (m) => { if (m.type() === 'error') out.consoleErrors.push(m.text().slice(0, 200)); });
page.on('pageerror', (e) => out.consoleErrors.push('pageerror: ' + String(e).slice(0, 200)));

const txt = (sel) => page.$eval(sel, (el) => el.textContent.trim());
const chapterRows = () => page.$$('#chapters .chapter');
async function rowByLabel(prefix) {
  const rows = await chapterRows();
  for (const r of rows) {
    const t = await r.evaluate((el) => el.querySelector('.ch-main span')?.textContent || '');
    if (t.startsWith(prefix)) return r;
  }
  return null;
}
async function waitRowDownloaded(prefix, timeout = 240000) {
  await page.waitForFunction((p) => {
    const rows = [...document.querySelectorAll('#chapters .chapter')];
    const row = rows.find((el) => (el.querySelector('.ch-main span')?.textContent || '').startsWith(p));
    return row && row.querySelector('.dl-btn')?.classList.contains('done');
  }, { timeout }, prefix);
}
async function openChapterRow(prefix) {
  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const row = await rowByLabel(prefix);
    if (!row) throw new Error(`Fila no encontrada: ${prefix}`);
    try {
      await row.click();
      await page.waitForFunction(() => document.querySelectorAll('#pages img').length > 0, { timeout: 120000 });
      return;
    } catch (e) {
      lastErr = e;
      if (!String(e.message).includes('detached')) throw e;
      await new Promise((r) => setTimeout(r, 800));
    }
  }
  throw lastErr;
}

try {
  // --- Arranque y ajustes ---
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('#catalog .source-row', { timeout: 60000 });
  S.transport = await txt('#net-status');
  S.version = await txt('#app-version');
  log('transporte:', S.transport, '| versión:', S.version);

  await page.click('#btn-settings');
  await page.waitForSelector('#set-reader-mode', { visible: true, timeout: 10000 });
  await page.select('#set-reader-mode', 'paged');
  await page.select('#set-page-dir', 'ltr');
  await page.select('#set-preload', '1');
  S.prefs = await page.evaluate(() => ({
    mode: localStorage.getItem('tinta.readerMode'),
    dir: localStorage.getItem('tinta.pageDir'),
    preload: localStorage.getItem('tinta.preloadCount'),
  }));
  await page.click('#btn-settings');
  log('ajustes:', JSON.stringify(S.prefs));

  // --- Instalar las dos fuentes ---
  await page.waitForSelector('button[data-install="multi.mangadex"]', { timeout: 15000 });
  await page.click('button[data-install="multi.mangadex"]');
  await page.waitForSelector('button[data-open="multi.mangadex"]', { timeout: 90000 });
  await page.click('button[data-install="en.weebcentral"]');
  await page.waitForSelector('button[data-open="en.weebcentral"]', { timeout: 90000 });
  log('fuentes instaladas ✓');

  // --- MangaDex: Yotsuba, volúmenes, biblioteca ---
  await page.click('button[data-open="multi.mangadex"]');
  await page.waitForSelector('#search-input', { visible: true, timeout: 15000 });
  await page.type('#search-input', 'Yotsuba');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelectorAll('#results .card').length > 0, { timeout: 90000 });
  const titles = await page.$$eval('#results .card .t', (els) => els.map((e) => e.textContent.trim()));
  const idx = titles.findIndex((t) => t.toLowerCase().startsWith('yotsuba'));
  const cards = await page.$$('#results .card');
  await cards[idx].click();
  await page.waitForFunction(() => document.querySelectorAll('#chapters .chapter').length > 0, { timeout: 120000 });
  S.mangaTitle = await txt('#manga-detail h2');
  S.volHeaders = await page.$$eval('#chapters .vol-header', (els) => els.slice(0, 3).map((e) => e.textContent.trim()));
  S.chapterCount = await page.$$eval('#chapters .chapter', (els) => els.length);
  log('manga:', S.mangaTitle, '| capítulos:', S.chapterCount, '| vol headers:', JSON.stringify(S.volHeaders));

  await page.click('#btn-lib');
  await page.waitForFunction(() => document.querySelector('#btn-lib')?.textContent.includes('En tu biblioteca'), { timeout: 15000 });
  S.libraryAdded = true;
  log('añadido a la biblioteca ✓');

  // --- Modo por páginas LTR + progreso ---
  await openChapterRow('Cap. 114');
  await page.waitForSelector('#pages .paged-stage img.page-img', { timeout: 60000 });
  S.indicatorStart = await txt('#page-indicator');
  await page.$eval('.zone.next', (el) => el.click());
  S.indicatorAfter1 = await txt('#page-indicator');
  await page.$eval('.zone.next', (el) => el.click());
  S.indicatorAfter2 = await txt('#page-indicator');
  log('paged LTR:', S.indicatorStart, '→', S.indicatorAfter1, '→', S.indicatorAfter2);

  await page.click('[data-back-manga]');
  await page.waitForFunction(() => {
    const rows = [...document.querySelectorAll('#chapters .chapter')];
    const row = rows.find((el) => (el.querySelector('.ch-main span')?.textContent || '').startsWith('Cap. 114'));
    return row && row.textContent.includes('pág. 3');
  }, { timeout: 30000 }).catch(() => {});
  const row114 = await rowByLabel('Cap. 114');
  S.progressMark = await row114.evaluate((el) => el.textContent.includes('pág. 3'));
  log('marca de avance en Cap. 114 (pág. 3):', S.progressMark);

  await openChapterRow('Cap. 114');
  await page.waitForSelector('#pages .paged-stage img.page-img', { timeout: 60000 });
  S.indicatorResumed = await txt('#page-indicator');
  log('retomado en:', S.indicatorResumed);

  // --- Dirección RTL: la zona derecha retrocede, la izquierda avanza ---
  await page.evaluate(() => {
    const sel = document.querySelector('#set-page-dir');
    sel.value = 'rtl';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.$eval('.zone.next', (el) => el.click());
  S.indicatorRtlRight = await txt('#page-indicator');
  await page.$eval('.zone.prev', (el) => el.click());
  S.indicatorRtlLeft = await txt('#page-indicator');
  log('paged RTL: derecha →', S.indicatorRtlRight, '| izquierda →', S.indicatorRtlLeft);
  await page.evaluate(() => {
    const sel = document.querySelector('#set-page-dir');
    sel.value = 'ltr';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  });

  // --- Biblioteca persiste tras recargar + logo → inicio ---
  await page.click('[data-back-manga]');
  await page.click('[data-back-browse]');
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => document.querySelectorAll('#library .card').length > 0, { timeout: 90000 });
  S.libraryCardsAfterReload = await page.$$eval('#library .card .t', (els) => els.map((e) => e.textContent.trim()));
  log('biblioteca tras recargar:', JSON.stringify(S.libraryCardsAfterReload));
  const libCards = await page.$$('#library .card');
  await libCards[0].click();
  await page.waitForFunction(() => document.querySelector('#manga-detail h2')?.textContent.includes('Yotsuba'), { timeout: 120000 });
  S.openedFromLibrary = await txt('#manga-detail h2');
  await page.click('#brand');
  S.logoGoesHome = await page.$eval('#view-sources', (el) => !el.hidden);
  log('desde biblioteca:', S.openedFromLibrary, '| logo→inicio:', S.logoGoesHome);

  // --- Weeb Central: precarga del siguiente + descarga manual ---
  await page.click('button[data-open="en.weebcentral"]');
  await page.waitForSelector('#search-input', { visible: true, timeout: 15000 });
  await page.type('#search-input', 'Spy x Family');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelectorAll('#results .card').length > 0, { timeout: 90000 });
  const wcTitles = await page.$$eval('#results .card .t', (els) => els.map((e) => e.textContent.trim()));
  const wcCards = await page.$$('#results .card');
  await wcCards[wcTitles.findIndex((t) => t === 'Spy x Family')].click();
  await page.waitForFunction(() => document.querySelectorAll('#chapters .chapter').length > 0, { timeout: 180000 });
  S.spyChapters = await page.$$eval('#chapters .chapter', (els) => els.length);
  log('Spy x Family capítulos:', S.spyChapters);

  // Añadir Spy a la biblioteca (para abrirlo sin conexión vía snapshot)
  await page.click('#btn-lib');
  await page.waitForFunction(() => document.querySelector('#btn-lib')?.textContent.includes('En tu biblioteca'), { timeout: 15000 });

  // Abrir 140.5: debe precargar 140 (el inmediato posterior en la lista)
  await openChapterRow('Cap. 140.5');
  await page.click('[data-back-manga]');
  await page.waitForSelector('#chapters .chapter', { timeout: 30000 });
  await waitRowDownloaded('Cap. 140 —');
  S.preloadNext = 'Cap. 140 descargado tras abrir 140.5';
  log('precarga ✓:', S.preloadNext);

  // Descarga manual del 141
  const row141 = await rowByLabel('Cap. 141 —');
  await row141.$eval('.dl-btn', (el) => el.click());
  await waitRowDownloaded('Cap. 141 —');
  S.manualDownload = true;
  log('descarga manual del 141 ✓');

  // Borrar una descarga: descargar 140.5 y borrarla desde el mismo botón
  const row1405 = await rowByLabel('Cap. 140.5');
  await row1405.$eval('.dl-btn', (el) => el.click());
  await waitRowDownloaded('Cap. 140.5');
  const row1405b = await rowByLabel('Cap. 140.5');
  await row1405b.$eval('.dl-btn', (el) => el.click());
  await page.waitForFunction(() => {
    const rows = [...document.querySelectorAll('#chapters .chapter')];
    const row = rows.find((el) => (el.querySelector('.ch-main span')?.textContent || '').startsWith('Cap. 140.5'));
    return row && !row.querySelector('.dl-btn')?.classList.contains('done');
  }, { timeout: 30000 });
  S.downloadDeleted = true;
  log('borrado de descarga ✓');

  // --- Sin conexión: biblioteca → snapshot → capítulos precargado/descargado ---
  await page.setOfflineMode(true);
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => document.querySelectorAll('#library .card').length > 0, { timeout: 90000 });
  const offCards = await page.$$('#library .card');
  const offTitles = await page.$$eval('#library .card .t', (els) => els.map((e) => e.textContent.trim()));
  await offCards[offTitles.findIndex((t) => t === 'Spy x Family')].click();
  await page.waitForFunction(() => document.querySelectorAll('#chapters .chapter').length > 0, { timeout: 60000 });
  S.offlineDetailChapters = await page.$$eval('#chapters .chapter', (els) => els.length);
  log('offline: detalle desde snapshot con', S.offlineDetailChapters, 'capítulos');

  async function readOfflineChapter(prefix) {
    await openChapterRow(prefix);
    // Recorrer TODAS las páginas en modo paged: cada una debe venir de un
    // blob local y cargar sin red.
    const total = await page.$eval('#page-indicator', (el) => parseInt(el.textContent.split('/')[1], 10));
    let loadedBlob = 0;
    for (let i = 0; i < total; i++) {
      const ok = await page.waitForFunction(
        () => {
          const img = document.querySelector('#pages img.page-img');
          return img && img.complete && img.naturalWidth > 0 && (img.currentSrc || '').startsWith('blob:');
        },
        { timeout: 30000 },
      ).then(() => true).catch(() => false);
      if (ok) loadedBlob++;
      if (i < total - 1) await page.$eval('.zone.next', (el) => el.click());
    }
    return { total, loadedBlob };
  }
  S.offline140 = await readOfflineChapter('Cap. 140 —');
  log('offline Cap. 140 (precargado):', JSON.stringify(S.offline140));
  await page.click('[data-back-manga]');
  S.offline141 = await readOfflineChapter('Cap. 141 —');
  log('offline Cap. 141 (manual):', JSON.stringify(S.offline141));
  await page.setOfflineMode(false);

  // --- CBZ: importar y leer en orden natural (1, 2, 10) ---
  await page.click('[data-back-manga]');
  await page.click('#brand');
  await page.waitForSelector('#cbz-file', { timeout: 15000 });
  const fileInput = await page.$('#cbz-file');
  try {
    await fileInput.uploadFile(CBZ);
  } catch (uploadErr) {
    log('uploadFile falló, usando DataTransfer:', String(uploadErr).slice(0, 120));
    await page.evaluate(async () => {
      const res = await fetch('tinta-test.cbz');
      const blob = await res.blob();
      const file = new File([blob], 'tinta-test.cbz', { type: 'application/zip' });
      const dt = new DataTransfer();
      dt.items.add(file);
      const input = document.querySelector('#cbz-file');
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }
  await page.waitForFunction(() => {
    const cards = [...document.querySelectorAll('#library .card .t')];
    return cards.some((t) => t.textContent.includes('tinta-test'));
  }, { timeout: 60000 });
  S.cbzImported = true;
  log('CBZ importado ✓');
  const allCards = await page.$$('#library .card');
  const allTitles = await page.$$eval('#library .card .t', (els) => els.map((e) => e.textContent.trim()));
  await allCards[allTitles.findIndex((t) => t.includes('tinta-test'))].click();
  await page.waitForSelector('#pages .paged-stage img.page-img', { timeout: 30000 });
  const widths = [];
  for (let i = 0; i < 3; i++) {
    widths.push(await page.$eval('#pages img.page-img', (el) => el.naturalWidth));
    if (i < 2) await page.$eval('.zone.next', (el) => el.click());
  }
  S.cbzOrder = widths;
  S.cbzIndicator = await txt('#page-indicator');
  log('CBZ orden natural (anchos):', JSON.stringify(widths), '| indicador:', S.cbzIndicator);

  out.success = !!(
    S.version === 'v1.5.0'
    && S.prefs.mode === 'paged' && S.prefs.dir === 'ltr' && S.prefs.preload === '1'
    && S.volHeaders.length > 0
    && S.libraryAdded
    && S.indicatorStart === '1 / 49' && S.indicatorAfter2 === '3 / 49'
    && S.progressMark && S.indicatorResumed === '3 / 49'
    && S.indicatorRtlRight === '2 / 49' && S.indicatorRtlLeft === '3 / 49'
    && S.libraryCardsAfterReload.some((t) => t.includes('Yotsuba'))
    && S.logoGoesHome
    && S.preloadNext && S.manualDownload && S.downloadDeleted
    && S.offlineDetailChapters > 100
    && S.offline140.total > 5 && S.offline140.loadedBlob === S.offline140.total
    && S.offline141.total === 23 && S.offline141.loadedBlob === 23
    && S.cbzImported
    && JSON.stringify(S.cbzOrder) === JSON.stringify([800, 500, 300])
  );
} catch (err) {
  out.success = false;
  out.error = String(err && err.message || err).slice(0, 600);
  out.toastAtError = await page.$eval('#toast', (el) => el.hidden ? '' : el.textContent).catch(() => '<sin acceso>');
  log('ERROR:', out.error, '| toast:', out.toastAtError);
}

console.log('RESULTADO_JSON ' + JSON.stringify(out, null, 1));
await browser.close();
process.exit(out.success ? 0 : 1);
