// E2E Ronda 5 (v1.9.0): recorte de márgenes + páginas dobles en horizontal.
// Recorte: cajas dentro de la imagen (fracciones 0–0.40 por lado), área
// efectiva mayor en agregado que sin recorte, identidad al apagarlo.
// Dobles: viewport horizontal → 2 páginas, indicador con rango, avance +2,
// RTL invierte el par, al volver a vertical queda el ancla; capítulo impar
// termina en página sola. Composición recorte+dobles. Regresiones: avance
// paginado instantáneo (v1.8.1) y scroll completo en el capítulo de control.
// Uso: http_proxy/https_proxy apuntando al encadenador local y
// TINTA_PROXYBASE fijado; TINTA_BASE elige transporte (:8788 JSPI, :8789 XHR).
import puppeteer from 'puppeteer-core';

const BASE = process.env.TINTA_BASE || 'http://localhost:8788/';
const EXE = '/home/hatch/workspace/tinta/e2e/chrome-headless-shell/linux-155.0.8059.84/chrome-headless-shell-linux64/chrome-headless-shell';
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

const results = [];
const ok = (name, cond, extra = '') => {
  results.push({ name, pass: !!cond, extra });
  console.log(`${cond ? '✓' : '✗'} ${name}${extra ? ` — ${extra}` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ executablePath: EXE, args: launchArgs, protocolTimeout: 900000 });
const page = await browser.newPage();
await page.setViewport({ width: 420, height: 900 });
if (process.env.TINTA_PROXYBASE) {
  await page.evaluateOnNewDocument((v) => {
    try {
      localStorage.setItem('tinta.proxyBase', v);
      localStorage.setItem('tinta.readerMode', 'paged');
      localStorage.setItem('tinta.trimMargins', 'on');
      localStorage.setItem('tinta.spreads', 'on');
    } catch { /* noop */ }
  }, process.env.TINTA_PROXYBASE);
}
const jsErrors = [];
page.on('pageerror', (e) => jsErrors.push(String(e)));
const txt = (sel) => page.$eval(sel, (el) => el.textContent.trim());
const evClick = (sel) => page.$eval(sel, (el) => el.click());
const indicator = async () => {
  const t = await txt('#page-indicator');
  const m = t.match(/^(\d+)(?:–(\d+))? \/ (\d+)$/);
  return m ? { start: +m[1], end: m[2] ? +m[2] : +m[1], total: +m[3], raw: t } : { raw: t };
};
const waitVisibleRow = (slots, timeout = 60000) => page.waitForFunction((n) => {
  const row = document.querySelector('#pages .paged-stage .page-row:not(.row-wait)');
  if (!row) return false;
  const ss = row.querySelectorAll('.page-slot');
  if (ss.length !== n) return false;
  return [...row.querySelectorAll('img.page-img')].every((im) => im.complete && im.naturalWidth > 0);
}, { timeout }, slots);
const visibleSlots = () => page.evaluate(() => {
  const row = document.querySelector('#pages .paged-stage .page-row:not(.row-wait)');
  if (!row) return [];
  return [...row.querySelectorAll('.page-slot')].map((s) => {
    const r = s.getBoundingClientRect();
    const img = s.querySelector('img.page-img');
    const box = s.querySelector('.trim-box');
    const br = box ? box.getBoundingClientRect() : null;
    const a = img ? img.naturalWidth / img.naturalHeight : 0;
    let uw = r.width; let uh = a ? uw / a : 0;
    if (uh > r.height) { uh = r.height; uw = uh * a; }
    return {
      idx: s.dataset.idx, trim: s.dataset.trim ?? null, x: Math.round(r.x),
      slotRect: [Math.round(r.width), Math.round(r.height)],
      hasBox: !!box,
      boxArea: br ? Math.round(br.width * br.height) : 0,
      untrimmedArea: Math.round(uw * uh),
      imgRect: img ? (() => { const q = img.getBoundingClientRect(); return [Math.round(q.width), Math.round(q.height)]; })() : null,
      untrimmedRect: [Math.round(uw), Math.round(uh)],
    };
  });
});
async function openChapterRowByPrefix(prefix, tries = 14) {
  for (let k = 0; k < tries; k++) {
    const clicked = await page.evaluate((p) => {
      const rows = document.querySelectorAll('#chapters .chapter');
      for (const r of rows) {
        const t = r.querySelector('.ch-main span')?.textContent || '';
        if (t.startsWith(p) && !r.classList.contains('locked')) { r.click(); return true; }
      }
      return false;
    }, prefix);
    if (!clicked) return false;
    try {
      await page.waitForFunction(() => document.querySelectorAll('#pages img').length > 0, { timeout: 20000 });
      return true;
    } catch { /* reintento */ }
  }
  return false;
}
const exitReader = async () => {
  await evClick('#view-reader [data-back-manga]');
  await page.waitForFunction(() => document.querySelectorAll('#chapters .chapter').length > 0, { timeout: 30000 });
};

// ---------- Arranque + MangaDex + Yotsuba Cap. 1 ----------
await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForSelector('#catalog .source-row', { timeout: 60000 });
ok('La app arranca', true, BASE);
const version = await page.evaluate(() => document.body.textContent.includes('v1.9.0'));
ok('Versión de la app: 1.9.0', version);
const transporte = await txt('#net-status');
await page.waitForSelector('button[data-install="multi.mangadex"]', { timeout: 15000 });
await evClick('button[data-install="multi.mangadex"]');
await page.waitForSelector('button[data-open="multi.mangadex"]', { timeout: 240000 });
await evClick('button[data-open="multi.mangadex"]');
await page.waitForSelector('#search-input', { visible: true, timeout: 15000 });
await page.type('#search-input', 'Yotsuba');
await page.keyboard.press('Enter');
await page.waitForFunction(() => document.querySelectorAll('#results .card').length > 0, { timeout: 90000 });
{
  const titles = await page.$$eval('#results .card .t', (els) => els.map((e) => e.textContent.trim()));
  const i = titles.findIndex((t) => t.toLowerCase().startsWith('yotsuba'));
  const cards = await page.$$('#results .card');
  await cards[i].evaluate((el) => el.click());
}
await page.waitForFunction(() => document.querySelectorAll('#chapters .chapter').length > 0, { timeout: 240000 });
ok('Yotsuba abierto en MangaDex', true, `transporte: ${transporte}`);

// ---------- (a) Recorte en vertical, Cap. 1 ----------
ok('Cap. 1 se abre en modo paginado', await openChapterRowByPrefix('Cap. 1 '));
await waitVisibleRow(1, 180000);
await sleep(4000); // precarga + sondas de las vecinas
const muestras = [];
for (let n = 0; n < 5; n++) {
  // Esperar a que el hueco visible sea el de la página n (la fila anterior
  // sigue visible durante el swap: hay que anclar la muestra al índice).
  await page.waitForFunction((idx) => {
    const s = document.querySelector('#pages .paged-stage .page-row:not(.row-wait) .page-slot');
    return s && s.dataset.idx === String(idx) && s.dataset.trim !== undefined;
  }, { timeout: 30000 }, n).catch(() => {});
  const [s] = await visibleSlots();
  muestras.push(s);
  if (n < 4) {
    await evClick('#pages .paged-stage .zone.next');
    await page.waitForFunction((idx) => {
      const s = document.querySelector('#pages .paged-stage .page-row:not(.row-wait) .page-slot');
      return s && s.dataset.idx === String(idx);
    }, { timeout: 60000 }, n + 1);
  }
}
console.log('  muestras de recorte:', JSON.stringify(muestras.map((m) => m.trim)));
ok('(a) Detección concluyente en las 5 páginas muestreadas',
  muestras.every((m) => m && m.trim !== null && m.trim !== 'null'),
  muestras.map((m) => m?.trim).join(' | '));
const fracs = muestras.flatMap((m) => (m.trim ? m.trim.split(',').map(Number) : []));
ok('(a) Todas las fracciones dentro de [0, 0.40]',
  fracs.length === 20 && fracs.every((f) => f >= 0 && f <= 0.40),
  `máx ${Math.max(...fracs).toFixed(3)}`);
const conCaja = muestras.filter((m) => m.hasBox);
ok('(a) Al menos 3 de 5 páginas con caja de recorte aplicada',
  conCaja.length >= 3,
  `${conCaja.length}/5 con caja`);
const sumBox = conCaja.reduce((a, m) => a + m.boxArea, 0);
const sumUnt = conCaja.reduce((a, m) => a + m.untrimmedArea, 0);
ok('(a) Área visible efectiva mayor con recorte (agregado de páginas con caja)',
  sumBox > sumUnt, `${sumBox} vs ${sumUnt} px² (+${(((sumBox / sumUnt) - 1) * 100).toFixed(1)}%)`);

// Apagar con el interruptor del lector: la vista vuelve a la identidad.
await evClick('#btn-rc-trim');
await page.waitForFunction(() => {
  const row = document.querySelector('#pages .paged-stage .page-row:not(.row-wait)');
  return row && !row.querySelector('.trim-box')
    && localStorage.getItem('tinta.trimMargins') === 'off';
}, { timeout: 30000 });
{
  const [s] = await visibleSlots();
  // Identidad: sin .trim-box (ya esperado arriba) y el <img> ocupa su
  // hueco tal cual (el contain lo hace object-fit dentro del elemento).
  const dw = Math.abs(s.imgRect[0] - s.slotRect[0]);
  const dh = Math.abs(s.imgRect[1] - s.slotRect[1]);
  ok('(a) Sin recorte la vista es la identidad (img = hueco, sin caja)', dw <= 3 && dh <= 3,
    `img ${s.imgRect} vs hueco ${s.slotRect}`);
}
// Encender de nuevo: la caja vuelve (cacheada: en el acto).
await evClick('#btn-rc-trim');
await page.waitForFunction(() => {
  const row = document.querySelector('#pages .paged-stage .page-row:not(.row-wait)');
  return row && localStorage.getItem('tinta.trimMargins') === 'on';
}, { timeout: 30000 });
await waitVisibleRow(1);

// ---------- (b) Páginas dobles en horizontal (+ (c) composición) ----------
await page.setViewport({ width: 900, height: 420 });
await waitVisibleRow(2, 60000);
await sleep(1500);
{
  const slots = await visibleSlots();
  const ind = await indicator();
  ok('(b) En horizontal se muestran 2 páginas lado a lado', slots.length === 2,
    `huecos: ${slots.map((s) => s.idx).join(',')}`);
  ok('(b) El indicador marca el rango del par', ind.end === ind.start + 1, ind.raw);
  ok('(c) Composición: ambas páginas del par llevan su recorte aplicado',
    slots.every((s) => s.trim !== null && s.trim !== 'null'),
    slots.map((s) => `${s.hasBox ? 'caja' : 'sin caja'} ${s.trim}`).join(' | '));
  var anclaPar = ind.start; // página (1-based) ancla del par actual
}
{
  const before = (await indicator()).start;
  await evClick('#pages .paged-stage .zone.next');
  await page.waitForFunction((b) => {
    const el = document.querySelector('#page-indicator');
    return el && el.textContent.includes('–') && !el.textContent.startsWith(`${b}–`);
  }, { timeout: 60000 }, before);
  await waitVisibleRow(2);
  const ind = await indicator();
  ok('(b) Un avance mueve el ancla +2', ind.start === before + 2, `${before} → ${ind.start} (${ind.raw})`);
  anclaPar = ind.start;
}
// RTL: la primera del par se lee a la derecha. Se espera la INVERSIÓN
// misma (la fila anterior sigue visible durante el re-pintado).
await page.evaluate(() => {
  localStorage.setItem('tinta.pageDir', 'rtl');
  window.dispatchEvent(new Event('resize'));
});
await page.waitForFunction((anchorIdx) => {
  const row = document.querySelector('#pages .paged-stage .page-row:not(.row-wait)');
  if (!row) return false;
  const ss = [...row.querySelectorAll('.page-slot')];
  if (ss.length !== 2) return false;
  const byX = ss.slice().sort((a, b) => a.getBoundingClientRect().x - b.getBoundingClientRect().x);
  return Number(byX[1].dataset.idx) === anchorIdx;
}, { timeout: 30000 }, anclaPar - 1).catch(() => {});
{
  const slots = await visibleSlots();
  const derecha = slots.reduce((a, b) => (a.x > b.x ? a : b));
  const izquierda = slots.reduce((a, b) => (a.x < b.x ? a : b));
  ok('(b) En RTL el ancla del par queda a la derecha',
    Number(derecha.idx) === anclaPar - 1 && Number(izquierda.idx) === anclaPar,
    `izq idx ${izquierda.idx}, der idx ${derecha.idx}, ancla pág. ${anclaPar}`);
}
await page.evaluate(() => {
  localStorage.setItem('tinta.pageDir', 'ltr');
  window.dispatchEvent(new Event('resize'));
});
await waitVisibleRow(2);
// Volver a vertical: página sencilla anclada en la primera del par.
await page.setViewport({ width: 420, height: 900 });
await waitVisibleRow(1, 60000);
{
  const ind = await indicator();
  const [s] = await visibleSlots();
  ok('(b) Al volver a vertical: 1 página, anclada en la primera del par',
    ind.end === ind.start && ind.start === anclaPar && Number(s.idx) === anclaPar - 1,
    ind.raw);
}

// ---------- (d1) Regresión: avance paginado instantáneo ----------
await sleep(4000); // precarga de vecinas
{
  let allInstant = true;
  const detalle = [];
  for (let k = 0; k < 3; k++) {
    const snap = await page.evaluate(() => {
      document.querySelector('#pages .paged-stage .zone.next')?.click();
      const row = document.querySelector('#pages .paged-stage .page-row:not(.row-wait)');
      const imgs = row ? [...row.querySelectorAll('img.page-img')] : [];
      return {
        waiting: !row,
        complete: imgs.length > 0 && imgs.every((im) => im.complete && im.naturalWidth > 0),
      };
    });
    detalle.push(JSON.stringify(snap));
    if (snap.waiting || !snap.complete) allInstant = false;
    await sleep(800);
  }
  ok('(d) Avance paginado instantáneo con precarga (3 toques, sin glifo)', allInstant, detalle.join(' '));
}

// ---------- (b2) Capítulo con total impar termina en página sola ----------
await exitReader();
let impar = null;
{
  const labels = await page.$$eval('#chapters .chapter .ch-main span',
    (els) => els.map((e) => e.textContent.trim()));
  const candidatos = [...new Set(labels.filter((t) => /^Cap\. \d+ /.test(t) && !t.startsWith('Cap. 1 ')))].slice(0, 8);
  for (const lab of candidatos) {
    const prefix = lab.match(/^Cap\. \d+ /)[0];
    if (!(await openChapterRowByPrefix(prefix, 4))) continue;
    await waitVisibleRow(1, 120000).catch(() => {});
    const ind = await indicator();
    if (ind.total && ind.total % 2 === 1) { impar = { prefix, total: ind.total }; await exitReader(); break; }
    await exitReader();
  }
}
ok('(b) Se localizó un capítulo con total impar', !!impar, impar ? `${impar.prefix}… total ${impar.total}` : 'ninguno en la página de lista');
if (impar) {
  await openChapterRowByPrefix(impar.prefix, 6);
  await waitVisibleRow(1, 120000);
  await page.setViewport({ width: 900, height: 420 });
  await waitVisibleRow(2, 60000).catch(() => waitVisibleRow(1, 30000));
  let pasos = 0;
  for (;;) {
    const ind = await indicator();
    if (!ind.total || ind.end >= ind.total || pasos >= 40) break;
    const before = ind.start;
    await evClick('#pages .paged-stage .zone.next');
    await page.waitForFunction((b) => {
      const el = document.querySelector('#page-indicator');
      return el && !el.textContent.startsWith(`${b}–`) && !el.textContent.startsWith(`${b} /`);
    }, { timeout: 60000 }, before);
    pasos++;
  }
  const indF = await indicator();
  await waitVisibleRow(1, 30000).catch(() => {}); // esperar el swap final
  const slotsF = await visibleSlots();
  ok('(b) El capítulo impar termina en página sola', indF.end === indF.total && slotsF.length === 1,
    `${indF.raw} tras ${pasos} avances, huecos: ${slotsF.length}`);
  await page.setViewport({ width: 420, height: 900 });
  await waitVisibleRow(1, 60000);
  await exitReader();
}

// ---------- (d2) Regresión: scroll carga el capítulo de control completo ----------
await page.evaluate(() => localStorage.setItem('tinta.readerMode', 'scroll'));
await page.$eval('#goto-input', (el) => { el.value = '114'; });
await evClick('#goto-form button[type="submit"]');
await page.waitForFunction(() => {
  const rows = document.querySelectorAll('#chapters .chapter');
  return [...rows].some((r) => (r.querySelector('.ch-main span')?.textContent || '').startsWith('Cap. 114'));
}, { timeout: 30000 });
ok('(d) «Ir al cap. 114» localiza el capítulo de control', await openChapterRowByPrefix('Cap. 114', 10));
await page.waitForFunction(() => document.querySelectorAll('#pages img').length > 0, { timeout: 120000 });
{
  let last = -1; let stable = 0;
  for (let k = 0; k < 110 && stable < 5; k++) {
    const n = await page.evaluate(() => {
      window.scrollBy(0, Math.round(window.innerHeight * 0.9));
      return [...document.querySelectorAll('#pages img')]
        .filter((i) => i.complete && i.naturalWidth > 0).length;
    });
    if (n === last) stable++; else { stable = 0; last = n; }
    await sleep(1500);
  }
  const tot = await page.$$eval('#pages img', (els) => els.length);
  ok('(d) Scroll: el capítulo de control carga completo', last === tot && tot > 0, `${last}/${tot} imágenes`);
}

ok('Sin errores JS (pageerror) en toda la sesión', jsErrors.length === 0,
  jsErrors.slice(0, 3).join(' | '));

const passed = results.filter((r) => r.pass).length;
console.log(`\nRESULTADO_JSON ${JSON.stringify({ base: BASE, transporte, passed, total: results.length, results })}`);
await browser.close();
process.exit(passed === results.length ? 0 : 1);
