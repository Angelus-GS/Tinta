// E2E Ronda 4 (v1.8.0): búsqueda global, aviso de capítulos nuevos,
// «Seguir leyendo» global, ir al capítulo N, descarga por rango + lectura
// offline, exportar CBZ, tema del lector y respaldo. Regresiones breves:
// ronda 3 (orden/paginación), favoritos y lector MangaDex completo.
// Transporte según TINTA_BASE (:8788 JSPI · :8789 respaldo XHR síncrono).
import puppeteer from 'puppeteer-core';
import { writeFileSync } from 'node:fs';

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
const firstVolHeader = () => page.$eval('#chapters .vol-header', (el) => el.textContent.trim()).catch(() => null);
const pagerInfo = () => page.$eval('#chapters-pager-top .pager-info', (el) => el.textContent.trim()).catch(() => null);

async function rowByLabel(prefix) {
  const rows = await page.$$('#chapters .chapter');
  for (const r of rows) {
    const t = await r.evaluate((el) => el.querySelector('.ch-main span')?.textContent || '');
    if (t.startsWith(prefix)) return r;
  }
  return null;
}
async function openChapterRow(prefix, timeout = 240000) {
  // Con reintentos: la latencia de la cadena de proxies del rig es variable
  // (2–90+ s ya vista) y un primer clic puede quedarse sin respuesta del
  // host; si el lector no abrió y la fila sigue ahí, se vuelve a tocar.
  const deadline = Date.now() + timeout;
  let lastErr = null;
  while (Date.now() < deadline) {
    const row = await rowByLabel(prefix);
    if (!row) throw new Error(`Fila no encontrada: ${prefix}`);
    try {
      await row.click();
    } catch (e) {
      // Fila sin caja clicable (re-render reciente): clic por DOM y a seguir.
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
async function searchInSource(query, timeout = 120000) {
  await page.evaluate(() => { document.querySelector('#search-input').value = ''; });
  await page.type('#search-input', query);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelectorAll('#results .card').length > 0, { timeout });
}
async function openFirstResultMatching(substr, timeout = 240000) {
  const titles = await page.$$eval('#results .card .t', (els) => els.map((e) => e.textContent.trim()));
  // Preferir el título que EMPIEZA con el texto («Yotsuba» debe abrir
  // Yotsubato!, no «Kimi wa Yotsuba no Clover», que solo lo contiene).
  let idx = titles.findIndex((t) => t.toLowerCase().startsWith(substr.toLowerCase()));
  if (idx < 0) idx = titles.findIndex((t) => t.toLowerCase().includes(substr.toLowerCase()));
  if (idx < 0) throw new Error(`Sin resultado que contenga "${substr}": ${JSON.stringify(titles)}`);
  const cards = await page.$$('#results .card');
  await cards[idx].click();
  await page.waitForFunction(() => document.querySelectorAll('#chapters .chapter').length > 0, { timeout });
}
async function gotoNumber(n, expectLabel, timeout = 120000) {
  await page.evaluate(() => { document.querySelector('#goto-input').value = ''; });
  await page.type('#goto-input', String(n));
  await page.$eval('#goto-form', (f) => f.requestSubmit());
  await page.waitForFunction(
    (exp) => [...document.querySelectorAll('#chapters .chapter .ch-main span')]
      .some((el) => el.textContent.trim().startsWith(exp)),
    { timeout }, expectLabel,
  );
}
// Parche para capturar los blobs que la app «descarga» (CBZ / respaldo)
async function armBlobCapture() {
  await page.evaluate(() => {
    if (window.__blobArmed) return;
    window.__blobArmed = true;
    window.__lastBlob = null;
    const orig = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (b) => { if (b instanceof Blob) window.__lastBlob = b; return orig(b); };
  });
}

try {
  // --- Arranque e instalación de las dos fuentes ---
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

  // --- 1) BÚSQUEDA GLOBAL: «One Piece» en todas las fuentes ---
  await page.evaluate(() => { document.querySelector('#global-search-input').value = ''; });
  await page.type('#global-search-input', 'One Piece');
  await page.$eval('#global-search-form', (f) => f.requestSubmit());
  await page.waitForFunction(() => {
    const heads = [...document.querySelectorAll('#global-results .global-head')];
    return heads.length >= 2 && heads.every((h) => !h.textContent.startsWith('Buscando en'));
  }, { timeout: 300000 });
  S.globalHeads = await page.$$eval('#global-results .global-head', (els) => els.map((e) => e.textContent.trim()));
  S.globalCards = await page.$$eval('#global-results .global-group', (els) =>
    els.map((g) => g.querySelectorAll('.card').length));
  log('búsqueda global:', JSON.stringify(S.globalHeads), '| tarjetas por grupo:', JSON.stringify(S.globalCards));
  // Abrir un detalle desde el grupo de Weeb Central
  const wcGroupIdx = S.globalHeads.findIndex((h) => h.includes('Weeb Central'));
  if (wcGroupIdx < 0) throw new Error('La búsqueda global no trajo grupo de Weeb Central');
  await page.$$eval('#global-results .global-group', (els, i) => {
    els[i].querySelector('.card').click();
  }, wcGroupIdx);
  await page.waitForFunction(() => document.querySelectorAll('#chapters .chapter').length > 0, { timeout: 420000 });
  S.globalOpenedTitle = await txt('#manga-detail h2');
  log('detalle abierto desde la búsqueda global:', S.globalOpenedTitle);
  await clickEl('#brand');
  await page.waitForSelector('#global-search-form', { visible: true, timeout: 15000 });

  // --- MangaDex / Yotsuba: regresiones ronda 3 + biblioteca + favorito ---
  await page.click('button[data-open="multi.mangadex"]');
  await page.waitForSelector('#search-input', { visible: true, timeout: 15000 });
  await searchInSource('Yotsuba');
  await openFirstResultMatching('yotsuba');
  S.mangaTitle = await txt('#manga-detail h2');
  S.firstVol = await firstVolHeader();
  S.firstRow = await firstRowLabel();
  S.pagerStart = await pagerInfo();
  log('Yotsuba:', S.mangaTitle, '| abre en', S.firstVol, '| primera fila:', S.firstRow, '|', S.pagerStart);
  // Orden invertible (regresión ronda 3, breve): desc → Volumen 16; asc otra vez
  await clickEl('#btn-order');
  await page.waitForFunction(
    () => document.querySelector('#chapters .vol-header')?.textContent.trim() === 'Volumen 16',
    { timeout: 60000 },
  );
  S.invertedVol = await firstVolHeader();
  await clickEl('#btn-order');
  await page.waitForFunction(
    () => document.querySelector('#chapters .vol-header')?.textContent.trim() === 'Volumen 1',
    { timeout: 60000 },
  );
  // Añadir a la biblioteca (siembra el «conocido» de novedades) y favorito
  await page.click('#btn-lib');
  await page.waitForFunction(() => document.querySelector('#btn-lib')?.textContent.includes('En tu biblioteca'), { timeout: 30000 });
  await page.click('#btn-fav');
  await page.waitForFunction(() => document.querySelector('#btn-fav')?.textContent.includes('⭐'), { timeout: 15000 });
  S.libSeeded = await page.evaluate(async () => {
    const db = await new Promise((res, rej) => { const r = indexedDB.open('tinta'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const recs = await new Promise((res, rej) => { const t = db.transaction('library', 'readonly'); const rq = t.objectStore('library').getAll(); rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error); });
    const rec = recs.find((r) => (r.title || '').toLowerCase().includes('yotsuba'));
    return rec ? { key: rec.key, known: rec.knownChapterCount, fav: !!rec.favorite } : null;
  });
  log('biblioteca sembrada:', JSON.stringify(S.libSeeded));

  // --- Avance hasta la página 3 (índice 2): el observador lo guarda ---
  await openChapterRow('Cap. 1');
  S.cap1Total = await page.$$eval('#pages img', (els) => els.length);
  await page.$eval('#pages img[data-idx="2"]', (el) => el.scrollIntoView({ block: 'start' }));
  // El layout se mueve mientras las imágenes cargan: insistir con el scroll
  // y leer el registro en Node hasta ver lastPage === 2 (página 3).
  let progressOk = false;
  for (let i = 0; i < 15 && !progressOk; i++) {
    await page.$eval('#pages img[data-idx="2"]', (el) => el.scrollIntoView({ block: 'start' })).catch(() => {});
    await new Promise((r) => setTimeout(r, 2500));
    S.savedPage = await page.evaluate(async () => {
      const db = await new Promise((res) => { const r = indexedDB.open('tinta'); r.onsuccess = () => res(r.result); });
      const recs = await new Promise((res) => { const t = db.transaction('progress', 'readonly'); const rq = t.objectStore('progress').getAll(); rq.onsuccess = () => res(rq.result); });
      const p = recs.find((x) => x.lastChapterKey);
      return p ? p.lastPage : null;
    });
    // El avance solo crece (el observador no retrocede): basta que haya
    // pasado la página 3; la página exacta guardada manda en lo que sigue.
    progressOk = S.savedPage != null && S.savedPage >= 2;
  }
  if (!progressOk) throw new Error('El avance no se guardó más allá de la página 3');
  S.savedPageHuman = S.savedPage + 1;
  log('avance guardado: página', S.savedPageHuman, 'de', S.cap1Total);

  // --- 3) SEGUIR LEYENDO global: el riel lo muestra y reabre donde ibas ---
  await clickEl('#brand');
  await page.waitForFunction(() => {
    const w = document.querySelector('#continue-wrap');
    return w && !w.hidden && [...document.querySelectorAll('#continue-rail .card .t')]
      .some((el) => el.textContent.toLowerCase().includes('yotsuba'));
  }, { timeout: 60000 });
  S.continueCard = await page.$$eval('#continue-rail .card', (els) =>
    els.map((c) => ({ t: c.querySelector('.t')?.textContent.trim(), sub: c.querySelector('.sub')?.textContent.trim() })));
  log('riel «Seguir leyendo»:', JSON.stringify(S.continueCard));
  // Reabrir desde el riel en modo paginado: el indicador debe marcar la
  // página guardada sobre el total del capítulo.
  await page.evaluate(() => localStorage.setItem('tinta.readerMode', 'paged'));
  await page.$$eval('#continue-rail .card', (els) => {
    const card = els.find((c) => c.querySelector('.t')?.textContent.toLowerCase().includes('yotsuba'));
    card.click();
  });
  await page.waitForFunction((human, total) => {
    const v = document.querySelector('#view-reader');
    const ind = document.querySelector('#page-indicator')?.textContent.trim() || '';
    const img = document.querySelector('#pages img.page-img');
    // La imagen paginada debe existir y estar cargada: el indicador solo
    // podría ser un resto de la sesión anterior del lector.
    return v && !v.hidden && !!img && img.complete && img.naturalWidth > 0
      && ind === `${human} / ${total}`;
  }, { timeout: 240000 }, S.savedPageHuman, S.cap1Total);
  S.continueIndicator = await txt('#page-indicator');
  log('reabierto desde el riel en:', S.continueIndicator);
  // --- Lector MangaDex completo: cambiar a scroll y cargar todas las páginas ---
  await clickEl('.zone.center');
  await clickEl('#btn-rc-mode'); // Páginas → Scroll
  await page.waitForFunction(() => document.querySelectorAll('#pages img').length > 10, { timeout: 60000 });
  await page.evaluate(async () => {
    const imgs = [...document.querySelectorAll('#pages img')];
    for (const img of imgs) { img.scrollIntoView(); await new Promise((r) => setTimeout(r, 40)); }
    window.scrollTo(0, 0);
  });
  await page.waitForFunction(
    () => [...document.querySelectorAll('#pages img')].every((i) => i.complete && i.naturalWidth > 0),
    { timeout: 240000 },
  );
  S.cap1Loaded = await page.$$eval('#pages img', (els) => els.filter((i) => i.naturalWidth > 0).length);
  log('Cap. 1 completo en scroll:', S.cap1Loaded, '/', S.cap1Total);
  // Salir al detalle
  await page.$eval('#view-reader [data-back-manga]', (el) => el.click());
  await page.waitForFunction(() => !document.querySelector('#view-manga').hidden, { timeout: 30000 });

  // --- 2) NOVEDADES: sembrar conocido = total-3 y buscar ---
  await page.evaluate(async () => {
    const db = await new Promise((res, rej) => { const r = indexedDB.open('tinta'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const recs = await new Promise((res, rej) => { const t = db.transaction('library', 'readonly'); const rq = t.objectStore('library').getAll(); rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error); });
    const rec = recs.find((r) => (r.title || '').toLowerCase().includes('yotsuba'));
    rec.knownChapterCount = rec.knownChapterCount - 3;
    rec.newChapters = 0;
    await new Promise((res, rej) => { const t = db.transaction('library', 'readwrite'); const rq = t.objectStore('library').put(rec); rq.onsuccess = () => res(); rq.onerror = () => rej(rq.error); });
  });
  await clickEl('#brand');
  await page.waitForSelector('#btn-check-updates', { visible: true, timeout: 15000 });
  await page.click('#btn-check-updates');
  await page.waitForFunction(() => {
    const b = document.querySelector('#library .new-badge');
    return b && b.textContent.trim() === '+3';
  }, { timeout: 240000 });
  S.newsBadge = await page.$eval('#library .new-badge', (el) => el.textContent.trim());
  log('insignia de novedades:', S.newsBadge);
  // Abrir el detalle limpia la insignia
  await page.$eval('#library .lib-card', (el) => el.click());
  await page.waitForFunction(() => document.querySelectorAll('#chapters .chapter').length > 0, { timeout: 240000 });
  await clickEl('#brand');
  await page.waitForFunction(() => !document.querySelector('#library .new-badge'), { timeout: 30000 });
  S.badgeCleared = true;
  log('insignia limpia tras abrir el detalle ✓');
  // Volver al detalle de Yotsuba desde la biblioteca para seguir
  await page.$eval('#library .lib-card', (el) => el.click());
  await page.waitForFunction(() => document.querySelectorAll('#chapters .chapter').length > 0, { timeout: 240000 });

  // --- 4a) IR AL CAPÍTULO: Yotsuba cap. 50 (volumen correcto) ---
  await gotoNumber(50, 'Cap. 50');
  S.gotoYotsuba = {
    vol: await firstVolHeader(), pager: await pagerInfo(),
    highlighted: await page.$eval('#chapters .chapter.highlight .ch-main span', (el) => el.textContent.trim()).catch(() => null),
  };
  log('ir al cap. 50:', JSON.stringify(S.gotoYotsuba));

  // --- 4b) DESCARGAR RANGO 1–2 y leer sin red ---
  await clickEl('#btn-range');
  await page.waitForSelector('#range-panel:not([hidden])', { timeout: 10000 });
  await page.evaluate(() => {
    document.querySelector('#range-from').value = '1';
    document.querySelector('#range-to').value = '2';
  });
  await page.click('#btn-range-go');
  await page.waitForFunction(
    () => (document.querySelector('#range-progress')?.textContent || '').includes('Rango terminado'),
    { timeout: 420000 },
  );
  S.rangeProgress = await txt('#range-progress');
  S.rangeDownloads = await page.evaluate(async () => {
    const db = await new Promise((res, rej) => { const r = indexedDB.open('tinta'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const recs = await new Promise((res, rej) => { const t = db.transaction('downloads', 'readonly'); const rq = t.objectStore('downloads').getAll(); rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error); });
    return recs.filter((d) => d.sourceId === 'multi.mangadex')
      .map((d) => ({ label: d.chapterLabel, pages: d.totalPages, chapterKey: d.chapterKey }));
  });
  log('rango:', S.rangeProgress, '| descargas:', JSON.stringify(S.rangeDownloads));
  // Leer el Cap. 2 SIN red (desde los blobs locales). Ojo: MangaDex trae el
  // capítulo duplicado por grupo de scanlation y solo uno quedó descargado:
  // se hace clic en la fila de la clave EXACTA que vive en la tienda offline.
  const cap2Key = S.rangeDownloads.find((d) => d.label.startsWith('Cap. 2'))?.chapterKey;
  if (!cap2Key) throw new Error('El rango no dejó ningún Cap. 2 descargado');
  await gotoNumber(2, 'Cap. 2'); // llevar la paginación al volumen del Cap. 2
  await page.setOfflineMode(true);
  try {
    await page.evaluate((k) => {
      const row = [...document.querySelectorAll('#chapters .chapter')]
        .find((r) => r.dataset.chapterKey === k);
      if (!row) throw new Error('Fila del Cap. 2 descargado no visible (¿otra página de la lista?)');
      row.click();
    }, cap2Key);
    await page.waitForFunction(() => {
      const img = document.querySelector('#pages img');
      return img && img.complete && img.naturalWidth > 0;
    }, { timeout: 60000 });
    S.offlineRead = await page.$eval('#page-indicator', (el) => el.textContent.trim());
  } finally {
    await page.setOfflineMode(false);
  }
  log('lectura sin red del Cap. 2:', S.offlineRead);
  await page.$eval('#view-reader > [data-back-manga]', (el) => el.click());
  await page.waitForFunction(() => !document.querySelector('#view-manga').hidden, { timeout: 30000 });

  // --- 5) EXPORTAR CBZ del Cap. 1 descargado ---
  await gotoNumber(1, 'Cap. 1');
  await armBlobCapture();
  const cap1Row = await rowByLabel('Cap. 1');
  await cap1Row.$eval('.exp-btn', (b) => b.click());
  await page.waitForFunction(() => !!window.__lastBlob, { timeout: 60000 });
  S.cbz = await page.evaluate(async () => {
    const b = window.__lastBlob;
    const dv = new DataView(await b.arrayBuffer());
    const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1));
    let entries = 0;
    let firstName = '';
    // Recorrer el directorio central desde el EOCD (últimos 22 bytes)
    const n = dv.getUint16(dv.byteLength - 22 + 10, true);
    entries = n;
    const cdStart = dv.getUint32(dv.byteLength - 22 + 16, true);
    if (dv.getUint32(cdStart, true) === 0x02014b50) {
      const len = dv.getUint16(cdStart + 28, true);
      const bytes = new Uint8Array(dv.buffer, cdStart + 46, len);
      firstName = new TextDecoder().decode(bytes);
    }
    return { size: b.size, magic, entries, firstName, type: b.type };
  });
  log('CBZ exportado:', JSON.stringify(S.cbz));

  // --- 4c) IR AL CAPÍTULO: One Piece cap. 850 (bloque de 50) ---
  await clickEl('#brand');
  await page.click('button[data-open="en.weebcentral"]');
  await page.waitForSelector('#search-input', { visible: true, timeout: 15000 });
  await searchInSource('One Piece', 180000);
  await openFirstResultMatching('one piece', 420000);
  S.opPagerStart = await pagerInfo();
  S.opFirstRow = await firstRowLabel();
  log('One Piece abre:', S.opPagerStart, '| primera fila:', S.opFirstRow);
  await gotoNumber(850, 'Cap. 850', 120000);
  S.gotoOP = { pager: await pagerInfo() };
  log('ir al cap. 850:', JSON.stringify(S.gotoOP));

  // --- 6) TEMA DEL LECTOR: papel cálido ---
  await clickEl('#brand');
  await clickEl('#btn-settings');
  await page.waitForSelector('#settings:not([hidden])', { timeout: 10000 });
  await page.select('#set-reader-bg', 'papel');
  S.readerBgPref = await page.evaluate(() => localStorage.getItem('tinta.readerBg'));
  await clickEl('#btn-settings');
  await page.$eval('#library .lib-card', (el) => el.click());
  await page.waitForFunction(() => document.querySelectorAll('#chapters .chapter').length > 0, { timeout: 240000 });
  await openChapterRow('Cap. 1');
  S.readerBgComputed = await page.$eval('#view-reader', (el) => getComputedStyle(el).backgroundColor);
  log('tema papel: pref =', S.readerBgPref, '| fondo calculado =', S.readerBgComputed);
  await page.evaluate(() => localStorage.setItem('tinta.readerBg', 'negro'));
  await page.$eval('#view-reader > [data-back-manga]', (el) => el.click());
  await page.waitForFunction(() => !document.querySelector('#view-manga').hidden, { timeout: 30000 });
  await clickEl('#brand');

  // --- 7) RESPALDO: exportar, borrar biblioteca, importar ---
  await armBlobCapture();
  await clickEl('#btn-settings');
  await page.waitForSelector('#settings:not([hidden])', { timeout: 10000 });
  await page.click('#btn-backup-export');
  await page.waitForFunction(() => !!window.__lastBlob, { timeout: 30000 });
  const backupText = await page.evaluate(async () => window.__lastBlob.text());
  const backup = JSON.parse(backupText);
  S.backup = { app: backup.app, library: backup.library.length, progress: backup.progress.length, hasPrefs: !!backup.prefs };
  writeFileSync('/tmp/tinta-respaldo-e2e.json', backupText);
  log('respaldo:', JSON.stringify(S.backup));
  await clickEl('#btn-settings');
  await page.evaluate(async () => {
    const db = await new Promise((res, rej) => { const r = indexedDB.open('tinta'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    await new Promise((res, rej) => { const t = db.transaction('library', 'readwrite'); const rq = t.objectStore('library').clear(); rq.onsuccess = () => res(); rq.onerror = () => rej(rq.error); });
  });
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => document.querySelectorAll('#library .lib-card').length === 0, { timeout: 90000 });
  S.libraryAfterWipe = 0;
  await clickEl('#btn-settings');
  await page.waitForSelector('#settings:not([hidden])', { timeout: 10000 });
  const backupInput = await page.$('#backup-file');
  await backupInput.uploadFile('/tmp/tinta-respaldo-e2e.json');
  await page.waitForFunction(() =>
    [...document.querySelectorAll('#library .lib-card .t')].some((el) => el.textContent.toLowerCase().includes('yotsuba')),
  { timeout: 60000 });
  S.libraryAfterImport = await page.$$eval('#library .lib-card .t', (els) => els.map((e) => e.textContent.trim()));
  log('biblioteca tras importar:', JSON.stringify(S.libraryAfterImport));

  out.success = !!(
    S.version === 'v1.8.0'
    && S.globalHeads.length >= 2
    && S.globalHeads.some((h) => h.includes('MangaDex') && !h.includes('⚠️'))
    && S.globalHeads.some((h) => h.includes('Weeb Central') && !h.includes('⚠️'))
    && S.globalCards.every((n) => n >= 1)
    && (S.globalOpenedTitle || '').toLowerCase().includes('one piece')
    && S.firstVol === 'Volumen 1' && (S.firstRow || '').startsWith('Cap. 1')
    && S.invertedVol === 'Volumen 16'
    && S.libSeeded && S.libSeeded.known > 100 && S.libSeeded.fav === true
    && S.cap1Total >= 40 && S.cap1Loaded === S.cap1Total
    && S.continueCard.some((c) => (c.t || '').toLowerCase().includes('yotsuba') && (c.sub || '').includes(`pág. ${S.savedPageHuman} de ${S.cap1Total}`))
    && S.continueIndicator === `${S.savedPageHuman} / ${S.cap1Total}`
    && S.newsBadge === '+3' && S.badgeCleared === true
    && (S.gotoYotsuba.highlighted || '').startsWith('Cap. 50')
    && S.rangeDownloads.length >= 2
    && !!S.offlineRead
    && S.cbz.magic === 'PK' && S.cbz.entries >= 40 && S.cbz.firstName.startsWith('0001.')
    && (S.opPagerStart || '').includes('1 de 24') && (S.opFirstRow || '').startsWith('Cap. 1')
    && (S.gotoOP.pager || '').includes('17 de 24')
    && S.readerBgPref === 'papel' && S.readerBgComputed === 'rgb(245, 236, 215)'
    && S.backup.app === 'tinta' && S.backup.library >= 1 && S.backup.progress >= 1
    && S.libraryAfterImport.some((t) => t.toLowerCase().includes('yotsuba'))
  );
} catch (err) {
  out.success = false;
  out.error = String(err && err.message || err).slice(0, 700);
  out.toastAtError = await page.$eval('#toast', (el) => el.hidden ? '' : el.textContent).catch(() => '<sin acceso>');
  log('ERROR:', out.error, '| toast:', out.toastAtError);
}

console.log('RESULTADO_JSON ' + JSON.stringify(out, null, 1));
await browser.close();
process.exit(out.success ? 0 : 1);
