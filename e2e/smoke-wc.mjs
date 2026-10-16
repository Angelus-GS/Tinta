// Smoke test de Fase 2 en Node: instala Weeb Central (fixture real v8) en el
// bundle clásico y corre búsqueda -> detalle+capítulos -> páginas contra
// weebcentral.com REAL a través del proxy del usuario.
// El shim de navigator pone un UA de navegador: sin él, el host mandaría el
// UA de Node vía x-tinta-ua y Cloudflare desafía la petición (verificado).
import { readFileSync } from 'node:fs';

try {
  Object.defineProperty(globalThis, 'navigator', {
    value: { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36' },
    configurable: true,
  });
} catch { /* Node ya trae uno */ }

const QUERY = process.argv[2] || 'One Piece';
const PROXY = process.env.TINTA_PROXYBASE || 'https://tinta-proxy.nacho-divan-7j.workers.dev';

const selectorsUsed = [];
globalThis.__tintaHtmlTrace = (fn, q) => { if (q) selectorsUsed.push(`${fn}(${q})`); };

const listeners = [];
const posted = [];
globalThis.self = globalThis;
self.postMessage = (m) => posted.push(m);
self.addEventListener = () => {};

const src = readFileSync('/home/hatch/workspace/tinta/app/host-worker.js', 'utf8');
eval(src);

if (typeof self.onmessage !== 'function') { console.log('FALLO: onmessage no definido'); process.exit(1); }

const pendingReplies = new Map();
let seq = 1000;
async function send(msg) {
  const id = ++seq;
  const before = posted.length;
  await self.onmessage({ data: { ...msg, id } });
  const reply = posted.slice(before).find((m) => m.id === id);
  if (!reply) throw new Error('sin respuesta para ' + msg.type);
  if (!reply.ok) throw new Error(reply.error);
  return reply.result;
}

console.log('ready:', JSON.stringify(posted.find((m) => m.type === 'ready')));
const cfg = await send({ type: 'config', config: { proxyBase: PROXY, languages: ['en', 'es'] } });
console.log('config:', JSON.stringify(cfg), '| proxy:', PROXY);

const aix = readFileSync('/home/hatch/workspace/tinta/spike/fixtures/weebcentral.aix');
let t0 = Date.now();
const info = await send({ type: 'install', aixBytes: aix.buffer.slice(aix.byteOffset, aix.byteOffset + aix.byteLength) });
console.log(`install: ${info.id} ${info.name} v${info.version} (${Date.now() - t0} ms)`);

t0 = Date.now();
const res = await send({ type: 'search', sourceId: info.id, query: QUERY, page: 1 });
console.log(`search "${QUERY}": ${res.entries.length} resultados, has_next=${res.has_next_page} (${Date.now() - t0} ms)`);
for (const e of res.entries.slice(0, 5)) console.log('  -', JSON.stringify(e.title), '| key:', e.key, '| cover:', e.cover);

if (!res.entries.length) { console.log('FALLO: búsqueda vacía'); process.exit(2); }
const target = res.entries.find((e) => e.title && e.title.toLowerCase().includes(QUERY.toLowerCase().split(' ')[0]))
  || res.entries[0];

t0 = Date.now();
const m = await send({ type: 'update', sourceId: info.id, manga: target });
console.log(`update "${m.title}": status=${m.status} authors=${JSON.stringify(m.authors)} rating=${m.content_rating} viewer=${m.viewer} (${Date.now() - t0} ms)`);
console.log('  tags:', JSON.stringify((m.tags || []).slice(0, 8)));
console.log('  desc:', JSON.stringify((m.description || '').slice(0, 90)));
console.log('  chapters:', (m.chapters || []).length);
for (const c of (m.chapters || []).slice(0, 3)) {
  console.log('  - cap', c.chapter_number, '| key:', c.key, '| fecha:', c.date_uploaded);
}
if (!(m.chapters || []).length) { console.log('FALLO: sin capítulos'); process.exit(3); }

const chapter = m.chapters[0];
t0 = Date.now();
const pages = await send({ type: 'pages', sourceId: info.id, manga: m, chapter });
console.log(`pages: ${pages.length} (${Date.now() - t0} ms)`);
const hosts = new Set();
for (const p of pages.slice(0, 3)) {
  console.log('  -', p.content && p.content.url);
  if (p.content && p.content.url) hosts.add(new URL(p.content.url).host);
}
for (const p of pages) if (p.content && p.content.url) hosts.add(new URL(p.content.url).host);
console.log('hosts de imágenes:', [...hosts].join(', '));

console.log('selectores/atributos ejercitados:', [...new Set(selectorsUsed)].join(' | '));
console.log('SMOKE WC OK');
process.exit(0);
