// Diagnóstico puntual: ¿qué URLs devuelven >=400 durante el paso del lector
// paginado (Yotsuba Cap. 1) en la v1.8.1?
import puppeteer from 'puppeteer-core';
import { lookup } from 'node:dns/promises';

const BASE = process.env.TINTA_BASE || 'http://localhost:8788/';
const EXE = '/home/hatch/workspace/tinta/e2e/chrome-headless-shell/linux-155.0.8059.84/chrome-headless-shell-linux64/chrome-headless-shell';
const proxyEnv = process.env.https_proxy || process.env.http_proxy || '';
let proxy = '';
if (proxyEnv) {
  const u = new URL(proxyEnv);
  const { address, family } = await lookup(u.hostname);
  proxy = `${u.protocol}//${family === 6 ? `[${address}]` : address}:${u.port}`;
}
const args = ['--no-sandbox', '--disable-dev-shm-usage', '--ignore-certificate-errors'];
if (proxy) args.push(`--proxy-server=${proxy}`, '--proxy-bypass-list=localhost;127.0.0.1');
const browser = await puppeteer.launch({ executablePath: EXE, args, protocolTimeout: 300000 });
const page = await browser.newPage();
await page.setViewport({ width: 420, height: 900 });
if (process.env.TINTA_PROXYBASE) {
  await page.evaluateOnNewDocument((v) => { try { localStorage.setItem('tinta.proxyBase', v); } catch {} }, process.env.TINTA_PROXYBASE);
}
const bad = [];
page.on('response', (r) => { if (r.status() >= 400) bad.push(`${r.status()} ${r.url().slice(0, 160)}`); });
page.on('requestfailed', (r) => bad.push(`FAILED ${r.failure()?.errorText} ${r.url().slice(0, 140)}`));

await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForSelector('button[data-install="multi.mangadex"]', { timeout: 60000 });
await page.click('button[data-install="multi.mangadex"]');
await page.waitForSelector('button[data-open="multi.mangadex"]', { timeout: 120000 });
await page.click('button[data-open="multi.mangadex"]');
await page.waitForSelector('#search-input', { visible: true, timeout: 15000 });
await page.type('#search-input', 'Yotsuba');
await page.keyboard.press('Enter');
await page.waitForFunction(() => document.querySelectorAll('#results .card').length > 0, { timeout: 120000 });
const cards = await page.$$('#results .card');
await cards[0].click();
await page.waitForFunction(() => document.querySelectorAll('#chapters .chapter').length > 0, { timeout: 240000 });
console.log('=== hasta el detalle, malos:', bad.length); bad.length = 0;
await page.evaluate(() => localStorage.setItem('tinta.readerMode', 'paged'));
const rows = await page.$$('#chapters .chapter');
await rows[0].click();
await page.waitForFunction(() => {
  const img = document.querySelector('#pages .paged-stage img.page-img');
  return img && img.complete && img.naturalWidth > 0;
}, { timeout: 180000 });
await new Promise((r) => setTimeout(r, 9000));
console.log('=== durante lector paginado + precarga:');
for (const b of bad) console.log(' ', b);
await browser.close();
