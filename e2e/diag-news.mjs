// Diag novedades ronda 4: siembra biblioteca, baja el «conocido», pulsa
// «Buscar novedades» y observa registro + insignia.
import puppeteer from 'puppeteer-core';
import { lookup } from 'node:dns/promises';
const EXE = '/home/hatch/workspace/tinta/e2e/chrome-headless-shell/linux-155.0.8059.84/chrome-headless-shell-linux64/chrome-headless-shell';
const proxyEnv = process.env.https_proxy || '';
let proxy = '';
if (proxyEnv) { const u = new URL(proxyEnv); const { address, family } = await lookup(u.hostname); proxy = `${u.protocol}//${family === 6 ? `[${address}]` : address}:${u.port}`; }
const args = ['--no-sandbox', '--disable-dev-shm-usage', '--ignore-certificate-errors'];
if (proxy) args.push(`--proxy-server=${proxy}`, '--proxy-bypass-list=localhost;127.0.0.1');
const browser = await puppeteer.launch({ executablePath: EXE, args, protocolTimeout: 300000 });
const page = await browser.newPage();
await page.setViewport({ width: 420, height: 900 });
await page.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36');
if (process.env.TINTA_PROXYBASE) await page.evaluateOnNewDocument((v) => { try { localStorage.setItem('tinta.proxyBase', v); } catch {} }, process.env.TINTA_PROXYBASE);
page.on('pageerror', (e) => console.log('PAGEERROR:', String(e).slice(0, 200)));
page.on('console', (m) => console.log('CONSOLA', m.type(), ':', m.text().slice(0, 300)));
await page.goto(process.env.TINTA_BASE || 'http://localhost:8788/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('button[data-install="multi.mangadex"]', { timeout: 60000 });
await page.click('button[data-install="multi.mangadex"]');
await page.waitForSelector('button[data-open="multi.mangadex"]', { timeout: 90000 });
await page.click('button[data-open="multi.mangadex"]');
await page.waitForSelector('#search-input', { visible: true });
await page.type('#search-input', 'Yotsuba');
await page.keyboard.press('Enter');
await page.waitForFunction(() => document.querySelectorAll('#results .card').length > 0, { timeout: 120000 });
const titles = await page.$$eval('#results .card .t', (els) => els.map((e) => e.textContent.trim()));
const cards = await page.$$('#results .card');
await cards[titles.findIndex((t) => t.toLowerCase().startsWith('yotsuba'))].click();
await page.waitForFunction(() => document.querySelectorAll('#chapters .chapter').length > 0, { timeout: 240000 });
await page.click('#btn-lib');
await page.waitForFunction(() => document.querySelector('#btn-lib')?.textContent.includes('En tu biblioteca'), { timeout: 30000 });
const readLib = () => page.evaluate(async () => {
  const db = await new Promise((res, rej) => { const r = indexedDB.open('tinta'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const recs = await new Promise((res, rej) => { const t = db.transaction('library', 'readonly'); const rq = t.objectStore('library').getAll(); rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error); });
  return recs.map((r) => ({ title: r.title, known: r.knownChapterCount, latest: r.knownLatestChapterKey, news: r.newChapters, stub: r.stub }));
});
console.log('ANTES:', JSON.stringify(await readLib(), null, 1));
const raw = await page.evaluate(async () => {
  const db = await new Promise((res, rej) => { const r = indexedDB.open('tinta'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const recs = await new Promise((res, rej) => { const t = db.transaction('library', 'readonly'); const rq = t.objectStore('library').getAll(); rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error); });
  return { dbVersion: db.version, stores: [...db.objectStoreNames], recs: recs.map((r) => ({ key: r.key, sourceId: r.sourceId, mangaKey: r.mangaKey })) };
});
console.log('CRUDO:', JSON.stringify(raw));
await page.evaluate(async () => {
  const db = await new Promise((res, rej) => { const r = indexedDB.open('tinta'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const recs = await new Promise((res, rej) => { const t = db.transaction('library', 'readonly'); const rq = t.objectStore('library').getAll(); rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error); });
  const rec = recs[0];
  rec.knownChapterCount -= 3;
  rec.newChapters = 0;
  await new Promise((res, rej) => { const t = db.transaction('library', 'readwrite'); const rq = t.objectStore('library').put(rec); rq.onsuccess = () => res(); rq.onerror = () => rej(rq.error); });
});
await page.$eval('#brand', (el) => el.click());
await page.waitForSelector('#btn-check-updates', { visible: true, timeout: 15000 });
const pre = await page.evaluate(() => ({
  installedRows: document.querySelectorAll('#installed .source-row').length,
  installedNames: [...document.querySelectorAll('#installed .source-row .meta b')].map((b) => b.textContent),
  lastCheck: localStorage.getItem('tinta.lastUpdateCheck'),
}));
console.log('PRE-CLIC:', JSON.stringify(pre));
await page.evaluate(() => {
  window.__trail2 = [];
  const btn = document.querySelector('#btn-check-updates');
  const mo = new MutationObserver(() => window.__trail2.push(`${Date.now() % 100000}:${btn.textContent}:${btn.disabled}`));
  mo.observe(btn, { childList: true, characterData: true, attributes: true, subtree: true });
  window.__libPuts = 0;
  const origPut = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (v) {
    if (this.name === 'library') window.__libPuts++;
    return origPut.call(this, v);
  };
  window.__toasts = [];
  const toastObs = new MutationObserver(() => {
    const t = document.querySelector('#toast');
    if (t && !t.hidden && t.textContent) window.__toasts.push(t.textContent);
  });
  toastObs.observe(document.querySelector('#toast'), { childList: true, characterData: true, attributes: true, subtree: true });
});
await page.$eval('#btn-check-updates', (el) => el.click());
for (let i = 0; i < 6; i++) {
  await new Promise((r) => setTimeout(r, 10000));
  const probe = await page.evaluate(() => ({
    btn: document.querySelector('#btn-check-updates')?.textContent,
    badge: document.querySelector('#library .new-badge')?.textContent || document.querySelector('.new-badge')?.textContent || null,
    toast: document.querySelector('#toast').hidden ? '' : document.querySelector('#toast').textContent,
  }));
  console.log(`t+${(i + 1) * 10}s`, JSON.stringify(probe));
  if (probe.badge) break;
}
console.log('DESPUÉS:', JSON.stringify(await readLib(), null, 1));
const trail = await page.evaluate(() => ({ trail: window.__trail2, libPuts: window.__libPuts, toasts: window.__toasts, lastCheck: localStorage.getItem('tinta.lastUpdateCheck') }));
console.log('BOTÓN DURANTE EL CHEQUEO:', JSON.stringify(trail));
await browser.close();
