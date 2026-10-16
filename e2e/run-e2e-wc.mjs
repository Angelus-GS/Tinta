// Prueba e2e de Fase 2 (Weeb Central) con Chromium real vía puppeteer-core.
// Flujo: instalar Weeb Central desde el catálogo -> buscar "One Piece" ->
// detalle con capítulos -> abrir un capítulo -> contar páginas cargadas.
// La red pasa por la cadena de proxies local y el proxy real del usuario
// (TINTA_PROXYBASE), igual que en producción.
import puppeteer from 'puppeteer-core';

const BASE = process.env.TINTA_BASE || 'http://localhost:8788/';
const EXE = '/home/hatch/workspace/tinta/e2e/chrome-headless-shell/linux-155.0.8059.84/chrome-headless-shell-linux64/chrome-headless-shell';
const log = (...a) => console.log(...a);
const out = { base: BASE, steps: {}, consoleErrors: [] };

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
if (process.env.TINTA_NO_JSPI) launchArgs.push('--js-flags=--no-experimental-wasm-jspi');
if (proxy) launchArgs.push(`--proxy-server=${proxy}`, '--proxy-bypass-list=localhost;127.0.0.1');
const browser = await puppeteer.launch({
  executablePath: EXE,
  args: launchArgs,
  protocolTimeout: 300000,
});
const page = await browser.newPage();
await page.setViewport({ width: 420, height: 900 });
// UA de navegador normal: Cloudflare desafia el UA "HeadlessChrome" del rig
// con un 403 al pasar por el proxy (verificado con curl). Los usuarios
// reales no traen ese UA; es un artefacto del entorno de prueba.
await page.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36');
if (process.env.TINTA_PROXYBASE) {
  await page.evaluateOnNewDocument((v) => {
    try { localStorage.setItem('tinta.proxyBase', v); } catch { /* sin acceso */ }
  }, process.env.TINTA_PROXYBASE);
}
page.on('console', (m) => { if (m.type() === 'error') out.consoleErrors.push(m.text().slice(0, 300)); });
page.on('pageerror', (e) => out.consoleErrors.push('pageerror: ' + String(e).slice(0, 300)));

try {
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('#catalog .source-row', { timeout: 30000 });
  out.steps.transport = await page.$eval('#net-status', (el) => el.textContent.trim());
  out.steps.version = await page.$eval('#app-version', (el) => el.textContent.trim()).catch(() => '?');
  log('transporte:', out.steps.transport, '| versión:', out.steps.version);

  // Instalar Weeb Central
  await page.waitForSelector('button[data-install="en.weebcentral"]', { timeout: 15000 });
  await page.click('button[data-install="en.weebcentral"]');
  await page.waitForSelector('button[data-open="en.weebcentral"]', { timeout: 90000 });
  out.steps.installed = true;
  log('Weeb Central instalado ✓');

  // Abrir fuente y buscar
  await page.click('button[data-open="en.weebcentral"]');
  await page.waitForSelector('#search-input', { visible: true, timeout: 15000 });
  await page.type('#search-input', 'One Piece');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelectorAll('#results .card').length > 0, { timeout: 120000 });
  const titles = await page.$$eval('#results .card .t', (els) => els.map((e) => e.textContent.trim()));
  out.steps.searchCount = titles.length;
  out.steps.firstTitles = titles.slice(0, 5);
  const coversLoaded = await page.$$eval('#results .card img',
    (imgs) => imgs.filter((i) => i.complete && i.naturalWidth > 0).length).catch(() => 0);
  out.steps.searchCoversLoaded = coversLoaded;
  log('búsqueda:', titles.length, 'resultados:', titles.slice(0, 3).join(' | '), '| portadas cargadas:', coversLoaded);

  // Abrir "One Piece" exacto
  const idx = titles.findIndex((t) => t === 'One Piece');
  if (idx < 0) throw new Error('No apareció "One Piece" exacto en resultados');
  const cards = await page.$$('#results .card');
  await cards[idx].click();
  await page.waitForFunction(() => document.querySelectorAll('#chapters .chapter').length > 0, { timeout: 180000 });
  out.steps.mangaTitle = await page.$eval('#manga-detail h2', (el) => el.textContent.trim());
  const chapterInfo = await page.$$eval('#chapters .chapter', (els) => ({
    total: els.length,
    firstLabels: els.slice(0, 3).map((e) => e.textContent.trim().slice(0, 60)),
  }));
  out.steps.chapters = chapterInfo;
  log('manga:', out.steps.mangaTitle, '| capítulos:', chapterInfo.total, '| primeros:', chapterInfo.firstLabels.join(' | '));
  if (chapterInfo.total < 1) throw new Error('Sin capítulos');

  // Abrir el primer capítulo (el más reciente)
  const chapterEls = await page.$$('#chapters .chapter');
  await chapterEls[0].click();
  await page.waitForFunction(() => document.querySelectorAll('#pages img').length > 0, { timeout: 120000 });
  out.steps.readerTitle = await page.$eval('#reader-title', (el) => el.textContent.trim());

  // Disparar la carga perezosa recorriendo la página
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let y = 0;
      const t = setInterval(() => {
        y += 1200;
        window.scrollTo(0, y);
        if (y >= document.body.scrollHeight) { clearInterval(t); resolve(); }
      }, 150);
    });
  });
  await page.waitForFunction(
    () => [...document.querySelectorAll('#pages img')].every((i) => i.complete),
    { timeout: 120000 },
  ).catch(() => {});
  const pageInfo = await page.$$eval('#pages img', (imgs) => ({
    total: imgs.length,
    loaded: imgs.filter((i) => i.naturalWidth > 0).length,
    firstHost: imgs.length ? new URL(imgs[0].src).host : null,
    firstSrc: imgs.length ? imgs[0].src.slice(0, 110) : null,
  }));
  out.steps.pages = pageInfo;
  log('lector:', out.steps.readerTitle, '| páginas:', pageInfo.total, '| cargadas:', pageInfo.loaded, '| host:', pageInfo.firstHost);
  out.success = pageInfo.total >= 5 && pageInfo.loaded >= Math.min(10, pageInfo.total);
} catch (err) {
  out.success = false;
  out.error = String(err && err.message || err).slice(0, 500);
  out.toastAtError = await page.$eval('#toast', (el) => el.hidden ? '' : el.textContent).catch(() => '<sin acceso>');
  log('ERROR:', out.error, '| toast:', out.toastAtError);
}

console.log('RESULTADO_JSON ' + JSON.stringify(out, null, 1));
await browser.close();
process.exit(out.success ? 0 : 1);
