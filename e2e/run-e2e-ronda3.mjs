// E2E Ronda 3 (v1.7.0): lista de capítulos paginada y orden viejo→nuevo por
// defecto (invertible y persistente). Páginas por volumen cuando la fuente
// trae volume_number; bloques de 50 cuando no. Regresiones breves: avance,
// "Continuar leyendo" (con salto de página al volver) y precarga.
// Transporte según TINTA_BASE (:8788 JSPI · :8789 respaldo XHR síncrono).
import puppeteer from 'puppeteer-core';

const BASE = process.env.TINTA_BASE || 'http://localhost:8788/';
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
const clickEl = (sel) => page.$eval(sel, (el) => el.click());
const firstVolHeader = () => page.$eval('#chapters .vol-header', (el) => el.textContent.trim()).catch(() => null);
const firstRowLabel = () => page.$eval('#chapters .chapter .ch-main span', (el) => el.textContent.trim()).catch(() => null);
const rowCount = () => page.$$eval('#chapters .chapter', (els) => els.length);
const pagerInfo = () => page.$eval('#chapters-pager-top .pager-info', (el) => el.textContent.trim()).catch(() => null);

async function waitVolHeader(expected, timeout = 60000) {
  await page.waitForFunction(
    (exp) => document.querySelector('#chapters .vol-header')?.textContent.trim() === exp,
    { timeout }, expected,
  );
}
async function openYotsubaDetail() {
  await page.click('button[data-open="multi.mangadex"]');
  await page.waitForSelector('#search-input', { visible: true, timeout: 15000 });
  // La búsqueda atraviesa la cadena de proxies del rig (latencia variable,
  // ya vista entre 2 y 90+ s): un reintento si el primero se pasa de tiempo.
  let lastErr = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await page.evaluate(() => { document.querySelector('#search-input').value = ''; });
      await page.type('#search-input', 'Yotsuba');
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => document.querySelectorAll('#results .card').length > 0, { timeout: 120000 });
      lastErr = null;
      break;
    } catch (e) { lastErr = e; }
  }
  if (lastErr) throw lastErr;
  const titles = await page.$$eval('#results .card .t', (els) => els.map((e) => e.textContent.trim()));
  const cards = await page.$$('#results .card');
  await cards[titles.findIndex((t) => t.toLowerCase().startsWith('yotsuba'))].click();
  await page.waitForFunction(() => document.querySelectorAll('#chapters .chapter').length > 0, { timeout: 120000 });
}
async function rowByLabel(prefix) {
  const rows = await page.$$('#chapters .chapter');
  for (const r of rows) {
    const t = await r.evaluate((el) => el.querySelector('.ch-main span')?.textContent || '');
    if (t.startsWith(prefix)) return r;
  }
  return null;
}

try {
  // --- Arranque e instalación ---
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('#catalog .source-row', { timeout: 60000 });
  S.transport = await txt('#net-status');
  S.version = await txt('#app-version');
  log('transporte:', S.transport, '| versión:', S.version);
  await page.waitForSelector('button[data-install="multi.mangadex"]', { timeout: 15000 });
  await page.click('button[data-install="multi.mangadex"]');
  await page.waitForSelector('button[data-open="multi.mangadex"]', { timeout: 90000 });
  await page.click('button[data-install="en.weebcentral"]');
  await page.waitForSelector('button[data-open="en.weebcentral"]', { timeout: 90000 });
  log('fuentes instaladas ✓');

  // --- Yotsuba: orden por defecto ASC (el tomo más viejo primero) ---
  await openYotsubaDetail();
  S.mangaTitle = await txt('#manga-detail h2');
  S.volPage1 = await firstVolHeader();
  S.firstChapterAsc = await firstRowLabel();
  S.rowsPage1 = await rowCount();
  S.pagerInfoAsc1 = await pagerInfo();
  S.orderBtnAsc = await txt('#btn-order');
  S.orderLsDefault = await page.evaluate(() => localStorage.getItem('tinta.chapterOrder'));
  log('ASC: volumen =', S.volPage1, '| primer capítulo =', JSON.stringify(S.firstChapterAsc),
    '| filas =', S.rowsPage1, '| paginador =', JSON.stringify(S.pagerInfoAsc1));

  // --- Paginador: Siguiente → Volumen 2 ---
  await clickEl('#chapters-pager-top button:last-child');
  await waitVolHeader('Volumen 2');
  S.volPage2 = await firstVolHeader();
  S.pagerInfoAsc2 = await pagerInfo();
  log('página 2:', S.volPage2, '|', JSON.stringify(S.pagerInfoAsc2));

  // --- Invertir el orden → el más nuevo primero (Volumen 16) ---
  await page.click('#btn-order');
  await waitVolHeader('Volumen 16');
  S.volDesc = await firstVolHeader();
  S.orderBtnDesc = await txt('#btn-order');
  S.orderLsDesc = await page.evaluate(() => localStorage.getItem('tinta.chapterOrder'));
  log('DESC: volumen =', S.volDesc, '| botón =', JSON.stringify(S.orderBtnDesc), '| ls =', S.orderLsDesc);

  // --- La preferencia persiste tras recargar ---
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('button[data-open="multi.mangadex"]', { timeout: 90000 });
  await openYotsubaDetail();
  S.volAfterReload = await firstVolHeader();
  S.orderBtnAfterReload = await txt('#btn-order');
  log('tras recargar (debe seguir DESC):', S.volAfterReload);

  // Volver a ASC para el resto de la prueba
  await page.click('#btn-order');
  await waitVolHeader('Volumen 1');

  // --- Ir a la última página (Volumen 16) y leer el Cap. 114 completo ---
  for (let i = 0; i < 20; i++) {
    if ((await firstVolHeader()) === 'Volumen 16') break;
    const prevInfo = await pagerInfo();
    await clickEl('#chapters-pager-bottom button:last-child');
    await page.waitForFunction(
      (prev) => document.querySelector('#chapters-pager-top .pager-info')?.textContent.trim() !== prev,
      { timeout: 30000 }, prevInfo,
    );
  }
  S.volLastPage = await firstVolHeader();
  const row114 = await rowByLabel('Cap. 114');
  if (!row114) throw new Error('Fila Cap. 114 no encontrada en la página del Volumen 16');
  await row114.click();
  await page.waitForFunction(() => document.querySelectorAll('#pages img').length > 0, { timeout: 120000 });
  S.readerTotal = await page.$$eval('#pages img', (els) => els.length);
  await page.evaluate(async () => {
    const imgs = [...document.querySelectorAll('#pages img')];
    for (const img of imgs) {
      img.scrollIntoView();
      await new Promise((r) => setTimeout(r, 40));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForFunction(
    () => [...document.querySelectorAll('#pages img')].every((i) => i.complete && i.naturalWidth > 0),
    { timeout: 180000 },
  );
  S.readerLoaded = await page.$$eval('#pages img', (els) => els.filter((i) => i.naturalWidth > 0).length);
  log('lector Cap. 114:', S.readerLoaded, '/', S.readerTotal);
  // Dar tiempo a que el último saveProgress (IntersectionObserver → IDB) aterrice
  await new Promise((r) => setTimeout(r, 2500));

  // Volver: marca de leído visible en la fila del Cap. 114
  await clickEl('[data-back-manga]');
  await page.waitForFunction(() => !document.querySelector('#view-manga').hidden, { timeout: 30000 });
  await page.waitForFunction(() => [...document.querySelectorAll('#chapters .chapter')]
    .some((r) => r.classList.contains('read')
      && (r.querySelector('.ch-main span')?.textContent || '').startsWith('Cap. 114')), { timeout: 30000 });
  S.readMarkOk = true;
  S.volAfterRead = await firstVolHeader();
  log('marca de leído ✓ | lista en:', S.volAfterRead);

  // --- Continuar leyendo + salto de página al volver ---
  // El botón «Continuar» se ofrece al abrir el detalle con progreso ya
  // guardado (así lo construye openManga): se reabre el manga, se mueve la
  // lista a OTRA página y Continuar debe abrir el capítulo; al volver, la
  // lista salta a la página donde vive ese capítulo (Volumen 16).
  await clickEl('#brand');
  await page.waitForSelector('button[data-open="multi.mangadex"]', { timeout: 90000 });
  await openYotsubaDetail();
  await page.waitForSelector('#btn-continue:not([hidden])', { timeout: 15000 });
  S.continueLabel = await txt('#btn-continue');
  await clickEl('#chapters-pager-top button:last-child'); // → Volumen 2
  await waitVolHeader('Volumen 2');
  S.volBeforeContinue = await firstVolHeader();
  await page.click('#btn-continue');
  await page.waitForFunction(() => document.querySelectorAll('#pages img').length > 0, { timeout: 120000 });
  await clickEl('[data-back-manga]');
  await page.waitForFunction(() => !document.querySelector('#view-manga').hidden, { timeout: 30000 });
  await waitVolHeader('Volumen 16');
  S.volAfterContinue = await firstVolHeader();
  log('Continuar:', JSON.stringify(S.continueLabel), '| lista estaba en', S.volBeforeContinue, '→ saltó a', S.volAfterContinue);

  // --- Precarga (breve): el capítulo siguiente en la lista quedó descargado ---
  S.preloadedCount = 0;
  for (let i = 0; i < 30 && !S.preloadedCount; i++) {
    S.preloadedCount = await page.evaluate(async () => {
      const db = await new Promise((res, rej) => {
        const r = indexedDB.open('tinta');
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
      if (!db.objectStoreNames.contains('downloads')) return 0;
      const all = await new Promise((res, rej) => {
        const r = db.transaction('downloads').objectStore('downloads').getAll();
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
      return all.filter((d) => d.preloaded && String(d.mangaTitle || '').includes('Yotsuba')).length;
    }).catch(() => 0);
    if (!S.preloadedCount) await new Promise((r) => setTimeout(r, 5000));
  }
  log('precargas registradas en IDB:', S.preloadedCount);

  // --- Weeb Central / One Piece: la lista NO renderiza miles de filas ---
  await clickEl('#brand');
  await page.click('button[data-open="en.weebcentral"]');
  await page.waitForSelector('#search-input', { visible: true, timeout: 15000 });
  await page.evaluate(() => { document.querySelector('#search-input').value = ''; });
  await page.type('#search-input', 'One Piece');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelectorAll('#results .card').length > 0, { timeout: 150000 });
  const wcTitles = await page.$$eval('#results .card .t', (els) => els.map((e) => e.textContent.trim()));
  const wcCards = await page.$$('#results .card');
  const wcIdx = Math.max(0, wcTitles.findIndex((t) => t === 'One Piece'));
  await wcCards[wcIdx].click();
  await page.waitForFunction(() => document.querySelectorAll('#chapters .chapter').length > 0, { timeout: 180000 });
  S.wcTitle = await txt('#manga-detail h2');
  S.wcRowsPage1 = await rowCount();
  S.wcFirstChapter = await firstRowLabel();
  S.wcPagerInfo1 = await pagerInfo();
  const firstKey1 = await page.$eval('#chapters .chapter', (el) => el.dataset.chapterKey);
  log('One Piece: filas pág.1 =', S.wcRowsPage1, '| primer capítulo =', JSON.stringify(S.wcFirstChapter),
    '| paginador =', JSON.stringify(S.wcPagerInfo1));
  await clickEl('#chapters-pager-bottom button:last-child');
  await page.waitForFunction(
    (k) => document.querySelector('#chapters .chapter')?.dataset.chapterKey !== k,
    { timeout: 60000 }, firstKey1,
  );
  S.wcRowsPage2 = await rowCount();
  S.wcPagerInfo2 = await pagerInfo();
  S.wcFirstChapterP2 = await firstRowLabel();
  log('One Piece pág.2: filas =', S.wcRowsPage2, '| primer capítulo =', JSON.stringify(S.wcFirstChapterP2),
    '| paginador =', JSON.stringify(S.wcPagerInfo2));

  out.success = !!(
    S.version === 'v1.7.0'
    && S.mangaTitle.includes('Yotsuba')
    && S.volPage1 === 'Volumen 1'
    && (S.firstChapterAsc || '').startsWith('Cap. 1')
    && S.rowsPage1 > 0 && S.rowsPage1 <= 50
    && (S.pagerInfoAsc1 || '').includes('Volumen 1')
    && (S.orderBtnAsc || '').includes('viejo → nuevo')
    && S.volPage2 === 'Volumen 2'
    && S.volDesc === 'Volumen 16'
    && S.orderLsDesc === 'desc'
    && (S.orderBtnDesc || '').includes('nuevo → viejo')
    && S.volAfterReload === 'Volumen 16'
    && S.volLastPage === 'Volumen 16'
    && S.readerTotal > 0 && S.readerLoaded === S.readerTotal
    && S.readMarkOk === true
    && (S.continueLabel || '').includes('Cap. 114')
    && S.volBeforeContinue === 'Volumen 2'
    && S.volAfterContinue === 'Volumen 16'
    && S.preloadedCount >= 1
    && S.wcRowsPage1 > 0 && S.wcRowsPage1 <= 100
    && (S.wcFirstChapter || '').startsWith('Cap. 1')
    && S.wcRowsPage2 > 0 && S.wcRowsPage2 <= 100
    && S.wcPagerInfo2 !== S.wcPagerInfo1
    && !(S.wcFirstChapterP2 || '').startsWith('Cap. 1 —')
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
