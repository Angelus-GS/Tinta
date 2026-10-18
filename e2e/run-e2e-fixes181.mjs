// E2E v1.8.1 — correcciones de los dos defectos reportados en el iPhone +
// etiqueta de fuente en la ficha. Transporte según TINTA_BASE
// (:8788 JSPI · :8789 respaldo XHR síncrono).
//  1) Lector paginado: precarga de páginas vecinas y pintar solo al `load`
//     (nada del glifo de imagen al centro en cada avance).
//  2) Descargas: botón deshabilitado en capítulos bloqueados de MangaDex y
//     error por página con página · host · razón (reintento proxy→directo→proxy).
//  3) Regresión: descargas MangaDex + Weeb Central (Spy x Family cap. 70 en
//     lowee.us y cap. 141 en planeptune.us) completas y lectura sin red.
//  4) La ficha muestra «Fuente: X» correcta para un manga de cada fuente.
import puppeteer from 'puppeteer-core';

const BASE = process.env.TINTA_BASE || 'http://localhost:8788/';
const EXE = '/home/hatch/workspace/tinta/e2e/chrome-headless-shell/linux-155.0.8059.84/chrome-headless-shell-linux64/chrome-headless-shell';
const log = (...a) => console.log(...a);
const out = { base: BASE, steps: {}, consoleErrors: [] };
const S = out.steps;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

async function rowByLabel(prefix) {
  const rows = await page.$$('#chapters .chapter');
  for (const r of rows) {
    const t = await r.evaluate((el) => el.querySelector('.ch-main span')?.textContent || '');
    if (t.startsWith(prefix)) return r;
  }
  return null;
}
// Fila por número exacto de capítulo («Cap. 70» no debe casar con «Cap. 70.5»).
async function rowByNumber(numStr) {
  const rows = await page.$$('#chapters .chapter');
  for (const r of rows) {
    const t = await r.evaluate((el) => el.querySelector('.ch-main span')?.textContent || '');
    const m = /^Cap\. ([\d.]+)/.exec(t.trim());
    if (m && m[1] === numStr) return r;
  }
  return null;
}
async function openChapterRow(prefix, timeout = 300000) {
  const deadline = Date.now() + timeout;
  let lastErr = null;
  while (Date.now() < deadline) {
    const row = await rowByLabel(prefix);
    if (!row) throw new Error(`Fila no encontrada: ${prefix}`);
    try {
      await row.click();
    } catch (e) {
      await row.evaluate((el) => el.click()).catch(() => { throw e; });
    }
    try {
      await page.waitForFunction(() => document.querySelectorAll('#pages img').length > 0,
        { timeout: Math.min(90000, Math.max(10000, deadline - Date.now())) });
      return;
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error(`El lector no abrió para ${prefix}`);
}
async function searchInSource(query, timeout = 180000) {
  await page.evaluate(() => { document.querySelector('#search-input').value = ''; });
  await page.type('#search-input', query);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelectorAll('#results .card').length > 0, { timeout });
}
async function openFirstResultMatching(substr, timeout = 300000) {
  const titles = await page.$$eval('#results .card .t', (els) => els.map((e) => e.textContent.trim()));
  let idx = titles.findIndex((t) => t.toLowerCase().startsWith(substr.toLowerCase()));
  if (idx < 0) idx = titles.findIndex((t) => t.toLowerCase().includes(substr.toLowerCase()));
  if (idx < 0) throw new Error(`Sin resultado que contenga "${substr}": ${JSON.stringify(titles)}`);
  const cards = await page.$$('#results .card');
  await cards[idx].click();
  await page.waitForFunction(() => document.querySelectorAll('#chapters .chapter').length > 0, { timeout });
}
async function gotoNumber(n, expectLabel, timeout = 180000) {
  await page.evaluate(() => { document.querySelector('#goto-input').value = ''; });
  await page.type('#goto-input', String(n));
  await page.$eval('#goto-form', (f) => f.requestSubmit());
  await page.waitForFunction(
    (exp) => [...document.querySelectorAll('#chapters .chapter .ch-main span')]
      .some((el) => el.textContent.trim().startsWith(exp)),
    { timeout }, expectLabel,
  );
}
async function waitDownloadDone(getRow, timeout = 480000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const row = await getRow();
    if (row) {
      const done = await row.evaluate((el) => el.querySelector('.dl-btn')?.classList.contains('done'));
      if (done) return true;
    }
    await sleep(3000);
  }
  return false;
}
const detailSource = () => page.evaluate(() => {
  const p = [...document.querySelectorAll('#manga-detail .info p')]
    .find((el) => el.textContent.trim().startsWith('Fuente:'));
  return p ? p.textContent.trim() : null;
});

try {
  // --- Arranque e instalación de fuentes ---
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('#catalog .source-row', { timeout: 60000 });
  S.transport = await txt('#net-status');
  S.version = await txt('#app-version');
  log('transporte:', S.transport, '| versión:', S.version);
  await page.waitForSelector('button[data-install="multi.mangadex"]', { timeout: 15000 });
  await page.click('button[data-install="multi.mangadex"]');
  await page.waitForSelector('button[data-open="multi.mangadex"]', { timeout: 120000 });
  await page.click('button[data-install="en.weebcentral"]');
  await page.waitForSelector('button[data-open="en.weebcentral"]', { timeout: 120000 });
  log('fuentes instaladas ✓');

  // --- A) MangaDex · Yotsuba: la ficha dice su fuente ---
  await page.click('button[data-open="multi.mangadex"]');
  await page.waitForSelector('#search-input', { visible: true, timeout: 15000 });
  await searchInSource('Yotsuba');
  await openFirstResultMatching('yotsuba');
  S.mdSource = await detailSource();
  log('ficha MangaDex:', S.mdSource);

  // --- B) Defecto 1: lector paginado sin glifo (precarga + pintar al load) ---
  const errMark = out.consoleErrors.length;
  await page.evaluate(() => localStorage.setItem('tinta.readerMode', 'paged'));
  await openChapterRow('Cap. 1');
  await page.waitForFunction(() => {
    const img = document.querySelector('#pages .paged-stage img.page-img');
    return img && img.complete && img.naturalWidth > 0 && !img.classList.contains('pg-wait');
  }, { timeout: 180000 });
  S.pagedStart = await txt('#page-indicator');
  await sleep(8000); // que la precarga (3 siguientes) aterrice en caché
  S.pagedAdvances = [];
  for (let k = 0; k < 3; k++) {
    const sample = await page.evaluate(() => {
      document.querySelector('#pages .paged-stage .zone.next').click();
      const img = document.querySelector('#pages .paged-stage img.page-img');
      return {
        complete: !!img?.complete, nw: img?.naturalWidth || 0,
        wait: !!img?.classList.contains('pg-wait'),
        ind: document.querySelector('#page-indicator')?.textContent.trim(),
      };
    });
    S.pagedAdvances.push(sample);
    log(`avance ${k + 1}:`, JSON.stringify(sample));
    await sleep(400);
  }
  S.pagedLoadingHidden = await page.$eval('#pages .paged-stage .page-loading', (el) => el.hidden);
  S.consoleErrInPaged = out.consoleErrors.slice(errMark);
  // Salir del lector inmersivo y volver a scroll para el resto de la suite
  await clickEl('.zone.center');
  await clickEl('#reader-controls [data-back-manga]');
  await page.waitForFunction(() => !document.querySelector('#view-manga').hidden, { timeout: 30000 });
  await page.evaluate(() => localStorage.setItem('tinta.readerMode', 'scroll'));

  // --- C) Regresión: descarga MangaDex (Cap. 1 de Yotsuba) ---
  {
    const row = await rowByNumber('1');
    if (!row) throw new Error('Sin fila Cap. 1 para descargar');
    await row.$eval('.dl-btn', (el) => el.click());
    S.mdDlCap1 = await waitDownloadDone(() => rowByNumber('1'));
    log('descarga MangaDex Cap. 1:', S.mdDlCap1);
  }

  // --- D) Defecto 2b: error de descarga con página · host · razón ---
  let blockImgs = false;
  const mdReqLog = [];
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const u = req.url();
    if (blockImgs && u.includes('mangadex')) mdReqLog.push(u.slice(0, 110));
    if (blockImgs && (u.includes('mangadex.network') || u.includes('uploads.mangadex.org'))) {
      // Con ACAO *: si no, fetch lo trata como fallo de red (CORS) y no como
      // el HTTP 403 que el proxy real sí devuelve con su CORS abierto.
      req.respond({ status: 403, contentType: 'text/plain', headers: { 'Access-Control-Allow-Origin': '*' }, body: 'bloqueado por la prueba' }).catch(() => {});
    } else {
      req.continue().catch(() => {});
    }
  });
  blockImgs = true;
  {
    const row = await rowByNumber('2');
    if (!row) throw new Error('Sin fila Cap. 2 para la prueba de error');
    await row.$eval('.dl-btn', (el) => el.click());
    // Espera con doble señal y registro: el toast de error vive 7 s, así que
    // se muestrea el estado cada 2 s hasta ver el toast o el botón asentado.
    const deadline = Date.now() + 420000;
    let toastSeen = '';
    let btnState = null;
    while (Date.now() < deadline) {
      const sample = await page.evaluate(() => {
        const t = document.querySelector('#toast');
        const toastTxt = t && !t.hidden ? t.textContent : '';
        const rows = [...document.querySelectorAll('#chapters .chapter')];
        const r2 = rows.find((r) => /^Cap\. 2(?![\d.])/.test(r.querySelector('.ch-main span')?.textContent.trim() || ''));
        const b = r2?.querySelector('.dl-btn');
        return { toastTxt, btn: b ? { txt: b.textContent, done: b.classList.contains('done'), disabled: b.disabled } : null };
      });
      if (sample.toastTxt) toastSeen = sample.toastTxt;
      btnState = sample.btn;
      if (toastSeen.includes('Descarga fallida')) break;
      if (btnState && btnState.done) break;
      await sleep(2000);
    }
    S.errToast = toastSeen;
    S.errBtnState = btnState;
    S.errReqLog = mdReqLog.slice(0, 12);
    blockImgs = false;
    const st = await (await rowByNumber('2')).evaluate((el) => {
      const b = el.querySelector('.dl-btn');
      return { done: b.classList.contains('done'), disabled: b.disabled, rowDl: el.classList.contains('downloaded') };
    });
    S.errCleanup = st;
    log('toast de error:', S.errToast, '| botón:', JSON.stringify(btnState), '| limpieza:', JSON.stringify(st));
    log('peticiones MD durante el error:', JSON.stringify(S.errReqLog));
  }
  await page.setRequestInterception(false);

  // --- E) Defecto 2a: capítulo bloqueado de MangaDex, botón deshabilitado ---
  await clickEl('#brand');
  await page.click('button[data-open="multi.mangadex"]');
  await page.waitForSelector('#search-input', { visible: true, timeout: 15000 });
  await searchInSource('One Piece');
  await openFirstResultMatching('one piece', 420000);
  S.lockedInfo = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#chapters .chapter')];
    const locked = rows.filter((r) => r.classList.contains('locked'));
    const first = locked[0];
    const btn = first?.querySelector('.dl-btn');
    return {
      total: rows.length, locked: locked.length,
      btnExists: !!btn, btnDisabled: btn ? btn.disabled : null,
      btnTitle: btn ? btn.title : null,
    };
  });
  log('bloqueados One Piece MD:', JSON.stringify(S.lockedInfo));

  // --- F) Weeb Central · Spy x Family: fuente, descargas y lectura sin red ---
  await clickEl('#brand');
  await page.click('button[data-open="en.weebcentral"]');
  await page.waitForSelector('#search-input', { visible: true, timeout: 15000 });
  await searchInSource('Spy x Family');
  await openFirstResultMatching('spy x family');
  S.wcSource = await detailSource();
  log('ficha Weeb Central:', S.wcSource);
  await gotoNumber(70, 'Cap. 70');
  {
    const row = await rowByNumber('70');
    if (!row) throw new Error('Sin fila Cap. 70 de Spy x Family');
    await row.$eval('.dl-btn', (el) => el.click());
    S.wcDl70 = await waitDownloadDone(() => rowByNumber('70'));
    log('descarga Spy cap. 70 (lowee):', S.wcDl70);
  }
  await gotoNumber(141, 'Cap. 141');
  {
    const row = await rowByNumber('141');
    if (!row) throw new Error('Sin fila Cap. 141 de Spy x Family');
    await row.$eval('.dl-btn', (el) => el.click());
    S.wcDl141 = await waitDownloadDone(() => rowByNumber('141'));
    log('descarga Spy cap. 141 (planeptune):', S.wcDl141);
  }
  // Lectura sin red del cap. 70 descargado
  await gotoNumber(70, 'Cap. 70');
  await page.setOfflineMode(true);
  try {
    const row = await rowByNumber('70');
    await row.evaluate((el) => el.click());
    await page.waitForFunction(() => document.querySelectorAll('#pages img').length > 0, { timeout: 60000 });
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
      { timeout: 120000 },
    );
    S.wcOffline = await page.$$eval('#pages img', (els) => ({
      total: els.length, loaded: els.filter((i) => i.naturalWidth > 0).length,
    }));
  } finally {
    await page.setOfflineMode(false);
  }
  log('lectura sin red Spy cap. 70:', JSON.stringify(S.wcOffline));
  await page.$eval('#view-reader > [data-back-manga]', (el) => el.click());
  await page.waitForFunction(() => !document.querySelector('#view-manga').hidden, { timeout: 30000 });

  const advOk = Array.isArray(S.pagedAdvances) && S.pagedAdvances.length === 3
    && S.pagedAdvances.every((a) => a.complete && a.nw > 0 && !a.wait);
  const toastOk = !!S.errToast && S.errToast.includes('página 1') && S.errToast.includes('HTTP 403')
    && /(mangadex\.network|uploads\.mangadex\.org)/.test(S.errToast);
  out.success = !!(
    S.version === 'v1.8.1'
    && S.mdSource === 'Fuente: MangaDex'
    && advOk && S.pagedLoadingHidden === true
    // Solo los errores JS cuentan como fallo: la red de MangaDex a veces
    // responde 404 transitorios en páginas sueltas y la app se recupera
    // (reintento directo); quedan registrados en consoleErrInPaged.
    && (S.consoleErrInPaged || []).filter((e) => e.startsWith('pageerror')).length === 0
    && S.mdDlCap1 === true
    && toastOk
    && S.errCleanup && S.errCleanup.done === false && S.errCleanup.disabled === false && S.errCleanup.rowDl === false
    && S.lockedInfo && S.lockedInfo.locked > 0 && S.lockedInfo.btnExists === true
    && S.lockedInfo.btnDisabled === true && (S.lockedInfo.btnTitle || '').includes('No disponible en esta fuente')
    && S.wcSource === 'Fuente: Weeb Central'
    && S.wcDl70 === true && S.wcDl141 === true
    && S.wcOffline && S.wcOffline.total >= 10 && S.wcOffline.loaded === S.wcOffline.total
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
