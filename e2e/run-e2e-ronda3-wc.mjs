// E2E Ronda 3 (complemento): solo Weeb Central / One Piece, para transportes
// lentos (el respaldo XHR síncrono tarda >180 s en el update de 1196 caps.
// a través de la cadena de proxies del rig). Verifica la paginación de la
// lista: bloques de 50 (la fuente no trae volume_number), primer capítulo
// Cap. 1 y recorrido del paginador. Base según TINTA_BASE.
import puppeteer from 'puppeteer-core';

const BASE = process.env.TINTA_BASE || 'http://localhost:8789/';
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
const browser = await puppeteer.launch({ executablePath: EXE, args: launchArgs, protocolTimeout: 600000 });
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
const firstRowLabel = () => page.$eval('#chapters .chapter .ch-main span', (el) => el.textContent.trim()).catch(() => null);
const rowCount = () => page.$$eval('#chapters .chapter', (els) => els.length);
const pagerInfo = () => page.$eval('#chapters-pager-top .pager-info', (el) => el.textContent.trim()).catch(() => null);

try {
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('#catalog .source-row', { timeout: 60000 });
  S.transport = await txt('#net-status');
  S.version = await txt('#app-version');
  log('transporte:', S.transport, '| versión:', S.version);

  await page.waitForSelector('button[data-install="en.weebcentral"]', { timeout: 15000 });
  await page.click('button[data-install="en.weebcentral"]');
  await page.waitForSelector('button[data-open="en.weebcentral"]', { timeout: 120000 });
  await page.click('button[data-open="en.weebcentral"]');
  await page.waitForSelector('#search-input', { visible: true, timeout: 15000 });
  await page.type('#search-input', 'One Piece');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelectorAll('#results .card').length > 0, { timeout: 180000 });
  const wcTitles = await page.$$eval('#results .card .t', (els) => els.map((e) => e.textContent.trim()));
  const wcCards = await page.$$('#results .card');
  const wcIdx = Math.max(0, wcTitles.findIndex((t) => t === 'One Piece'));
  log('buscando detalle de One Piece (update, puede tardar en respaldo)…');
  const t0 = Date.now();
  await wcCards[wcIdx].click();
  await page.waitForFunction(() => document.querySelectorAll('#chapters .chapter').length > 0, { timeout: 480000 });
  S.wcUpdateSecs = Math.round((Date.now() - t0) / 1000);
  S.wcTitle = await txt('#manga-detail h2');
  S.wcRowsPage1 = await rowCount();
  S.wcFirstChapter = await firstRowLabel();
  S.wcPagerInfo1 = await pagerInfo();
  const firstKey1 = await page.$eval('#chapters .chapter', (el) => el.dataset.chapterKey);
  log('One Piece (update en', S.wcUpdateSecs, 's): filas pág.1 =', S.wcRowsPage1,
    '| primer capítulo =', JSON.stringify(S.wcFirstChapter), '| paginador =', JSON.stringify(S.wcPagerInfo1));

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
    && S.wcTitle === 'One Piece'
    && S.wcRowsPage1 === 50
    && (S.wcFirstChapter || '').startsWith('Cap. 1')
    && (S.wcPagerInfo1 || '').includes('Página 1 de')
    && S.wcRowsPage2 === 50
    && (S.wcFirstChapterP2 || '').startsWith('Cap. 51')
    && (S.wcPagerInfo2 || '').includes('Página 2 de')
  );
} catch (err) {
  out.success = false;
  out.error = String(err && err.message || err).slice(0, 600);
  log('ERROR:', out.error);
}

console.log('RESULTADO_JSON ' + JSON.stringify(out, null, 1));
await browser.close();
process.exit(out.success ? 0 : 1);
