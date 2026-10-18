// Sonda: ¿cómo responde fetch ante cada variante de req.respond de la
// intercepción de Puppeteer? (403 sin CORS, 403 con ACAO, abort)
import puppeteer from 'puppeteer-core';
import { lookup } from 'node:dns/promises';

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
const browser = await puppeteer.launch({ executablePath: EXE, args, protocolTimeout: 60000 });
const page = await browser.newPage();
await page.goto('http://localhost:8788/', { waitUntil: 'domcontentloaded', timeout: 30000 });

let mode = 'none';
await page.setRequestInterception(true);
page.on('request', (req) => {
  const u = req.url();
  if (!u.includes('uploads.mangadex.org')) { req.continue().catch(() => {}); return; }
  if (mode === 'plain') req.respond({ status: 403, contentType: 'text/plain', body: 'x' }).catch((e) => console.log('respond plain ERR', String(e).slice(0, 120)));
  else if (mode === 'acao') req.respond({ status: 403, headers: { 'Access-Control-Allow-Origin': '*' }, body: 'x' }).catch((e) => console.log('respond acao ERR', String(e).slice(0, 120)));
  else if (mode === 'acaoct') req.respond({ status: 403, contentType: 'text/plain', headers: { 'Access-Control-Allow-Origin': '*' }, body: 'x' }).catch((e) => console.log('respond acaoct ERR', String(e).slice(0, 120)));
  else if (mode === 'abort') req.abort().catch(() => {});
  else req.continue().catch(() => {});
});

const URL_TEST = 'https://uploads.mangadex.org/covers/test.jpg';
for (const m of ['plain', 'acao', 'acaoct', 'abort']) {
  mode = m;
  const res = await page.evaluate(async (u) => {
    const t0 = Date.now();
    try {
      const r = await fetch(u);
      return { kind: 'resolved', status: r.status, ok: r.ok, ms: Date.now() - t0 };
    } catch (e) {
      return { kind: 'rejected', msg: String(e.message || e), ms: Date.now() - t0 };
    }
  }, URL_TEST);
  console.log(m, JSON.stringify(res));
}
await browser.close();
