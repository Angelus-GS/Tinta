// Diagnóstico: ejercita cada función de lib/idb.js en la página real.
import puppeteer from 'puppeteer-core';

const BASE = process.env.TINTA_BASE || 'http://localhost:8789/';
const EXE = '/home/hatch/workspace/tinta/e2e/chrome-headless-shell/linux-155.0.8059.84/chrome-headless-shell-linux64/chrome-headless-shell';
import { lookup } from 'node:dns/promises';
const proxyEnv = process.env.https_proxy || process.env.http_proxy || '';
let proxy = '';
if (proxyEnv) {
  const u = new URL(proxyEnv);
  const { address, family } = await lookup(u.hostname);
  proxy = `${u.protocol}//${family === 6 ? `[${address}]` : address}:${u.port}`;
}
const args = ['--no-sandbox', '--disable-dev-shm-usage', '--ignore-certificate-errors'];
if (proxy) args.push(`--proxy-server=${proxy}`, '--proxy-bypass-list=localhost;127.0.0.1');
const browser = await puppeteer.launch({ executablePath: EXE, args, protocolTimeout: 120000 });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', String(e).slice(0, 300)));
await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForSelector('#catalog .source-row', { timeout: 60000 }).catch(() => {});

const results = await page.evaluate(async () => {
  const { idb } = await import('/lib/idb.js');
  const out = {};
  const t = async (name, fn) => {
    try { out[name] = 'OK: ' + JSON.stringify(await fn())?.slice(0, 120); }
    catch (e) { out[name] = 'FALLO: ' + (e.message || e).toString().slice(0, 160); }
  };
  await t('getMissingProgress', () => idb.getProgress('no::existe').then((r) => r === undefined ? 'undefined' : typeof r));
  await t('getMissingLibrary', () => idb.getLibrary('no::existe').then((r) => r === undefined ? 'undefined' : typeof r));
  await t('putSource', () => idb.putSource({ id: 'x.test', name: 'Test', version: 1, aixBytes: new ArrayBuffer(4) }));
  await t('allSources', () => idb.allSources().then((r) => r.length));
  await t('putLibrary', () => idb.putLibrary({ key: 's::m', sourceId: 's', mangaKey: 'm', title: 'T', cover: null, stub: { key: 'm' }, snapshot: { key: 'm', chapters: [] }, addedAt: 1 }));
  await t('getLibrary', () => idb.getLibrary('s::m').then((r) => r?.title));
  await t('putProgress', () => idb.putProgress({ key: 's::m', sourceId: 's', mangaKey: 'm', chapters: { c1: { page: 2, total: 10, finished: false, updatedAt: 1 } }, lastChapterKey: 'c1', lastPage: 2, updatedAt: 1 }));
  await t('getProgress', () => idb.getProgress('s::m').then((r) => r?.lastPage));
  await t('putDownload', () => idb.putDownload({ key: 's::m::c1', sourceId: 's', mangaKey: 'm', chapterKey: 'c1', totalPages: 2, size: 3, downloadedAt: 1 }));
  await t('putPage0', () => idb.putPage({ key: 's::m::c1::00000', dlKey: 's::m::c1', index: 0, blob: new Blob(['abc'], { type: 'image/png' }) }));
  await t('putPage1', () => idb.putPage({ key: 's::m::c1::00001', dlKey: 's::m::c1', index: 1, blob: new Blob(['defg'], { type: 'image/png' }) }));
  await t('getPagesOf', () => idb.getPagesOf('s::m::c1').then((r) => r.map((x) => x.index)));
  await t('getDownload', () => idb.getDownload('s::m::c1').then((r) => r?.totalPages));
  await t('putLocalBook', () => idb.putLocalBook({ id: 'cbz-x', title: 'Libro', totalPages: 1, addedAt: 1 }));
  await t('allLocalBooks', () => idb.allLocalBooks().then((r) => r.length));
  await t('deleteDownloadCascade', () => idb.deleteDownloadCascade('s::m::c1'));
  await t('getPagesOfAfterDelete', () => idb.getPagesOf('s::m::c1').then((r) => r.length));
  await t('deleteLocalBookCascade', () => idb.deleteLocalBookCascade('cbz-x'));
  return out;
});
console.log(JSON.stringify(results, null, 1));
await browser.close();
