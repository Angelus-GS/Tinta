// Diag ronda 4: ¿qué filas de Yotsubato! (MangaDex) vienen locked?
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
await page.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36');
if (process.env.TINTA_PROXYBASE) await page.evaluateOnNewDocument((v) => { try { localStorage.setItem('tinta.proxyBase', v); } catch {} }, process.env.TINTA_PROXYBASE);
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
const idx = titles.findIndex((t) => t.toLowerCase().startsWith('yotsuba'));
const cards = await page.$$('#results .card');
await cards[idx].click();
await page.waitForFunction(() => document.querySelectorAll('#chapters .chapter').length > 0, { timeout: 240000 });
const rows = await page.$$eval('#chapters .chapter', (els) => els.map((el) => ({
  label: el.querySelector('.ch-main span')?.textContent.trim(),
  locked: el.classList.contains('locked'),
})));
console.log(JSON.stringify(rows, null, 1));
// Réplica del flujo e2e: invertir orden dos veces, biblioteca, favorito
const clickEl = (sel) => page.$eval(sel, (el) => el.click());
await clickEl('#btn-order');
await page.waitForFunction(() => document.querySelector('#chapters .vol-header')?.textContent.trim() === 'Volumen 16', { timeout: 60000 });
await clickEl('#btn-order');
await page.waitForFunction(() => document.querySelector('#chapters .vol-header')?.textContent.trim() === 'Volumen 1', { timeout: 60000 });
await page.click('#btn-lib');
await page.waitForFunction(() => document.querySelector('#btn-lib')?.textContent.includes('En tu biblioteca'), { timeout: 30000 });
await page.click('#btn-fav');
await page.waitForFunction(() => document.querySelector('#btn-fav')?.textContent.includes('⭐'), { timeout: 15000 });
console.log('flujo previo OK');
// Clic real (coordenadas) sobre la fila «Cap. 1», como hace la e2e
const rowEls = await page.$$('#chapters .chapter');
let target = null;
for (const r of rowEls) {
  const t = await r.evaluate((el) => el.querySelector('.ch-main span')?.textContent || '');
  if (t.startsWith('Cap. 1 ')) { target = r; break; }
}
console.log('fila objetivo encontrada:', !!target);
await target.click();
await new Promise((r) => setTimeout(r, 20000));
const probe = await page.evaluate(() => ({
  readerHidden: document.querySelector('#view-reader').hidden,
  pagesHtml: document.querySelector('#pages').innerHTML.slice(0, 300),
  imgs: document.querySelectorAll('#pages img').length,
  toast: document.querySelector('#toast').textContent,
  dlBtns: [...document.querySelectorAll('#chapters .dl-btn')].slice(0, 3).map((b) => b.textContent),
}));
console.log('TRAS CLIC:', JSON.stringify(probe, null, 1));
await browser.close();
