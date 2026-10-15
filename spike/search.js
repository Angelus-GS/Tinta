// Fase 0 spike: host Aidoku minimo en Node para correr una busqueda real.
// net.send es sincrono en el ABI -> en Node usamos curl via execFileSync
// (equivalente al reqwest::blocking del test-runner oficial).
const fs = require('fs');
const { execFileSync } = require('child_process');
const os = require('os');
const path = require('path');

const wasmPath = process.argv[2];
const query = process.argv[3] || 'One Piece';

// ---------- postcard ----------
function encString(s) {
  const b = Buffer.from(s, 'utf8');
  return Buffer.concat([encVarint(b.length), b]);
}
function encVarint(n) {
  const out = [];
  let v = BigInt(n);
  do {
    let byte = Number(v & 0x7fn);
    v >>= 7n;
    if (v > 0n) byte |= 0x80;
    out.push(byte);
  } while (v > 0n);
  return Buffer.from(out);
}
class Dec {
  constructor(buf) { this.buf = buf; this.p = 0; }
  u8() { return this.buf[this.p++]; }
  varint() {
    let result = 0n, shift = 0n;
    while (true) {
      const byte = this.buf[this.p++];
      result |= BigInt(byte & 0x7f) << shift;
      if (!(byte & 0x80)) break;
      shift += 7n;
    }
    return result;
  }
  usize() { return Number(this.varint()); }
  i64() { const v = this.varint(); return Number((v >> 1n) ^ (-(v & 1n))); }
  f32() { const x = this.buf.readFloatLE(this.p); this.p += 4; return x; }
  bool() { return this.u8() !== 0; }
  string() { const n = this.usize(); const s = this.buf.toString('utf8', this.p, this.p + n); this.p += n; return s; }
  option(fn) { const d = this.u8(); return d === 0 ? null : fn(this); }
  vec(fn) { const n = this.usize(); const out = []; for (let i = 0; i < n; i++) out.push(fn(this)); return out; }
}
function decChapter(d) {  return {
    key: d.string(),
    title: d.option(x => x.string()),
    chapter_number: d.option(x => x.f32()),
    volume_number: d.option(x => x.f32()),
    date_uploaded: d.option(x => x.i64()),
    scanlators: d.option(x => x.vec(y => y.string())),
    url: d.option(x => x.string()),
    language: d.option(x => x.string()),
    thumbnail: d.option(x => x.string()),
    locked: d.bool(),
  };
}
function decManga(d) {
  return {
    key: d.string(),
    title: d.string(),
    cover: d.option(x => x.string()),
    artists: d.option(x => x.vec(y => y.string())),
    authors: d.option(x => x.vec(y => y.string())),
    description: d.option(x => x.string()),
    url: d.option(x => x.string()),
    tags: d.option(x => x.vec(y => y.string())),
    status: d.usize(),
    content_rating: d.usize(),
    viewer: d.usize(),
    update_strategy: d.usize(),
    next_update_time: d.option(x => x.i64()),
    chapters: d.option(x => x.vec(decChapter)),
  };
}

// ---------- encoders postcard (espejo de los decoders) ----------
function encZigzag(n) { return encVarint(BigInt(n) >= 0n ? BigInt(n) * 2n : -BigInt(n) * 2n - 1n); }
function encOpt(v, fn) { return v === null || v === undefined ? Buffer.from([0]) : Buffer.concat([Buffer.from([1]), fn(v)]); }
function encVec(arr, fn) { return Buffer.concat([encVarint(arr.length), ...arr.map(fn)]); }
function encChapter(c) {
  return Buffer.concat([
    encString(c.key),
    encOpt(c.title, encString),
    encOpt(c.chapter_number, x => { const b = Buffer.alloc(4); b.writeFloatLE(x, 0); return b; }),
    encOpt(c.volume_number, x => { const b = Buffer.alloc(4); b.writeFloatLE(x, 0); return b; }),
    encOpt(c.date_uploaded, encZigzag),
    encOpt(c.scanlators, a => encVec(a, encString)),
    encOpt(c.url, encString),
    encOpt(c.language, encString),
    encOpt(c.thumbnail, encString),
    Buffer.from([c.locked ? 1 : 0]),
  ]);
}
function encManga(m) {
  return Buffer.concat([
    encString(m.key), encString(m.title),
    encOpt(m.cover, encString),
    encOpt(m.artists, a => encVec(a, encString)),
    encOpt(m.authors, a => encVec(a, encString)),
    encOpt(m.description, encString),
    encOpt(m.url, encString),
    encOpt(m.tags, a => encVec(a, encString)),
    encVarint(m.status), encVarint(m.content_rating), encVarint(m.viewer), encVarint(m.update_strategy),
    encOpt(m.next_update_time, encZigzag),
    encOpt(m.chapters, a => encVec(a, encChapter)),
  ]);
}
function decPage(d) {
  const variant = d.usize();
  let content;
  if (variant === 0) {
    const url = d.string();
    const ctx = d.option(x => { const n = x.usize(); const o = {}; for (let i = 0; i < n; i++) { const k = x.string(); o[k] = x.string(); } return o; });
    content = { type: 'url', url, ctx };
  } else if (variant === 1) content = { type: 'text', text: d.string() };
  else if (variant === 3) content = { type: 'zip', zip: d.string(), file: d.string() };
  else content = { type: 'image', variant };
  return { content, thumbnail: d.option(x => x.string()), has_description: d.bool(), description: d.option(x => x.string()) };
}
function readResult(ex, resultPtr) {
  if (resultPtr <= 0) throw new Error(`el export devolvio ${resultPtr} (sin resultado)`);
  const len = readBytes(resultPtr, 4).readInt32LE(0);
  if (len === -1) {
    const realLen = readBytes(resultPtr + 8, 4).readInt32LE(0);
    const errBytes = readBytes(resultPtr + 12, Math.min(realLen, 200));
    throw new Error('la fuente devolvio error: ' + errBytes.toString('hex'));
  }
  return readBytes(resultPtr + 8, len - 8);
}

// ---------- host store ----------
let nextRid = 1;
const store = new Map();
function storeItem(item) { const rid = nextRid++; store.set(rid, item); return rid; }

let instance = null;
const mem = () => new Uint8Array(instance.exports.memory.buffer);
function readStr(ptr, len) { return Buffer.from(mem().slice(ptr, ptr + len)).toString('utf8'); }
function readBytes(ptr, len) { return Buffer.from(mem().slice(ptr, ptr + len)); }

const METHODS = ['GET', 'POST', 'PUT', 'HEAD', 'DELETE', 'PATCH', 'OPTIONS', 'CONNECT', 'TRACE'];
const defaultsData = new Map();

// Siembra defaults desde el settings.json del .aix, como hace la app nativa:
// select->String, switch->Bool, multi-select/editable-list->StringArray (postcard)
function seedDefaults(settingsPath) {
  if (!settingsPath || !fs.existsSync(settingsPath)) return;
  const defs = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  const walk = (node) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (node && typeof node === 'object') {
      if (node.key && 'default' in node) {
        const v = node.default;
        if (typeof v === 'string') defaultsData.set(node.key, encString(v));
        else if (typeof v === 'boolean') defaultsData.set(node.key, Buffer.from([v ? 1 : 0]));
        else if (Array.isArray(v)) defaultsData.set(node.key, Buffer.concat([encVarint(v.length), ...v.map(encString)]));
        console.log(`  [defaults seed] "${node.key}" (${node.type})`);
      }
      Object.values(node).forEach(walk);
    }
  };
  walk(defs);
  // "languages" no vive en settings.json: es un default que la app anfitriona
  // provee segun los idiomas elegidos para la fuente.
  if (!defaultsData.has('languages')) {
    defaultsData.set('languages', Buffer.concat([encVarint(2), encString('en'), encString('es')]));
    console.log('  [defaults seed] "languages" (app) = ["en","es"]');
  }
}

function doSend(req) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tinta-net-'));
  const bodyFile = path.join(tmp, 'body');
  const headFile = path.join(tmp, 'headers');
  const args = ['-sS', '-g', '--max-time', '30', '-X', METHODS[req.method], '-D', headFile, '-o', bodyFile];
  let hasUA = false;
  for (const [k, v] of req.headers) { args.push('-H', `${k}: ${v}`); if (k.toLowerCase() === 'user-agent') hasUA = true; }
  if (!hasUA) args.push('-H', 'User-Agent: Aidoku/1 CFNetwork/3826.500.131 Darwin/24.5.0');
  if (req.body) { const bf = path.join(tmp, 'reqbody'); fs.writeFileSync(bf, req.body); args.push('--data-binary', `@${bf}`); }
  args.push('-w', '%{http_code}', req.url);
  try {
    const out = execFileSync('curl', args, { encoding: 'utf8' });
    const status = parseInt(out.trim().slice(-3), 10);
    const data = fs.readFileSync(bodyFile);
    const headTxt = fs.readFileSync(headFile, 'utf8');
    const headers = new Map();
    for (const line of headTxt.split(/\r?\n/)) {
      const i = line.indexOf(':');
      if (i > 0) headers.set(line.slice(0, i).trim().toLowerCase(), line.slice(i + 1).trim());
    }
    req.response = { status, data, headers, url: req.url };
    console.log(`  [net] ${METHODS[req.method]} ${req.url} -> ${status} (${data.length} bytes)`);
    return 0;
  } catch (e) {
    console.log(`  [net] ERROR ${req.url}: ${e.message.slice(0, 120)}`);
    return -10;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

const imports = {
  env: {
    print: (ptr, len) => console.log('[wasm print]', readStr(ptr, len)),
    abort: () => { console.log('[wasm abort]'); throw new Error('abort'); },
    send_partial_result: (ptr) => console.log('[wasm] send_partial_result ptr=', ptr),
  },
  std: {
    destroy: (rid) => { store.delete(rid); },
    buffer_len: (rid) => {
      const it = store.get(rid);
      if (!it) return -1;
      if (it.kind === 'encoded') return it.data.length;
      if (it.kind === 'string') return encString(it.value).length;
      return -1;
    },
    read_buffer: (rid, ptr, size) => {
      const it = store.get(rid);
      if (!it) return -1;
      const data = it.kind === 'encoded' ? it.data : it.kind === 'string' ? encString(it.value) : null;
      if (!data || size > data.length) return -3;
      mem().set(data.subarray(0, size), ptr);
      return 0;
    },
    current_date: () => Date.now() / 1000,
  },
  defaults: {
    get: (ptr, len) => {
      const key = readStr(ptr, len);
      console.log(`  [defaults.get] "${key}"`);
      if (!defaultsData.has(key)) return -2;
      return storeItem({ kind: 'encoded', data: defaultsData.get(key) });
    },
    set: (ptr, len, kind, valuePtr) => {
      const key = readStr(ptr, len);
      const total = readBytes(valuePtr, 4).readInt32LE(0);
      const data = readBytes(valuePtr + 8, total - 8);
      console.log(`  [defaults.set] "${key}" kind=${kind} (${data.length} bytes)`);
      defaultsData.set(key, Buffer.from(data));
      return 0;
    },
  },
  net: {
    init: (method) => storeItem({ kind: 'request', method, url: null, headers: new Map(), body: null, response: null }),
    set_url: (rid, ptr, len) => {
      const it = store.get(rid); if (!it || it.kind !== 'request') return -1;
      it.url = readStr(ptr, len);
      return 0;
    },
    set_header: (rid, kp, kl, vp, vl) => {
      const it = store.get(rid); if (!it || it.kind !== 'request') return -1;
      it.headers.set(readStr(kp, kl), readStr(vp, vl));
      return 0;
    },
    set_body: (rid, ptr, len) => {
      const it = store.get(rid); if (!it || it.kind !== 'request') return -1;
      it.body = readBytes(ptr, len);
      return 0;
    },
    set_timeout: () => 0,
    set_rate_limit: (permits, period, unit) => console.log(`  [net.set_rate_limit] permits=${permits} period=${period} unit=${unit}`),
    send: (rid) => {
      const it = store.get(rid); if (!it || it.kind !== 'request') return -1;
      if (!it.url) return -4;
      return doSend(it);
    },
    send_all: (ptr, len) => {
      let anyErr = false;
      const results = [];
      for (let i = 0; i < len; i++) {
        const rid = readBytes(ptr + i * 4, 4).readInt32LE(0);
        const it = store.get(rid);
        const r = it && it.kind === 'request' && it.url ? doSend(it) : -1;
        if (r !== 0) anyErr = true;
        results.push(r);
      }
      results.forEach((r, i) => { const b = Buffer.alloc(4); b.writeInt32LE(r, 0); mem().set(b, ptr + i * 4); });
      return anyErr ? -10 : 0;
    },
    data_len: (rid) => {
      const it = store.get(rid);
      if (!it || it.kind !== 'request') return -1;
      if (!it.response) return -8;
      return it.response.data.length;
    },
    read_data: (rid, ptr, size) => {
      const it = store.get(rid);
      if (!it || it.kind !== 'request') return -1;
      if (!it.response) return -8;
      if (size > it.response.data.length) return -11;
      mem().set(it.response.data.subarray(0, size), ptr);
      return 0;
    },
    get_status_code: (rid) => {
      const it = store.get(rid);
      if (!it || it.kind !== 'request') return -1;
      if (!it.response) return -8;
      return it.response.status;
    },
    get_header: (rid, kp, kl) => {
      const it = store.get(rid);
      if (!it || it.kind !== 'request') return -1;
      if (!it.response) return -8;
      const v = it.response.headers.get(readStr(kp, kl).toLowerCase());
      if (v === undefined) return -7;
      return storeItem({ kind: 'string', value: v });
    },
    html: () => -1,
  },
};

async function main() {
  const bytes = fs.readFileSync(wasmPath);
  seedDefaults(process.argv[4]);
  const { instance: inst } = await WebAssembly.instantiate(bytes, imports);
  instance = inst;
  const ex = instance.exports;
  console.log('start()...');
  ex.start();
  // OJO empirico: el parametro String (query) se lee con read_string = bytes
  // UTF-8 CRUDOS, sin postcard. Con postcard, el byte de longitud (0x09)
  // se colaba como TAB en el titulo de la URL. Los Vec (filtros) si van postcard.
  const queryRid = storeItem({ kind: 'encoded', data: Buffer.from(query, 'utf8') });
  const filtersRid = storeItem({ kind: 'encoded', data: Buffer.from([0]) }); // Vec vacio
  console.log(`get_search_manga_list("${query}", page=1, filters=[])...`);
  const resultPtr = ex.get_search_manga_list(queryRid, 1, filtersRid);
  console.log('resultPtr =', resultPtr);
  if (resultPtr <= 0) { console.log('Resultado no positivo: error del export'); process.exit(2); }
  const len = readBytes(resultPtr, 4).readInt32LE(0);
  console.log('result len (con prefijo) =', len);
  if (len === -1) {
    const realLen = readBytes(resultPtr + 8, 4).readInt32LE(0);
    const errBytes = readBytes(resultPtr + 12, Math.min(realLen, 200));
    console.log('ERROR de la fuente. bytes:', errBytes.toString('hex'));
    process.exit(3);
  }
  const payload = readBytes(resultPtr + 8, len - 8);
  const d = new Dec(payload);
  const result = { entries: d.vec(decManga), has_next_page: d.bool() };
  console.log(`\n== RESULTADO: ${result.entries.length} mangas, has_next_page=${result.has_next_page}, bytes consumidos=${d.p}/${payload.length} ==`);
  const STATUS = ['Unknown', 'Ongoing', 'Completed', 'Cancelled', 'Hiatus'];
  const VIEWER = ['Unknown', 'LTR', 'RTL', 'Vertical', 'Webtoon'];
  for (const m of result.entries.slice(0, 8)) {
    console.log(`- [${m.key.slice(0, 8)}…] ${m.title} | status=${STATUS[m.status]} viewer=${VIEWER[m.viewer]} tags=${m.tags ? m.tags.length : '—'} cover=${m.cover ? 'si' : 'no'}`);
  }
  ex.free_result(resultPtr);
  console.log('free_result OK');

  if (process.argv.includes('--full')) {
    const first = result.entries[0];
    const mangaRid = storeItem({ kind: 'encoded', data: encManga(first) });
    console.log(`\nget_manga_update("${first.title}", details=1, chapters=1)...`);
    const upPtr = ex.get_manga_update(mangaRid, 1, 1);
    const upPayload = readResult(ex, upPtr);
    const ud = new Dec(upPayload);
    const upd = decManga(ud);
    console.log(`== UPDATE: "${upd.title}" | status=${STATUS[upd.status]} rating=${upd.content_rating} viewer=${VIEWER[upd.viewer]} ==`);
    console.log(`   autores=${JSON.stringify(upd.authors)} tags=${upd.tags ? upd.tags.slice(0, 6).join(', ') : '—'}`);
    console.log(`   descripcion: ${(upd.description || '').slice(0, 100)}...`);
    console.log(`   capitulos: ${upd.chapters ? upd.chapters.length : 0} (bytes ${ud.p}/${upPayload.length})`);
    ex.free_result(upPtr);
    if (upd.chapters && upd.chapters.length) {
      const lockCount = upd.chapters.filter(c => c.locked).length;
      console.log(`   [debug] locked=${lockCount}/${upd.chapters.length}; primeros 3 capitulos:`);
      for (const c of upd.chapters.slice(0, 3)) console.log('     ', JSON.stringify(c).slice(0, 220));
    }
    if (upd.chapters && upd.chapters.length) {
      // Capitulo viable: no bloqueado (los 'unavailable'/externos devuelven
      // "Missing chapter data" en el endpoint at-home, con razon).
      const ok = upd.chapters.filter(c => !c.locked);
      const candidates = [
        ...ok.filter(c => c.language === 'en' && c.chapter_number === 1),
        ...ok.filter(c => c.language === 'en'),
        ...ok,
      ].slice(0, 6);
      let done = false;
      for (const ch of candidates) {
        console.log(`\nget_page_list(cap: "${ch.title || ''}" num=${ch.chapter_number} lang=${ch.language})...`);
        const mRid2 = storeItem({ kind: 'encoded', data: encManga(upd) });
        const cRid = storeItem({ kind: 'encoded', data: encChapter(ch) });
        try {
          const pgPtr = ex.get_page_list(mRid2, cRid);
          const pgPayload = readResult(ex, pgPtr);
          const pd = new Dec(pgPayload);
          const pages = pd.vec(decPage);
          console.log(`== PAGINAS: ${pages.length} (bytes ${pd.p}/${pgPayload.length}) ==`);
          for (const p of pages.slice(0, 3)) console.log('   ', p.content.type === 'url' ? p.content.url.slice(0, 110) : JSON.stringify(p.content).slice(0, 110));
          ex.free_result(pgPtr);
          done = true;
          break;
        } catch (e) {
          console.log('   -> sin paginas:', e.message.slice(0, 80));
        }
      }
      if (!done) console.log('Ningun capitulo candidato devolvio paginas');
    }
  }
}
main().catch(e => { console.error('FALLO:', e); process.exit(1); });
