// E2E Bloque A (v1.4.1): el flujo que falló en el iPhone del usuario.
// Weeb Central -> "Spy x Family" -> capitulo mas reciente (141) -> 23 paginas
// via proxy. Ademas, prueba sintetica del fallback de imagenes: las portadas
// pedidas via proxy se fuerzan a 404 con interceptacion; la app debe
// recuperarlas en directo (data-direct) y terminar cargadas.
import puppeteer from 'puppeteer-core';

const BASE = process.env.TINTA_BASE || 'http://localhost:8789/';
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
page.on('console', (m) => { if (m.type() === 'error') out.consoleErrors.push(m.text().slice(0, 300)); });
page.on('pageerror', (e) => out.consoleErrors.push('pageerror: ' + String(e).slice(0, 300)));

// Interceptacion: las portadas que viajen por el proxy reciben 404 para
// forzar el reintento en directo de armImgFallback/wireImgFallbacks.
await page.setRequestInterception(true);
let coversBroken = 0;
page.on('request', (req) => {
  const url = req.url();
  let target = '';
  try { target = new URL(url).searchParams.get('u') || ''; } catch { /* no es proxy */ }
  if (url.includes('tinta-proxy') && target.includes('/cover/')) {
    coversBroken++;
    req.respond({ status: 404, contentType: 'text/plain', body: 'forzado' }).catch(() => {});
  } else {
    req.continue().catch(() => {});
  }
});

try {
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('#catalog .source-row', { timeout: 30000 });
  out.steps.transport = await page.$eval('#net-status', (el) => el.textContent.trim());
  out.steps.version = await page.$eval('#app-version', (el) => el.textContent.trim()).catch(() => '?');
  log('transporte:', out.steps.transport, '| versión:', out.steps.version);

  await page.waitForSelector('button[data-install="en.weebcentral"]', { timeout: 15000 });
  await page.click('button[data-install="en.weebcentral"]');
  await page.waitForSelector('button[data-open="en.weebcentral"]', { timeout: 90000 });
  log('Weeb Central instalado ✓');

  await page.click('button[data-open="en.weebcentral"]');
  await page.waitForSelector('#search-input', { visible: true, timeout: 15000 });
  await page.type('#search-input', 'Spy x Family');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelectorAll('#results .card').length > 0, { timeout: 120000 });
  const titles = await page.$$eval('#results .card .t', (els) => els.map((e) => e.textContent.trim()));
  out.steps.searchCount = titles.length;
  log('búsqueda:', titles.length, 'resultados:', titles.join(' | '));

  // Esperar a que las portadas terminen (via fallback directo tras el 404)
  await page.waitForFunction(
    () => [...document.querySelectorAll('#results .card img')].every((i) => i.complete),
    { timeout: 60000 },
  ).catch(() => {});
  const coverInfo = await page.$$eval('#results .card img', (imgs) => imgs.map((i) => ({
    loaded: i.naturalWidth > 0,
    viaProxy: (i.currentSrc || '').includes('tinta-proxy'),
    host: i.currentSrc ? new URL(i.currentSrc).host : null,
  })));
  out.steps.coversBrokenByProxy = coversBroken;
  out.steps.covers = coverInfo;
  log('portadas (proxy forzado a 404):', JSON.stringify(coverInfo), '| peticiones rotas:', coversBroken);
  out.steps.fallbackOk = coversBroken > 0 && coverInfo.length > 0
    && coverInfo.every((c) => c.loaded && !c.viaProxy);

  const idx = titles.findIndex((t) => t === 'Spy x Family');
  if (idx < 0) throw new Error('No apareció "Spy x Family" exacto');
  const cards = await page.$$('#results .card');
  await cards[idx].click();
  await page.waitForFunction(() => document.querySelectorAll('#chapters .chapter').length > 0, { timeout: 180000 });
  out.steps.mangaTitle = await page.$eval('#manga-detail h2', (el) => el.textContent.trim());
  const chapterInfo = await page.$$eval('#chapters .chapter', (els) => ({
    total: els.length,
    firstLabel: els.length ? els[0].textContent.trim().slice(0, 60) : null,
  }));
  out.steps.chapters = chapterInfo;
  log('manga:', out.steps.mangaTitle, '| capítulos:', chapterInfo.total, '| primero:', chapterInfo.firstLabel);
  const detailCover = await page.$eval('#manga-detail img', (i) => ({
    loaded: i.naturalWidth > 0, viaProxy: (i.currentSrc || '').includes('tinta-proxy'),
  })).catch(() => null);
  out.steps.detailCover = detailCover;
  log('portada de detalle (también forzada a 404 vía proxy):', JSON.stringify(detailCover));

  const chapterEls = await page.$$('#chapters .chapter');
  await chapterEls[0].click();
  await page.waitForFunction(() => document.querySelectorAll('#pages img').length > 0, { timeout: 120000 });
  out.steps.readerTitle = await page.$eval('#reader-title', (el) => el.textContent.trim());
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
    { timeout: 180000 },
  ).catch(() => {});
  const pageInfo = await page.$$eval('#pages img', (imgs) => ({
    total: imgs.length,
    loaded: imgs.filter((i) => i.naturalWidth > 0).length,
    viaProxy: imgs.filter((i) => (i.currentSrc || '').includes('tinta-proxy')).length,
    firstHost: imgs.length ? new URL(imgs[0].currentSrc || imgs[0].src).host : null,
  }));
  out.steps.pages = pageInfo;
  log('lector:', out.steps.readerTitle, '| páginas:', pageInfo.total, '| cargadas:', pageInfo.loaded, '| vía proxy:', pageInfo.viaProxy);
  out.success = out.steps.fallbackOk && pageInfo.total === 23 && pageInfo.loaded === 23 && pageInfo.viaProxy === 23;
} catch (err) {
  out.success = false;
  out.error = String(err && err.message || err).slice(0, 500);
  out.toastAtError = await page.$eval('#toast', (el) => el.hidden ? '' : el.textContent).catch(() => '<sin acceso>');
  log('ERROR:', out.error, '| toast:', out.toastAtError);
}

console.log('RESULTADO_JSON ' + JSON.stringify(out, null, 1));
await browser.close();
process.exit(out.success ? 0 : 1);
