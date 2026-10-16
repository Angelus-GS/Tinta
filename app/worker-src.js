// Host Aidoku en Web Worker (Fase 1).
// Transporte de red sincrono segun ADR-0001:
//   1) JSPI (WebAssembly.Suspending/promising) con fetch asincrono.
//   2) Respaldo universal sin transformar binarios: XHR sincrono en el worker.
// Semantica del ABI verificada en Fase 0 contra aidoku-rs (test-runner).
import { Dec, encString, encVarint, concat } from './lib/postcard.js';
import { decManga, decMangaPageResult, decListing, decPage, encManga, encChapter } from './lib/types.js';
import { extractAix } from './lib/unzip.js';

const UA = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
// Safari 27 ya trae JSPI, pero en la practica rompe la ejecucion de la
// fuente (get_search_manga_list devolvia -3 desde std.read_buffer en el
// iPhone del usuario, 2026-10-15). En navegadores AppleWebKit sin Chrome
// (Safari mac/iOS y todo navegador iOS) se usa el respaldo XHR sincrono,
// que paso la aceptacion completa via proxy. Reevaluar cuando madure.
const APPLE_WEBKIT_NO_CHROME = /AppleWebKit/.test(UA) && !/Chrome\/|Chromium\/|Edg\/|OPR\//.test(UA);
const HAS_JSPI = !APPLE_WEBKIT_NO_CHROME && typeof WebAssembly !== 'undefined' && 'Suspending' in WebAssembly && 'promising' in WebAssembly;
const METHODS = ['GET', 'POST', 'PUT', 'HEAD', 'DELETE', 'PATCH', 'OPTIONS', 'CONNECT', 'TRACE'];

let config = { proxyBase: '', languages: ['en', 'es'] };
// Debe coincidir con APP_VERSION en main.js: la UI los compara y avisa si
// la actualización llegó a medias al dispositivo.
const HOST_BUILD = '1.3.0';
const sources = new Map(); // sourceId -> ctx

function effectiveUrl(url) {
  if (!config.proxyBase) return url;
  const base = config.proxyBase.replace(/\/?$/, '/');
  return `${base}?u=${encodeURIComponent(url)}`;
}

function makeCtx(sourceId) {
  return {
    id: sourceId,
    instance: null,
    ex: null,          // exports "promising" (JSPI) o crudos
    store: new Map(),
    nextRid: 1,
    defaults: new Map(),
    rate: { permits: Infinity, periodSec: 1, stamps: [] },
    manifest: null,
  };
}

function storeItem(ctx, item) {
  const rid = ctx.nextRid++;
  ctx.store.set(rid, item);
  return rid;
}

function seedDefaults(ctx, settings) {
  const encArr = (arr) => concat([encVarint(arr.length), ...arr.map(encString)]);
  const walk = (node) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (node && typeof node === 'object') {
      if (node.key && 'default' in node) {
        const v = node.default;
        if (typeof v === 'string') ctx.defaults.set(node.key, encString(v));
        else if (typeof v === 'boolean') ctx.defaults.set(node.key, Uint8Array.of(v ? 1 : 0));
        else if (Array.isArray(v)) ctx.defaults.set(node.key, encArr(v.map(String)));
      }
      Object.values(node).forEach(walk);
    }
  };
  if (settings) walk(settings);
  // "languages" lo provee la app anfitriona, no settings.json (hallazgo Fase 0)
  if (!ctx.defaults.has('languages')) ctx.defaults.set('languages', encArr(config.languages));
}

async function rateLimitWait(ctx) {
  const { permits, periodSec, stamps } = ctx.rate;
  if (!Number.isFinite(permits)) return;
  const now = Date.now();
  while (stamps.length && now - stamps[0] > periodSec * 1000) stamps.shift();
  if (stamps.length >= permits) {
    const waitMs = periodSec * 1000 - (now - stamps[0]) + 5;
    await new Promise((r) => setTimeout(r, Math.max(0, waitMs)));
    return rateLimitWait(ctx);
  }
  stamps.push(Date.now());
}

async function fetchResponse(req) {
  const init = { method: METHODS[req.method] || 'GET', headers: Object.fromEntries(req.headers) };
  if (req.body && init.method !== 'GET' && init.method !== 'HEAD') init.body = req.body;
  const res = await fetch(effectiveUrl(req.url), init);
  const data = new Uint8Array(await res.arrayBuffer());
  const headers = new Map();
  res.headers.forEach((v, k) => headers.set(k.toLowerCase(), v));
  return { status: res.status, data, headers, url: res.url };
}

function fetchResponseSync(req) {
  const xhr = new XMLHttpRequest();
  xhr.open(METHODS[req.method] || 'GET', effectiveUrl(req.url), false);
  for (const [k, v] of req.headers) { try { xhr.setRequestHeader(k, v); } catch { /* cabecera prohibida */ } }
  xhr.responseType = 'arraybuffer';
  xhr.send(req.body && req.method !== 0 ? req.body : null);
  const headers = new Map();
  for (const line of (xhr.getAllResponseHeaders() || '').split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i > 0) headers.set(line.slice(0, i).trim().toLowerCase(), line.slice(i + 1).trim());
  }
  return { status: xhr.status, data: new Uint8Array(xhr.response || new ArrayBuffer(0)), headers, url: req.url };
}

function buildImports(ctx) {
  const mem = () => new Uint8Array(ctx.instance.exports.memory.buffer);
  const readStr = (ptr, len) => new TextDecoder().decode(mem().slice(ptr, ptr + len));
  const readBytes = (ptr, len) => mem().slice(ptr, ptr + len);

  const netSendAsync = async (rid) => {
    const req = ctx.store.get(rid);
    if (!req || req.kind !== 'request') return -1;
    if (!req.url) return -4;
    try {
      await rateLimitWait(ctx);
      req.response = await fetchResponse(req);
      return 0;
    } catch { return -10; }
  };
  const netSendSync = (rid) => {
    const req = ctx.store.get(rid);
    if (!req || req.kind !== 'request') return -1;
    if (!req.url) return -4;
    try {
      req.response = fetchResponseSync(req);
      return 0;
    } catch { return -10; }
  };
  const sendImpl = HAS_JSPI ? new WebAssembly.Suspending(netSendAsync) : netSendSync;
  const sendAllImpl = HAS_JSPI
    ? new WebAssembly.Suspending(async (ptr, len) => {
        let anyErr = false;
        const results = [];
        for (let i = 0; i < len; i++) {
          const rid = new DataView(mem().buffer, mem().byteOffset + ptr + i * 4, 4).getInt32(0, true);
          const r = await netSendAsync(rid);
          if (r !== 0) anyErr = true;
          results.push(r);
        }
        results.forEach((r, i) => new DataView(mem().buffer, mem().byteOffset + ptr + i * 4, 4).setInt32(0, r, true));
        return anyErr ? -10 : 0;
      })
    : (ptr, len) => {
        let anyErr = false;
        for (let i = 0; i < len; i++) {
          const rid = new DataView(mem().buffer, mem().byteOffset + ptr + i * 4, 4).getInt32(0, true);
          const r = netSendSync(rid);
          if (r !== 0) anyErr = true;
          new DataView(mem().buffer, mem().byteOffset + ptr + i * 4, 4).setInt32(0, r, true);
        }
        return anyErr ? -10 : 0;
      };

  const net = {
    init: (method) => storeItem(ctx, { kind: 'request', method, url: null, headers: new Map(), body: null, response: null }),
    set_url: (rid, ptr, len) => {
      const req = ctx.store.get(rid);
      if (!req || req.kind !== 'request') return -1;
      req.url = readStr(ptr, len);
      return 0;
    },
    set_header: (rid, kp, kl, vp, vl) => {
      const req = ctx.store.get(rid);
      if (!req || req.kind !== 'request') return -1;
      req.headers.set(readStr(kp, kl), readStr(vp, vl));
      return 0;
    },
    set_body: (rid, ptr, len) => {
      const req = ctx.store.get(rid);
      if (!req || req.kind !== 'request') return -1;
      req.body = readBytes(ptr, len);
      return 0;
    },
    set_timeout: () => 0,
    set_rate_limit: (permits, period) => { ctx.rate.permits = permits; ctx.rate.periodSec = period || 1; ctx.rate.stamps = []; },
    send: sendImpl,
    send_all: sendAllImpl,
    data_len: (rid) => {
      const req = ctx.store.get(rid);
      if (!req || req.kind !== 'request') return -1;
      return req.response ? req.response.data.length : -8;
    },
    read_data: (rid, ptr, size) => {
      const req = ctx.store.get(rid);
      if (!req || req.kind !== 'request') return -1;
      if (!req.response) return -8;
      if (size > req.response.data.length) return -11;
      mem().set(req.response.data.subarray(0, size), ptr);
      return 0;
    },
    get_status_code: (rid) => {
      const req = ctx.store.get(rid);
      if (!req || req.kind !== 'request') return -1;
      return req.response ? req.response.status : -8;
    },
    get_header: (rid, kp, kl) => {
      const req = ctx.store.get(rid);
      if (!req || req.kind !== 'request') return -1;
      if (!req.response) return -8;
      const v = req.response.headers.get(readStr(kp, kl).toLowerCase());
      return v === undefined ? -7 : storeItem(ctx, { kind: 'string', value: v });
    },
    html: () => -2, // Fase 2 (modulo html)
    get_image: () => -2,
    get_url: (rid) => {
      const req = ctx.store.get(rid);
      if (!req || req.kind !== 'request' || !req.response) return -8;
      return storeItem(ctx, { kind: 'string', value: req.response.url });
    },
  };

  const std = {
    destroy: (rid) => { ctx.store.delete(rid); },
    buffer_len: (rid) => {
      const it = ctx.store.get(rid);
      if (!it) return -1;
      if (it.kind === 'encoded') return it.data.length;
      if (it.kind === 'string') return encString(it.value).length;
      return -1;
    },
    read_buffer: (rid, ptr, size) => {
      const it = ctx.store.get(rid);
      if (!it) return -1;
      const data = it.kind === 'encoded' ? it.data : it.kind === 'string' ? encString(it.value) : null;
      if (!data || size > data.length) return -3;
      mem().set(data.subarray(0, size), ptr);
      return 0;
    },
    current_date: () => Date.now() / 1000,
    parse_date: () => -5,
    utc_offset: () => 0,
  };

  const defaults = {
    get: (ptr, len) => {
      const key = readStr(ptr, len);
      if (!ctx.defaults.has(key)) return -2;
      return storeItem(ctx, { kind: 'encoded', data: ctx.defaults.get(key) });
    },
    set: (ptr, len, kind, valuePtr) => {
      const key = readStr(ptr, len);
      const total = new DataView(mem().buffer, mem().byteOffset + valuePtr, 4).getInt32(0, true);
      ctx.defaults.set(key, readBytes(valuePtr + 8, total - 8).slice());
      return 0;
    },
  };

  const env = {
    print: (ptr, len) => console.log(`[${ctx.id}]`, readStr(ptr, len)),
    abort: () => { console.error(`[${ctx.id}] abort()`); throw new Error('La fuente llamo a abort()'); },
    send_partial_result: (ptr) => {
      try {
        const payload = readResultBytes(ctx, ptr);
        const manga = decManga(new Dec(payload));
        post({ type: 'partial', sourceId: ctx.id, manga });
      } catch { /* parciales de otros tipos (home) se ignoran en Fase 1 */ }
    },
    sleep: () => {},
  };

  // Modulos aun no implementados: stubs con error limpio (Fase 2: html, js, canvas)
  const stubModule = () => new Proxy({}, { get: (_t, name) => (typeof name === 'string' ? () => -2 : undefined) });

  return { env, std, net, defaults, html: stubModule(), js: stubModule(), canvas: stubModule() };
}

function readResultBytes(ctx, ptr) {
  const mem = new Uint8Array(ctx.instance.exports.memory.buffer);
  const view = new DataView(mem.buffer, mem.byteOffset + ptr, 8);
  const len = view.getInt32(0, true);
  if (len === -1) {
    const realLen = new DataView(mem.buffer, mem.byteOffset + ptr + 8, 4).getInt32(0, true);
    const raw = mem.slice(ptr + 12, ptr + 12 + Math.max(0, realLen));
    let msg = '';
    for (const b of raw) { if (b >= 32 && b < 127) msg += String.fromCharCode(b); else break; }
    throw new Error(msg || 'Error de la fuente');
  }
  return mem.slice(ptr + 8, ptr + len);
}

function wrapExports(ctx) {
  const raw = ctx.instance.exports;
  if (!HAS_JSPI) { ctx.ex = raw; return; }
  const wrapped = { memory: raw.memory, free_result: raw.free_result };
  for (const [name, fn] of Object.entries(raw)) {
    if (typeof fn === 'function' && name !== 'free_result') wrapped[name] = WebAssembly.promising(fn);
  }
  ctx.ex = wrapped;
}

async function callExport(ctx, name, ...args) {
  const ptr = await ctx.ex[name](...args);
  if (typeof ptr !== 'number') return null;
  if (ptr <= 0) throw new Error(`${name} devolvio ${ptr}`);
  try {
    return readResultBytes(ctx, ptr);
  } finally {
    ctx.instance.exports.free_result(ptr);
  }
}

async function installSource(aixBytes) {
  const parts = await extractAix(aixBytes);
  const info = parts.source.info;
  const ctx = makeCtx(info.id);
  ctx.manifest = parts.source;
  seedDefaults(ctx, parts.settings);
  const importsObj = buildImports(ctx);
  const module = await WebAssembly.compile(parts.wasm);
  // Recortar el objeto de imports a lo que el modulo pide de verdad
  const needed = {};
  for (const d of WebAssembly.Module.imports(module)) {
    needed[d.module] ??= {};
    const provided = importsObj[d.module];
    needed[d.module][d.name] = (provided && provided[d.name]) || (() => -2);
  }
  ctx.instance = await WebAssembly.instantiate(module, needed);
  wrapExports(ctx);
  sources.set(info.id, ctx);
  await ctx.ex.start();
  return { id: info.id, name: info.name, version: info.version, icon: parts.icon, hasSettings: !!parts.settings };
}

const post = (msg) => self.postMessage(msg);

self.onmessage = async (e) => {
  const { id, type } = e.data;
  const reply = (result) => post({ id, ok: true, result });
  const fail = (err) => post({ id, ok: false, error: String(err?.message || err) });
  try {
    if (type === 'config') {
      Object.assign(config, e.data.config || {});
      reply({ jspi: HAS_JSPI, build: HOST_BUILD });
      return;
    }
    if (type === 'install') {
      const info = await installSource(new Uint8Array(e.data.aixBytes));
      reply(info);
      return;
    }
    const ctx = sources.get(e.data.sourceId);
    if (!ctx) throw new Error(`Fuente no instalada: ${e.data.sourceId}`);
    if (type === 'search') {
      const queryRid = storeItem(ctx, { kind: 'encoded', data: new TextEncoder().encode(e.data.query) });
      const filtersRid = storeItem(ctx, { kind: 'encoded', data: Uint8Array.of(0) });
      const payload = await callExport(ctx, 'get_search_manga_list', queryRid, e.data.page || 1, filtersRid);
      reply(decMangaPageResult(new Dec(payload)));
    } else if (type === 'listings') {
      const payload = await callExport(ctx, 'get_listings');
      const d = new Dec(payload);
      reply(d.vec(decListing));
    } else if (type === 'mangaList') {
      const listingRid = storeItem(ctx, { kind: 'encoded', data: new TextEncoder().encode(e.data.listingId) });
      const payload = await callExport(ctx, 'get_manga_list', listingRid, e.data.page || 1);
      reply(decMangaPageResult(new Dec(payload)));
    } else if (type === 'update') {
      const mangaRid = storeItem(ctx, { kind: 'encoded', data: encManga(e.data.manga) });
      const payload = await callExport(ctx, 'get_manga_update', mangaRid, 1, 1);
      reply(decManga(new Dec(payload)));
    } else if (type === 'pages') {
      const mangaRid = storeItem(ctx, { kind: 'encoded', data: encManga(e.data.manga) });
      const chapterRid = storeItem(ctx, { kind: 'encoded', data: encChapter(e.data.chapter) });
      const payload = await callExport(ctx, 'get_page_list', mangaRid, chapterRid);
      const d = new Dec(payload);
      reply(d.vec(decPage));
    } else {
      throw new Error(`Tipo de mensaje desconocido: ${type}`);
    }
  } catch (err) {
    fail(err);
  }
};

post({ type: 'ready', jspi: HAS_JSPI, build: HOST_BUILD });
