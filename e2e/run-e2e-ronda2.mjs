// E2E Ronda 2 de mejoras (v1.6.0): favoritos en el home + lector paginado
// inmersivo a pantalla completa (encuadre Ajustar/Llenar, controles por
// toque central). Regresiones: MangaDex 49/49 en scroll y paginado,
// Weeb Central busca, biblioteca/descargas intactos.
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
const indicator = async () => {
  const t = await txt('#page-indicator');
  const [a, b] = t.split('/').map((x) => parseInt(x, 10));
  return { page: a, total: b, raw: t };
};
async function rowByLabel(prefix) {
  const rows = await page.$$('#chapters .chapter');
  for (const r of rows) {
    const t = await r.evaluate((el) => el.querySelector('.ch-main span')?.textContent || '');
    if (t.startsWith(prefix)) return r;
  }
  return null;
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
const clickEl = (sel) => page.$eval(sel, (el) => el.click());

try {
  // --- Arranque ---
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('#catalog .source-row', { timeout: 60000 });
  S.transport = await txt('#net-status');
  S.version = await txt('#app-version');
  log('transporte:', S.transport, '| versión:', S.version);

  // --- Instalar las dos fuentes ---
  await page.waitForSelector('button[data-install="multi.mangadex"]', { timeout: 15000 });
  await page.click('button[data-install="multi.mangadex"]');
  await page.waitForSelector('button[data-open="multi.mangadex"]', { timeout: 90000 });
  await page.click('button[data-install="en.weebcentral"]');
  await page.waitForSelector('button[data-open="en.weebcentral"]', { timeout: 90000 });
  log('fuentes instaladas ✓');

  // --- MangaDex: buscar Yotsuba y abrir el detalle ---
  await page.click('button[data-open="multi.mangadex"]');
  await page.waitForSelector('#search-input', { visible: true, timeout: 15000 });
  await page.type('#search-input', 'Yotsuba');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelectorAll('#results .card').length > 0, { timeout: 90000 });
  const titles = await page.$$eval('#results .card .t', (els) => els.map((e) => e.textContent.trim()));
  const cards = await page.$$('#results .card');
  await cards[titles.findIndex((t) => t.toLowerCase().startsWith('yotsuba'))].click();
  await page.waitForFunction(() => document.querySelectorAll('#chapters .chapter').length > 0, { timeout: 120000 });
  S.mangaTitle = await txt('#manga-detail h2');
  S.dlButtons = await page.$$eval('#chapters .dl-btn', (els) => els.length);
  log('manga:', S.mangaTitle, '| botones de descarga (regresión Fase 3):', S.dlButtons);

  // --- Favorito desde el detalle ---
  S.favBtnInitial = await txt('#btn-fav');
  await page.click('#btn-fav');
  await page.waitForFunction(() => document.querySelector('#btn-fav')?.textContent.includes('⭐'), { timeout: 15000 });
  S.favBtnOn = await txt('#btn-fav');
  await clickEl('#brand');
  await page.waitForFunction(() => {
    const w = document.querySelector('#favorites-wrap');
    return w && !w.hidden && document.querySelectorAll('#favorites .card').length > 0;
  }, { timeout: 30000 });
  S.favHomeTitles = await page.$$eval('#favorites .card .t', (els) => els.map((e) => e.textContent.trim()));
  log('favoritos en el home:', JSON.stringify(S.favHomeTitles));

  // --- Persistencia tras recargar ---
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => {
    const w = document.querySelector('#favorites-wrap');
    return w && !w.hidden && document.querySelectorAll('#favorites .card').length > 0;
  }, { timeout: 90000 });
  S.favHomeAfterReload = await page.$$eval('#favorites .card .t', (els) => els.map((e) => e.textContent.trim()));
  log('favoritos tras recargar:', JSON.stringify(S.favHomeAfterReload));

  // --- Abrir el manga DESDE el home (favoritos) ---
  await page.$eval('#favorites .card', (el) => el.click());
  await page.waitForFunction(() => document.querySelector('#manga-detail h2')?.textContent.includes('Yotsuba'), { timeout: 120000 });
  await page.waitForFunction(() => document.querySelectorAll('#chapters .chapter').length > 0, { timeout: 60000 });
  S.openedFromFavorites = await txt('#manga-detail h2');
  log('abierto desde favoritos:', S.openedFromFavorites);

  // --- Desmarcar: sale del home, PERMANECE en la biblioteca ---
  await page.click('#btn-fav');
  await page.waitForFunction(() => document.querySelector('#btn-fav')?.textContent.includes('☆'), { timeout: 15000 });
  await clickEl('#brand');
  await page.waitForFunction(() => document.querySelector('#favorites-wrap')?.hidden === true, { timeout: 30000 });
  S.favHomeAfterUnfav = await page.$$eval('#favorites .card', (els) => els.length);
  S.libraryStillThere = await page.$$eval('#library .card .t', (els) => els.map((e) => e.textContent.trim()));
  log('tras desmarcar: favoritos =', S.favHomeAfterUnfav, '| biblioteca =', JSON.stringify(S.libraryStillThere));

  // Volver al detalle desde la biblioteca para las pruebas del lector
  await page.$eval('#library .card', (el) => el.click());
  await page.waitForFunction(() => document.querySelectorAll('#chapters .chapter').length > 0, { timeout: 120000 });

  // --- Regresión scroll: Cap. 114 con 49/49 páginas cargadas ---
  await openChapterRow('Cap. 114');
  S.scrollTotal = await page.$$eval('#pages img', (els) => els.length);
  await page.evaluate(async () => {
    const imgs = [...document.querySelectorAll('#pages img')];
    for (const img of imgs) {
      img.scrollIntoView();
      await new Promise((r) => setTimeout(r, 50));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForFunction(
    () => [...document.querySelectorAll('#pages img')].every((i) => i.complete && i.naturalWidth > 0),
    { timeout: 180000 },
  );
  S.scrollLoaded = await page.$$eval('#pages img', (els) => els.filter((i) => i.naturalWidth > 0).length);
  log('scroll Cap. 114:', S.scrollLoaded, '/', S.scrollTotal, 'cargadas');
  await clickEl('[data-back-manga]');

  // --- Lector paginado inmersivo: Cap. 113 ---
  await page.evaluate(() => localStorage.setItem('tinta.readerMode', 'paged'));
  await openChapterRow('Cap. 113');
  await page.waitForSelector('#pages .paged-stage img.page-img', { timeout: 60000 });
  await page.waitForFunction(() => {
    const img = document.querySelector('#pages img.page-img');
    return img && img.complete && img.naturalWidth > 0;
  }, { timeout: 60000 });
  const ind0 = await indicator();
  S.pagedIndicatorStart = ind0.raw;
  S.immersive = await page.evaluate(() => {
    const stage = document.querySelector('#pages .paged-stage');
    const r = stage.getBoundingClientRect();
    const header = document.querySelector('header');
    const img = document.querySelector('#pages img.page-img');
    return {
      bodyClass: document.body.classList.contains('immersive'),
      headerDisplay: getComputedStyle(header).display,
      ratioW: r.width / window.innerWidth,
      ratioH: r.height / window.innerHeight,
      fit: getComputedStyle(img).objectFit,
      imgClass: img.className,
      controlsHidden: document.querySelector('#reader-controls').hidden,
    };
  });
  log('inmersivo:', JSON.stringify(S.immersive), '| indicador:', S.pagedIndicatorStart);

  // Controles por toque central: mostrar → encuadre Llenar → Ajustar → ocultar
  await clickEl('.zone.center');
  S.controlsShown = await page.$eval('#reader-controls', (el) => !el.hidden);
  await clickEl('#btn-rc-fit');
  S.fitCover = await page.$eval('#pages img.page-img', (el) => ({
    cls: el.className, fit: getComputedStyle(el).objectFit,
    ls: localStorage.getItem('tinta.pageFit'),
  }));
  await clickEl('#btn-rc-fit');
  S.fitContain = await page.$eval('#pages img.page-img', (el) => ({
    cls: el.className, fit: getComputedStyle(el).objectFit,
    ls: localStorage.getItem('tinta.pageFit'),
  }));
  await clickEl('.zone.center');
  S.controlsHiddenAgain = await page.$eval('#reader-controls', (el) => el.hidden);
  log('controles: mostrados =', S.controlsShown, '| llenar =', JSON.stringify(S.fitCover),
    '| ajustar =', JSON.stringify(S.fitContain), '| ocultos de nuevo =', S.controlsHiddenAgain);

  // Navegación LTR por zonas (defecto)
  await clickEl('.zone.next');
  const indLtrNext = await indicator();
  await clickEl('.zone.prev');
  const indLtrPrev = await indicator();
  S.ltrNav = { from: ind0.page, next: indLtrNext.page, back: indLtrPrev.page };
  log('LTR:', JSON.stringify(S.ltrNav));

  // Navegación RTL: desde la página 3, la zona derecha retrocede y la
  // izquierda avanza (semántica verificada en la Fase 3).
  await clickEl('.zone.next');
  await clickEl('.zone.next');
  const indMid = await indicator();
  await page.evaluate(() => localStorage.setItem('tinta.pageDir', 'rtl'));
  await clickEl('.zone.next');
  const indRtlNext = await indicator();
  await clickEl('.zone.prev');
  const indRtlPrev = await indicator();
  S.rtlNav = { at: indMid.page, rightZone: indRtlNext.page, leftZone: indRtlPrev.page };
  await page.evaluate(() => localStorage.setItem('tinta.pageDir', 'ltr'));
  log('RTL:', JSON.stringify(S.rtlNav));

  // Salir de la inmersión por la barra de controles
  await clickEl('.zone.center');
  await clickEl('#reader-controls [data-back-manga]');
  await page.waitForFunction(() => !document.querySelector('#view-manga').hidden, { timeout: 30000 });
  S.exitedImmersive = await page.evaluate(() => ({
    bodyClass: document.body.classList.contains('immersive'),
    headerDisplay: getComputedStyle(document.querySelector('header')).display,
  }));
  log('salida de la inmersión:', JSON.stringify(S.exitedImmersive));

  // --- Regresión Weeb Central: buscar funciona ---
  await clickEl('#brand');
  await page.click('button[data-open="en.weebcentral"]');
  await page.waitForSelector('#search-input', { visible: true, timeout: 15000 });
  await page.type('#search-input', 'One Piece');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelectorAll('#results .card').length > 0, { timeout: 90000 });
  S.wcResults = await page.$$eval('#results .card .t', (els) => els.map((e) => e.textContent.trim()));
  log('Weeb Central resultados:', JSON.stringify(S.wcResults.slice(0, 3)));

  out.success = !!(
    S.version === 'v1.6.0'
    && S.mangaTitle.includes('Yotsuba')
    && S.dlButtons > 0
    && S.favBtnInitial.includes('☆') && S.favBtnOn.includes('⭐')
    && S.favHomeTitles.some((t) => t.includes('Yotsuba'))
    && S.favHomeAfterReload.some((t) => t.includes('Yotsuba'))
    && S.openedFromFavorites.includes('Yotsuba')
    && S.favHomeAfterUnfav === 0
    && S.libraryStillThere.some((t) => t.includes('Yotsuba'))
    && S.scrollTotal === 49 && S.scrollLoaded === 49
    && S.immersive.bodyClass === true
    && S.immersive.headerDisplay === 'none'
    && S.immersive.ratioW >= 0.99 && S.immersive.ratioH >= 0.99
    && S.immersive.fit === 'contain' && S.immersive.controlsHidden === true
    && S.controlsShown === true
    && S.fitCover.fit === 'cover' && S.fitCover.ls === 'llenar'
    && S.fitContain.fit === 'contain' && S.fitContain.ls === 'ajustar'
    && S.controlsHiddenAgain === true
    && S.ltrNav.next === S.ltrNav.from + 1 && S.ltrNav.back === S.ltrNav.from
    && S.rtlNav.rightZone === S.rtlNav.at - 1 && S.rtlNav.leftZone === S.rtlNav.at
    && S.exitedImmersive.bodyClass === false && S.exitedImmersive.headerDisplay !== 'none'
    && S.wcResults.length > 0
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
