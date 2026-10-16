// Diagnóstico Fase 2: ¿la búsqueda WC falla en la red o dentro del worker?
import puppeteer from 'puppeteer-core';
import { lookup } from 'node:dns/promises';

const BASE = 'http://localhost:8788/';
const EXE = '/home/hatch/workspace/tinta/e2e/chrome-headless-shell/linux-155.0.8059.84/chrome-headless-shell-linux64/chrome-headless-shell';
const proxyEnv = process.env.https_proxy || process.env.http_proxy || '';
let proxy = '';
if (proxyEnv) {
  const u = new URL(proxyEnv);
  const { address, family } = await lookup(u.hostname);
  proxy = `${u.protocol}//${family === 6 ? `[${address}]` : address}:${u.port}`;
}
const browser = await puppeteer.launch({
  executablePath: EXE,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--ignore-certificate-errors',
    ...(proxy ? [`--proxy-server=${proxy}`, '--proxy-bypass-list=localhost;127.0.0.1'] : [])],
  protocolTimeout: 300000,
});
const page = await browser.newPage();
await page.setViewport({ width: 420, height: 900 });
await page.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36');
await page.evaluateOnNewDocument((v) => {
  try { localStorage.setItem('tinta.proxyBase', v); } catch { /* noop */ }
}, 'https://tinta-proxy.nacho-divan-7j.workers.dev');
page.on('console', (m) => console.log('CONSOLE', m.type(), m.text().slice(0, 200)));
page.on('pageerror', (e) => console.log('PAGEERROR', String(e).slice(0, 300)));
page.on('requestfailed', (r) => console.log('REQFAIL', r.url().slice(0, 90), r.failure() && r.failure().errorText));
page.on('response', (r) => { if (r.url().includes('workers.dev')) console.log('RESP workers.dev', r.status(), r.url().slice(0, 80)); });

await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForSelector('button[data-install="en.weebcentral"]', { timeout: 30000 });
await page.click('button[data-install="en.weebcentral"]');
await page.waitForSelector('button[data-open="en.weebcentral"]', { timeout: 90000 });
console.log('instalado ✓');
await page.click('button[data-open="en.weebcentral"]');
await page.waitForSelector('#search-input', { visible: true, timeout: 15000 });

// Petición gemela desde el contexto de la página (misma URL, mismo proxy, x-tinta-ua)
const twin = await page.evaluate(async () => {
  const url = 'https://weebcentral.com/search/data?limit=24&offset=0&display_mode=Full+Display&text=One+Piece';
  const t0 = Date.now();
  try {
    const res = await fetch('https://tinta-proxy.nacho-divan-7j.workers.dev/?u=' + encodeURIComponent(url),
      { headers: { 'x-tinta-ua': navigator.userAgent } });
    const text = await res.text();
    return { status: res.status, ms: Date.now() - t0, bytes: text.length, articles: (text.match(/<article/g) || []).length, head: text.slice(0, 80) };
  } catch (e) {
    return { error: String(e), ms: Date.now() - t0 };
  }
});
console.log('FETCH GEMELO (página):', JSON.stringify(twin));

await page.type('#search-input', 'One Piece');
await page.keyboard.press('Enter');
for (let i = 0; i < 12; i++) {
  await new Promise((r) => setTimeout(r, 5000));
  const state = await page.evaluate(() => ({
    results: document.querySelectorAll('#results .card').length,
    resultsText: (document.querySelector('#results') || {}).textContent?.trim().slice(0, 120),
    toast: (() => { const t = document.querySelector('#toast'); return t && !t.hidden ? t.textContent : ''; })(),
  }));
  console.log(`t+${(i + 1) * 5}s`, JSON.stringify(state));
  if (state.results > 0) break;
}
await browser.close();
process.exit(0);
