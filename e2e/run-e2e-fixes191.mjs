// E2E v1.9.1 — hotfix del error «Invalid argument type in ToBigInt
// operation» (JavaScriptCore) / «Cannot convert undefined to a BigInt» (V8)
// al abrir desde el riel «Seguir leyendo» una serie con avance guardado
// pero SIN registro en biblioteca: openManga recibía el stub mínimo
// {key,title,cover} y encManga estallaba. Transporte según TINTA_BASE
// (:8788 JSPI · :8789 respaldo XHR síncrono).
//  A) Escenario del bug (diag-rail convertido en aserciones): Weeb Central
//     «Dandadan» solo-con-avance desde el riel → detalle CON capítulos,
//     sin «BigInt», y el flujo continúa al capítulo guardado en el lector.
//     Confirma además que Weeb Central acepta el update con el stub
//     completado por completeMangaInput().
//  B) Regresión: búsqueda global de MangaDex «Yotsuba&!» abre detalle y
//     capítulos, y la ruta biblioteca/snapshot sigue intacta.
//  C) Confirmación MangaDex: Yotsuba&! solo-con-avance desde el riel
//     (stub completado) carga detalle, capítulos y lector.
import puppeteer from 'puppeteer-core';
import { lookup } from 'node:dns/promises';

const BASE = process.env.TINTA_BASE || 'http://localhost:8788/';
const EXE = '/home/hatch/workspace/tinta/e2e/chrome-headless-shell/linux-155.0.8059.84/chrome-headless-shell-linux64/chrome-headless-shell';
const log = (...a) => console.log(...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const proxyEnv = process.env.https_proxy || process.env.http_proxy || '';
let proxy = '';
if (proxyEnv) {
  const u = new URL(proxyEnv);
  const { address, family } = await lookup(u.hostname);
  proxy = `${u.protocol}//${family === 6 ? `[${address}]` : address}:${u.port}`;
}
const launchArgs = ['--no-sandbox', '--disable-dev-shm-usage', '--ignore-certificate-errors'];
if (proxy) launchArgs.push(`--proxy-server=${proxy}`, '--proxy-bypass-list=localhost;127.0.0.1');

const browser = await puppeteer.launch({ executablePath: EXE, args: launchArgs, protocolTimeout: 600000 });
const checks = [];
const pageErrors = [];
function check(name, cond, detail = '') {
  checks.push({ name, pass: !!cond, detail });
  log(`  ${cond ? '✔' : '✘'} ${name}${detail ? ' — ' + detail : ''}`);
}

async function newPage() {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 420, height: 900 });
  await page.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36');
  if (process.env.TINTA_PROXYBASE) {
    await page.evaluateOnNewDocument((v) => {
      try { localStorage.setItem('tinta.proxyBase', v); } catch { /* sin acceso */ }
    }, process.env.TINTA_PROXYBASE);
  }
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 200)));
  return page;
}

async function installSource(page, id) {
  await page.goto(BASE, { waitUntil: 'load', timeout: 60000 });
  await page.waitForSelector(`button[data-install="${id}"]`, { timeout: 60000 });
  await page.click(`button[data-install="${id}"]`);
  await page.waitForSelector(`button[data-open="${id}"]`, { timeout: 240000 });
}

// Busca en el buscador global y abre la tarjeta `title` (coincidencia
// insensible a mayúsculas; `exact` exige igualdad) del grupo cuya
// cabecera menciona `groupName`. Devuelve el nº de filas de capítulos.
async function globalSearchOpen(page, query, { groupName, title, exact = true }) {
  await page.waitForSelector('#global-search-input', { timeout: 30000 });
  await page.type('#global-search-input', query);
  await page.$eval('#global-search-form', (f) => f.requestSubmit());
  await page.waitForFunction(() => {
    const h = [...document.querySelectorAll('#global-results .global-head')];
    return h.length >= 1 && h.every((x) => !x.textContent.includes('Buscando en'));
  }, { timeout: 300000 });
  const clicked = await page.evaluate(({ groupName, title, exact }) => {
    const want = title.toLowerCase();
    for (const g of document.querySelectorAll('#global-results .global-group')) {
      const head = g.querySelector('.global-head')?.textContent || '';
      if (groupName && !head.toLowerCase().includes(groupName.toLowerCase())) continue;
      for (const c of g.querySelectorAll('.card')) {
        const t = (c.querySelector('.t')?.textContent.trim() || '').toLowerCase();
        if (exact ? t === want : t.startsWith(want)) { c.click(); return true; }
      }
    }
    return false;
  }, { groupName, title, exact });
  if (!clicked) throw new Error(`Tarjeta global no encontrada: ${title} (${groupName})`);
  await page.waitForFunction(() => document.querySelectorAll('#chapters .chapter').length > 0, { timeout: 300000 });
  return page.$$eval('#chapters .chapter', (els) => els.length);
}

async function openFirstChapter(page) {
  await page.evaluate(() => {
    const row = document.querySelector('#chapters .chapter:not(.locked)') || document.querySelector('#chapters .chapter');
    row?.click();
  });
  await page.waitForFunction(() => document.querySelectorAll('#pages img').length > 0, { timeout: 300000 });
  const imgs = await page.$$eval('#pages img', (els) => els.length);
  await sleep(5000); // que el avance se guarde
  return imgs;
}

async function reloadAndOpenFromRail(page, title) {
  await page.reload({ waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction((t) => {
    const rail = document.querySelector('#continue-rail');
    return rail && rail.textContent.toLowerCase().includes(t.toLowerCase());
  }, { timeout: 120000 }, title);
  await page.evaluate((t) => {
    const rail = document.querySelector('#continue-rail');
    const cards = [...rail.querySelectorAll('.cont-card')];
    const card = cards.find((el) => (el.querySelector('.t')?.textContent.trim() || '').toLowerCase() === t.toLowerCase())
      || cards[0];
    (card || rail).click();
  }, title);
  // El flujo del riel: openManga (detalle + capítulos) y luego openChapter
  // con el capítulo guardado → el lector termina visible con páginas.
  await page.waitForFunction(() => document.querySelectorAll('#pages img').length > 0, { timeout: 300000 })
    .catch(() => {});
  await sleep(3000);
  return {
    detail: await page.$eval('#manga-detail', (el) => el.textContent.trim()).catch(() => ''),
    rows: await page.$$eval('#chapters .chapter', (els) => els.length).catch(() => -1),
    readerImgs: await page.$$eval('#pages img', (els) => els.length).catch(() => 0),
  };
}

const out = { base: BASE, parts: {} };
try {
  // ---------- A) El bug: Weeb Central «Dandadan» desde el riel ----------
  log('A) Weeb Central · Dandadan solo-con-avance desde el riel');
  {
    const page = await newPage();
    await installSource(page, 'en.weebcentral');
    const rows0 = await globalSearchOpen(page, 'Dandadan', { groupName: 'Weeb Central', title: 'Dandadan' });
    out.parts.A = { rowsFromSearch: rows0 };
    log(`   detalle desde búsqueda global: ${rows0} filas`);
    const imgs = await openFirstChapter(page);
    log(`   capítulo abierto en el lector: ${imgs} páginas en el DOM`);
    const r = await reloadAndOpenFromRail(page, 'Dandadan');
    out.parts.A.rail = { rows: r.rows, readerImgs: r.readerImgs, detailHead: r.detail.slice(0, 120) };
    check('A1 · el detalle NO muestra «BigInt» tras abrir desde el riel', !/bigint/i.test(r.detail), r.detail.slice(0, 80));
    check('A2 · el detalle carga capítulos desde el riel (filas > 0)', r.rows > 0, `${r.rows} filas`);
    check('A3 · el flujo del riel reabre el capítulo guardado en el lector', r.readerImgs > 0, `${r.readerImgs} imágenes`);
    await page.close();
  }

  // ---------- B) Regresión: global MangaDex + biblioteca/snapshot -------
  log('B) MangaDex · búsqueda global «Yotsuba&!» + ruta biblioteca/snapshot');
  {
    const page = await newPage();
    await installSource(page, 'multi.mangadex');
    const rows = await globalSearchOpen(page, 'Yotsuba&!', { groupName: 'MangaDex', title: 'Yotsuba&!', exact: false });
    out.parts.B = { rowsFromGlobal: rows };
    check('B1 · detalle desde búsqueda global carga capítulos', rows > 0, `${rows} filas`);
    await page.click('#btn-lib');
    await page.waitForFunction(() => document.querySelector('#btn-lib')?.textContent.includes('En tu biblioteca'), { timeout: 60000 });
    await page.click('#brand');
    await page.waitForFunction(() => [...document.querySelectorAll('#library .lib-card .t')]
      .some((el) => el.textContent.toLowerCase().includes('yotsuba')), { timeout: 60000 });
    await page.evaluate(() => {
      const card = [...document.querySelectorAll('#library .lib-card')]
        .find((el) => (el.querySelector('.t')?.textContent || '').toLowerCase().includes('yotsuba'));
      card?.click();
    });
    await page.waitForFunction(() => document.querySelectorAll('#chapters .chapter').length > 0, { timeout: 300000 });
    const rows2 = await page.$$eval('#chapters .chapter', (els) => els.length);
    const detail2 = await page.$eval('#manga-detail', (el) => el.textContent.trim()).catch(() => '');
    out.parts.B.rowsFromLibrary = rows2;
    check('B2 · la ruta biblioteca/snapshot sigue intacta', rows2 > 0 && !/bigint/i.test(detail2), `${rows2} filas`);
    await page.close();
  }

  // ---------- C) MangaDex acepta el stub completado (riel, sin biblio) --
  log('C) MangaDex · Yotsuba&! solo-con-avance desde el riel');
  {
    const page = await newPage();
    await installSource(page, 'multi.mangadex');
    await page.click('button[data-open="multi.mangadex"]');
    await page.waitForSelector('#search-input', { visible: true, timeout: 30000 });
    await page.type('#search-input', 'Yotsuba');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelectorAll('#results .card').length > 0, { timeout: 120000 });
    await page.evaluate(() => {
      const card = [...document.querySelectorAll('#results .card')]
        .find((c) => (c.querySelector('.t')?.textContent.trim() || '').toLowerCase().startsWith('yotsuba'));
      card?.click();
    });
    await page.waitForFunction(() => document.querySelectorAll('#chapters .chapter').length > 0, { timeout: 300000 });
    // El título real del detalle (la fuente puede llamarlo «Yotsuba to!»):
    // es el que el registro de avance guarda y el riel muestra.
    const titleC = await page.$eval('#manga-detail h2', (el) => el.textContent.trim());
    log(`   detalle abierto: «${titleC}»`);
    const imgs = await openFirstChapter(page);
    log(`   capítulo abierto en el lector: ${imgs} páginas en el DOM`);
    const r = await reloadAndOpenFromRail(page, titleC);
    out.parts.C = { rows: r.rows, readerImgs: r.readerImgs };
    check('C1 · el detalle NO muestra «BigInt» (MangaDex, stub completado)', !/bigint/i.test(r.detail), r.detail.slice(0, 80));
    check('C2 · el detalle carga capítulos desde el riel (filas > 0)', r.rows > 0, `${r.rows} filas`);
    check('C3 · el flujo del riel reabre el capítulo guardado en el lector', r.readerImgs > 0, `${r.readerImgs} imágenes`);
    await page.close();
  }
} catch (err) {
  out.error = String(err && err.message || err).slice(0, 500);
  log('ERROR:', out.error);
}

check('D · cero pageerrors en toda la sesión', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
out.checks = checks;
out.pageErrors = pageErrors;
out.success = checks.length > 0 && checks.every((c) => c.pass) && !out.error;
console.log('RESULTADO_JSON ' + JSON.stringify(out, null, 1));
await browser.close();
process.exit(out.success ? 0 : 1);
