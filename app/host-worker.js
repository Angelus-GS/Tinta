// GENERADO por e2e/bundle-worker.mjs — NO editar a mano.
// Worker clásico autocontenido de Tinta (host Aidoku). Fuentes:
// lib/postcard.js, lib/types.js, lib/unzip.js y worker-src.js en este repo.

// ===== postcard (lib/postcard.js) =====
// Postcard (formato binario de serde) — encoder/decoder mínimo.
// Verificado byte-exacto contra salidas reales de fuentes Aidoku en Fase 0.

function encVarint(n) {
  const out = [];
  let v = BigInt(n);
  do {
    let byte = Number(v & 0x7fn);
    v >>= 7n;
    if (v > 0n) byte |= 0x80;
    out.push(byte);
  } while (v > 0n);
  return Uint8Array.from(out);
}

function encString(s) {
  const b = new TextEncoder().encode(s);
  const head = encVarint(b.length);
  const out = new Uint8Array(head.length + b.length);
  out.set(head, 0);
  out.set(b, head.length);
  return out;
}

function encZigzag(n) {
  const v = BigInt(n);
  return encVarint(v >= 0n ? v * 2n : -v * 2n - 1n);
}

function encBool(b) {
  return Uint8Array.of(b ? 1 : 0);
}

function encOpt(v, fn) {
  if (v === null || v === undefined) return Uint8Array.of(0);
  const inner = fn(v);
  const out = new Uint8Array(1 + inner.length);
  out[0] = 1;
  out.set(inner, 1);
  return out;
}

function encVec(arr, fn) {
  const parts = [encVarint(arr.length)];
  for (const item of arr) parts.push(fn(item));
  return concat(parts);
}

function concat(parts) {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}

class Dec {
  constructor(buf) {
    this.buf = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    this.view = new DataView(this.buf.buffer, this.buf.byteOffset, this.buf.byteLength);
    this.p = 0;
  }
  u8() { return this.buf[this.p++]; }
  varint() {
    let result = 0n, shift = 0n;
    for (;;) {
      const byte = this.buf[this.p++];
      result |= BigInt(byte & 0x7f) << shift;
      if (!(byte & 0x80)) break;
      shift += 7n;
    }
    return result;
  }
  usize() { return Number(this.varint()); }
  i64() { const v = this.varint(); return Number((v >> 1n) ^ (-(v & 1n))); }
  f32() { const x = this.view.getFloat32(this.p, true); this.p += 4; return x; }
  bool() { return this.u8() !== 0; }
  string() {
    const n = this.usize();
    const s = new TextDecoder().decode(this.buf.subarray(this.p, this.p + n));
    this.p += n;
    return s;
  }
  option(fn) { return this.u8() === 0 ? null : fn(this); }
  vec(fn) {
    const n = this.usize();
    const out = [];
    for (let i = 0; i < n; i++) out.push(fn(this));
    return out;
  }
}

// ===== tipos Aidoku (lib/types.js) =====
// Codecs postcard para los tipos de aidoku-rs que cruzan la frontera del host.
// El orden de campos es el de aidoku-rs (verificado en Fase 0 contra
// MangaDex v14: decodificaciones byte-exactas de principio a fin).

const MangaStatus = ['Unknown', 'Ongoing', 'Completed', 'Cancelled', 'Hiatus'];
const ContentRating = ['Unknown', 'Safe', 'Suggestive', 'NSFW'];
const Viewer = ['Unknown', 'LeftToRight', 'RightToLeft', 'Vertical', 'Webtoon'];

const optStr = (d) => d.option((x) => x.string());
const strArr = (d) => d.vec((x) => x.string());
const f32bytes = (x) => { const b = new Uint8Array(4); new DataView(b.buffer).setFloat32(0, x, true); return b; };

function decChapter(d) {
  return {
    key: d.string(),
    title: optStr(d),
    chapter_number: d.option((x) => x.f32()),
    volume_number: d.option((x) => x.f32()),
    date_uploaded: d.option((x) => x.i64()),
    scanlators: d.option(strArr),
    url: optStr(d),
    language: optStr(d),
    thumbnail: optStr(d),
    locked: d.bool(),
  };
}

function encChapter(c) {
  return concat([
    encString(c.key),
    encOpt(c.title, encString),
    encOpt(c.chapter_number, f32bytes),
    encOpt(c.volume_number, f32bytes),
    encOpt(c.date_uploaded, encZigzag),
    encOpt(c.scanlators, (a) => encVec(a, encString)),
    encOpt(c.url, encString),
    encOpt(c.language, encString),
    encOpt(c.thumbnail, encString),
    Uint8Array.of(c.locked ? 1 : 0),
  ]);
}

function decManga(d) {
  return {
    key: d.string(),
    title: d.string(),
    cover: optStr(d),
    artists: d.option(strArr),
    authors: d.option(strArr),
    description: optStr(d),
    url: optStr(d),
    tags: d.option(strArr),
    status: d.usize(),
    content_rating: d.usize(),
    viewer: d.usize(),
    update_strategy: d.usize(),
    next_update_time: d.option((x) => x.i64()),
    chapters: d.option((x) => x.vec(decChapter)),
  };
}

function encManga(m) {
  return concat([
    encString(m.key),
    encString(m.title),
    encOpt(m.cover, encString),
    encOpt(m.artists, (a) => encVec(a, encString)),
    encOpt(m.authors, (a) => encVec(a, encString)),
    encOpt(m.description, encString),
    encOpt(m.url, encString),
    encOpt(m.tags, (a) => encVec(a, encString)),
    encVarint(m.status),
    encVarint(m.content_rating),
    encVarint(m.viewer),
    encVarint(m.update_strategy),
    encOpt(m.next_update_time, encZigzag),
    encOpt(m.chapters, (a) => encVec(a, encChapter)),
  ]);
}

function decMangaPageResult(d) {
  return { entries: d.vec(decManga), has_next_page: d.bool() };
}

function decListing(d) {
  return { id: d.string(), name: d.string(), kind: d.usize() };
}

function decPage(d) {
  const variant = d.usize();
  let content;
  if (variant === 0) {
    const url = d.string();
    const ctx = d.option((x) => {
      const n = x.usize();
      const o = {};
      for (let i = 0; i < n; i++) { const k = x.string(); o[k] = x.string(); }
      return o;
    });
    content = { type: 'url', url, ctx };
  } else if (variant === 1) {
    content = { type: 'text', text: d.string() };
  } else if (variant === 3) {
    content = { type: 'zip', zip: d.string(), file: d.string() };
  } else {
    content = { type: 'image', variant };
  }
  return {
    content,
    thumbnail: optStr(d),
    has_description: d.bool(),
    description: optStr(d),
  };
}


// ===== unzip .aix (lib/unzip.js) =====
// Lector ZIP mínimo para paquetes .aix (stored + deflate vía DecompressionStream).
// Los .aix usan rutas con '/' y todo el contenido vive en Payload/.

async function inflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function unzip(bytes) {
  const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  // Buscar End Of Central Directory (firma 0x06054b50) desde el final
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65536); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('ZIP inválido: no se encontró el directorio central');
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const files = new Map();
  const decoder = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (view.getUint32(p, true) !== 0x02014b50) break;
    const method = view.getUint16(p + 10, true);
    const compSize = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const localOff = view.getUint32(p + 42, true);
    const name = decoder.decode(buf.subarray(p + 46, p + 46 + nameLen));
    // Cabecera local: saltar nombre/extra locales para llegar a los datos
    const lNameLen = view.getUint16(localOff + 26, true);
    const lExtraLen = view.getUint16(localOff + 28, true);
    const dataStart = localOff + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(dataStart, dataStart + compSize);
    if (!name.endsWith('/')) {
      files.set(name, method === 0 ? raw.slice() : await inflateRaw(raw));
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

// Extrae las piezas de un .aix; acepta Payload/ (canónico) y res/ (respaldo).
async function extractAix(bytes) {
  const files = await unzip(bytes);
  const pick = (name) => files.get(`Payload/${name}`) ?? files.get(`res/${name}`) ?? null;
  const wasm = pick('main.wasm');
  const sourceJson = pick('source.json');
  if (!wasm || !sourceJson) throw new Error('.aix inválido: faltan main.wasm o source.json');
  const parse = (b) => (b ? JSON.parse(new TextDecoder().decode(b)) : null);
  return {
    wasm,
    source: parse(sourceJson),
    filters: parse(pick('filters.json')),
    settings: parse(pick('settings.json')),
    icon: pick('icon.png'),
  };
}

// ===== host (fuente modular: worker-src.js) (worker-src.js) =====
// Host Aidoku en Web Worker (Fase 1).
// Transporte de red sincrono segun ADR-0001:
//   1) JSPI (WebAssembly.Suspending/promising) con fetch asincrono.
//   2) Respaldo universal sin transformar binarios: XHR sincrono en el worker.
// Semantica del ABI verificada en Fase 0 contra aidoku-rs (test-runner).



const HAS_JSPI = typeof WebAssembly !== 'undefined' && 'Suspending' in WebAssembly && 'promising' in WebAssembly;
const METHODS = ['GET', 'POST', 'PUT', 'HEAD', 'DELETE', 'PATCH', 'OPTIONS', 'CONNECT', 'TRACE'];

let config = { proxyBase: '', languages: ['en', 'es'] };
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
      reply({ jspi: HAS_JSPI });
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

post({ type: 'ready', jspi: HAS_JSPI });
