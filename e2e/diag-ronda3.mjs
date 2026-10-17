// Diagnóstico Ronda 3: ¿qué guarda el progreso tras leer Cap. 114 y qué
// pintan las filas al volver? Solo JSPI (:8788).
import puppeteer from 'puppeteer-core';

const BASE = 'http://localhost:8788/';
const EXE = '/home/hatch/workspace/tinta/e2e/chrome-headless-shell/linux-155.0.8059.84/chrome-headless-shell-linux64/chrome-headless-shell';
import { lookup } from 'node:dns/promises';
const proxyEnv = process.env.https_proxy || process.env.http_proxy || '';
let proxy = '';
if (proxyEnv) {
  const u = new URL(proxyEnv);
  const { address, family } = await lookup(u.hostname);
  proxy = `${u.protocol}//${family === 6 ? `[${address}]` : address}:${u.port}`;
}
const launchArgs = ['--no-sandbox', '--disable-dev-shm-usage', '--ignore-certificate-errors'];
if (proxy) launchArgs.push(`--proxy-server=${proxy}`, '--proxy-bypass-list=localhost;127.0.0.1');
const browser = await puppeteer.launch({ executablePath: EXE, args: launchArgs, protocolTimeout: 300000 });
const page = await browser.newPage();
await page.setViewport({ width: 420, height: 900 });
await page.evaluateOnNewDocument((v) => { try { localStorage.setItem('tinta.proxyBase', v); } catch {} },
  'https://tinta-proxy.nacho-divan-7j.workers.dev');
const txt = (sel) => page.$eval(sel, (el) => el.textContent.trim());
const clickEl = (sel) => page.$eval(sel, (el) => el.click());
const firstVolHeader = () => page.$eval('#chapters .vol-header', (el) => el.textContent.trim()).catch(() => null);
const pagerInfo = () => page.$eval('#chapters-pager-top .pager-info', (el) => el.textContent.trim()).catch(() => null);

await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForSelector('#catalog .source-row', { timeout: 60000 });
await page.waitForSelector('button[data-install="multi.mangadex"]', { timeout: 15000 });
await page.click('button[data-install="multi.mangadex"]');
await page.waitForSelector('button[data-open="multi.mangadex"]', { timeout: 90000 });
await page.click('button[data-open="multi.mangadex"]');
await page.waitForSelector('#search-input', { visible: true, timeout: 15000 });
await page.type('#search-input', 'Yotsuba');
await page.keyboard.press('Enter');
await page.waitForFunction(() => document.querySelectorAll('#results .card').length > 0, { timeout: 90000 });
const titles = await page.$$eval('#results .card .t', (els) => els.map((e) => e.textContent.trim()));
const cards = await page.$$('#results .card');
await cards[titles.findIndex((t) => t.toLowerCase().startsWith('yotsuba'))].click();
await page.waitForFunction(() => document.querySelectorAll('#chapters .chapter').length > 0, { timeout: 120000 });

// Ir a la página del Volumen 16
for (let i = 0; i < 20; i++) {
  if ((await firstVolHeader()) === 'Volumen 16') break;
  const prevInfo = await pagerInfo();
  await clickEl('#chapters-pager-bottom button:last-child');
  await page.waitForFunction(
    (prev) => document.querySelector('#chapters-pager-top .pager-info')?.textContent.trim() !== prev,
    { timeout: 30000 }, prevInfo,
  );
}
console.log('página actual:', await firstVolHeader(), '|', await pagerInfo());
const rowsDump = await page.$$eval('#chapters .chapter', (els) => els.map((el) => ({
  key: el.dataset.chapterKey,
  label: el.querySelector('.ch-main span')?.textContent || '',
})));
console.log('filas en la página:', JSON.stringify(rowsDump, null, 1));

// Abrir la primera fila Cap. 114
const rows = await page.$$('#chapters .chapter');
let target = null;
for (const r of rows) {
  const t = await r.evaluate((el) => el.querySelector('.ch-main span')?.textContent || '');
  if (t.startsWith('Cap. 114')) { target = r; break; }
}
const targetKey = await target.evaluate((el) => el.dataset.chapterKey);
console.log('abriendo capítulo key =', targetKey);
await target.click();
await page.waitForFunction(() => document.querySelectorAll('#pages img').length > 0, { timeout: 120000 });
const total = await page.$$eval('#pages img', (els) => els.length);
console.log('páginas del lector:', total);
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
await new Promise((r) => setTimeout(r, 3000));
const progDump = await page.evaluate(async () => {
  const db = await new Promise((res, rej) => {
    const r = indexedDB.open('tinta');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  const stores = [...db.objectStoreNames];
  const out = { stores };
  if (stores.includes('progress')) {
    out.progress = await new Promise((res, rej) => {
      const r = db.transaction('progress').objectStore('progress').getAll();
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  return out;
});
console.log('IDB:', JSON.stringify(progDump, null, 1).slice(0, 2500));

await clickEl('[data-back-manga]');
await new Promise((r) => setTimeout(r, 1500));
console.log('view-manga visible:', await page.evaluate(() => !document.querySelector('#view-manga').hidden));
const afterDump = await page.$$eval('#chapters .chapter', (els) => els.map((el) => ({
  key: el.dataset.chapterKey,
  cls: el.className,
  label: el.querySelector('.ch-main span')?.textContent || '',
  small: el.querySelector('.ch-main small')?.textContent || '',
})));
console.log('filas tras volver:', JSON.stringify(afterDump, null, 1));
await browser.close();
