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

// ===== motor HTML (parser + selectores CSS) (lib/html.js) =====
// Motor HTML en JS puro (sin DOM, apto para Web Worker): parser de documentos
// HTML + selectores CSS con la semantica del crate `scraper` (html5ever +
// selectors) que usa el host de referencia de aidoku-rs. Cubre lo que las
// fuentes Aidoku usan de verdad: select / select_first / size / first / last /
// get / attr (con prefijo "abs:") / text, incluidos los pseudo-clases no
// estandar de la familia SwiftSoup `:has()`, `:contains()` y `:containsOwn()`
// que el SDK de aidoku documenta y las fuentes emplean.
// Referencia: spike/aidoku-rs-ref/html.rs y libs-html.rs.
//
// Nodos: { t: 'document'|'element'|'text'|'comment'|'doctype',
//          tag (elementos), attrs: [[nombre, valor]...], children: [],
//          parent, data (texto/comentario), foreign: bool }
// Un "doc" es { root: <nodo document>, baseUrl: string|null }.
// Una referencia a elemento es { doc, node }.

const ENTITIES = {"Aacute":"\u00c1","aacute":"\u00e1","Aacute;":"\u00c1","aacute;":"\u00e1","Abreve;":"\u0102","abreve;":"\u0103","ac;":"\u223e","acd;":"\u223f","acE;":"\u223e\u0333","Acirc":"\u00c2","acirc":"\u00e2","Acirc;":"\u00c2","acirc;":"\u00e2","acute":"\u00b4","acute;":"\u00b4","Acy;":"\u0410","acy;":"\u0430","AElig":"\u00c6","aelig":"\u00e6","AElig;":"\u00c6","aelig;":"\u00e6","af;":"\u2061","Afr;":"\ud835\udd04","afr;":"\ud835\udd1e","Agrave":"\u00c0","agrave":"\u00e0","Agrave;":"\u00c0","agrave;":"\u00e0","alefsym;":"\u2135","aleph;":"\u2135","Alpha;":"\u0391","alpha;":"\u03b1","Amacr;":"\u0100","amacr;":"\u0101","amalg;":"\u2a3f","AMP":"&","amp":"&","AMP;":"&","amp;":"&","And;":"\u2a53","and;":"\u2227","andand;":"\u2a55","andd;":"\u2a5c","andslope;":"\u2a58","andv;":"\u2a5a","ang;":"\u2220","ange;":"\u29a4","angle;":"\u2220","angmsd;":"\u2221","angmsdaa;":"\u29a8","angmsdab;":"\u29a9","angmsdac;":"\u29aa","angmsdad;":"\u29ab","angmsdae;":"\u29ac","angmsdaf;":"\u29ad","angmsdag;":"\u29ae","angmsdah;":"\u29af","angrt;":"\u221f","angrtvb;":"\u22be","angrtvbd;":"\u299d","angsph;":"\u2222","angst;":"\u00c5","angzarr;":"\u237c","Aogon;":"\u0104","aogon;":"\u0105","Aopf;":"\ud835\udd38","aopf;":"\ud835\udd52","ap;":"\u2248","apacir;":"\u2a6f","apE;":"\u2a70","ape;":"\u224a","apid;":"\u224b","apos;":"'","ApplyFunction;":"\u2061","approx;":"\u2248","approxeq;":"\u224a","Aring":"\u00c5","aring":"\u00e5","Aring;":"\u00c5","aring;":"\u00e5","Ascr;":"\ud835\udc9c","ascr;":"\ud835\udcb6","Assign;":"\u2254","ast;":"*","asymp;":"\u2248","asympeq;":"\u224d","Atilde":"\u00c3","atilde":"\u00e3","Atilde;":"\u00c3","atilde;":"\u00e3","Auml":"\u00c4","auml":"\u00e4","Auml;":"\u00c4","auml;":"\u00e4","awconint;":"\u2233","awint;":"\u2a11","backcong;":"\u224c","backepsilon;":"\u03f6","backprime;":"\u2035","backsim;":"\u223d","backsimeq;":"\u22cd","Backslash;":"\u2216","Barv;":"\u2ae7","barvee;":"\u22bd","Barwed;":"\u2306","barwed;":"\u2305","barwedge;":"\u2305","bbrk;":"\u23b5","bbrktbrk;":"\u23b6","bcong;":"\u224c","Bcy;":"\u0411","bcy;":"\u0431","bdquo;":"\u201e","becaus;":"\u2235","Because;":"\u2235","because;":"\u2235","bemptyv;":"\u29b0","bepsi;":"\u03f6","bernou;":"\u212c","Bernoullis;":"\u212c","Beta;":"\u0392","beta;":"\u03b2","beth;":"\u2136","between;":"\u226c","Bfr;":"\ud835\udd05","bfr;":"\ud835\udd1f","bigcap;":"\u22c2","bigcirc;":"\u25ef","bigcup;":"\u22c3","bigodot;":"\u2a00","bigoplus;":"\u2a01","bigotimes;":"\u2a02","bigsqcup;":"\u2a06","bigstar;":"\u2605","bigtriangledown;":"\u25bd","bigtriangleup;":"\u25b3","biguplus;":"\u2a04","bigvee;":"\u22c1","bigwedge;":"\u22c0","bkarow;":"\u290d","blacklozenge;":"\u29eb","blacksquare;":"\u25aa","blacktriangle;":"\u25b4","blacktriangledown;":"\u25be","blacktriangleleft;":"\u25c2","blacktriangleright;":"\u25b8","blank;":"\u2423","blk12;":"\u2592","blk14;":"\u2591","blk34;":"\u2593","block;":"\u2588","bne;":"=\u20e5","bnequiv;":"\u2261\u20e5","bNot;":"\u2aed","bnot;":"\u2310","Bopf;":"\ud835\udd39","bopf;":"\ud835\udd53","bot;":"\u22a5","bottom;":"\u22a5","bowtie;":"\u22c8","boxbox;":"\u29c9","boxDL;":"\u2557","boxDl;":"\u2556","boxdL;":"\u2555","boxdl;":"\u2510","boxDR;":"\u2554","boxDr;":"\u2553","boxdR;":"\u2552","boxdr;":"\u250c","boxH;":"\u2550","boxh;":"\u2500","boxHD;":"\u2566","boxHd;":"\u2564","boxhD;":"\u2565","boxhd;":"\u252c","boxHU;":"\u2569","boxHu;":"\u2567","boxhU;":"\u2568","boxhu;":"\u2534","boxminus;":"\u229f","boxplus;":"\u229e","boxtimes;":"\u22a0","boxUL;":"\u255d","boxUl;":"\u255c","boxuL;":"\u255b","boxul;":"\u2518","boxUR;":"\u255a","boxUr;":"\u2559","boxuR;":"\u2558","boxur;":"\u2514","boxV;":"\u2551","boxv;":"\u2502","boxVH;":"\u256c","boxVh;":"\u256b","boxvH;":"\u256a","boxvh;":"\u253c","boxVL;":"\u2563","boxVl;":"\u2562","boxvL;":"\u2561","boxvl;":"\u2524","boxVR;":"\u2560","boxVr;":"\u255f","boxvR;":"\u255e","boxvr;":"\u251c","bprime;":"\u2035","Breve;":"\u02d8","breve;":"\u02d8","brvbar":"\u00a6","brvbar;":"\u00a6","Bscr;":"\u212c","bscr;":"\ud835\udcb7","bsemi;":"\u204f","bsim;":"\u223d","bsime;":"\u22cd","bsol;":"\\","bsolb;":"\u29c5","bsolhsub;":"\u27c8","bull;":"\u2022","bullet;":"\u2022","bump;":"\u224e","bumpE;":"\u2aae","bumpe;":"\u224f","Bumpeq;":"\u224e","bumpeq;":"\u224f","Cacute;":"\u0106","cacute;":"\u0107","Cap;":"\u22d2","cap;":"\u2229","capand;":"\u2a44","capbrcup;":"\u2a49","capcap;":"\u2a4b","capcup;":"\u2a47","capdot;":"\u2a40","CapitalDifferentialD;":"\u2145","caps;":"\u2229\ufe00","caret;":"\u2041","caron;":"\u02c7","Cayleys;":"\u212d","ccaps;":"\u2a4d","Ccaron;":"\u010c","ccaron;":"\u010d","Ccedil":"\u00c7","ccedil":"\u00e7","Ccedil;":"\u00c7","ccedil;":"\u00e7","Ccirc;":"\u0108","ccirc;":"\u0109","Cconint;":"\u2230","ccups;":"\u2a4c","ccupssm;":"\u2a50","Cdot;":"\u010a","cdot;":"\u010b","cedil":"\u00b8","cedil;":"\u00b8","Cedilla;":"\u00b8","cemptyv;":"\u29b2","cent":"\u00a2","cent;":"\u00a2","CenterDot;":"\u00b7","centerdot;":"\u00b7","Cfr;":"\u212d","cfr;":"\ud835\udd20","CHcy;":"\u0427","chcy;":"\u0447","check;":"\u2713","checkmark;":"\u2713","Chi;":"\u03a7","chi;":"\u03c7","cir;":"\u25cb","circ;":"\u02c6","circeq;":"\u2257","circlearrowleft;":"\u21ba","circlearrowright;":"\u21bb","circledast;":"\u229b","circledcirc;":"\u229a","circleddash;":"\u229d","CircleDot;":"\u2299","circledR;":"\u00ae","circledS;":"\u24c8","CircleMinus;":"\u2296","CirclePlus;":"\u2295","CircleTimes;":"\u2297","cirE;":"\u29c3","cire;":"\u2257","cirfnint;":"\u2a10","cirmid;":"\u2aef","cirscir;":"\u29c2","ClockwiseContourIntegral;":"\u2232","CloseCurlyDoubleQuote;":"\u201d","CloseCurlyQuote;":"\u2019","clubs;":"\u2663","clubsuit;":"\u2663","Colon;":"\u2237","colon;":":","Colone;":"\u2a74","colone;":"\u2254","coloneq;":"\u2254","comma;":",","commat;":"@","comp;":"\u2201","compfn;":"\u2218","complement;":"\u2201","complexes;":"\u2102","cong;":"\u2245","congdot;":"\u2a6d","Congruent;":"\u2261","Conint;":"\u222f","conint;":"\u222e","ContourIntegral;":"\u222e","Copf;":"\u2102","copf;":"\ud835\udd54","coprod;":"\u2210","Coproduct;":"\u2210","COPY":"\u00a9","copy":"\u00a9","COPY;":"\u00a9","copy;":"\u00a9","copysr;":"\u2117","CounterClockwiseContourIntegral;":"\u2233","crarr;":"\u21b5","Cross;":"\u2a2f","cross;":"\u2717","Cscr;":"\ud835\udc9e","cscr;":"\ud835\udcb8","csub;":"\u2acf","csube;":"\u2ad1","csup;":"\u2ad0","csupe;":"\u2ad2","ctdot;":"\u22ef","cudarrl;":"\u2938","cudarrr;":"\u2935","cuepr;":"\u22de","cuesc;":"\u22df","cularr;":"\u21b6","cularrp;":"\u293d","Cup;":"\u22d3","cup;":"\u222a","cupbrcap;":"\u2a48","CupCap;":"\u224d","cupcap;":"\u2a46","cupcup;":"\u2a4a","cupdot;":"\u228d","cupor;":"\u2a45","cups;":"\u222a\ufe00","curarr;":"\u21b7","curarrm;":"\u293c","curlyeqprec;":"\u22de","curlyeqsucc;":"\u22df","curlyvee;":"\u22ce","curlywedge;":"\u22cf","curren":"\u00a4","curren;":"\u00a4","curvearrowleft;":"\u21b6","curvearrowright;":"\u21b7","cuvee;":"\u22ce","cuwed;":"\u22cf","cwconint;":"\u2232","cwint;":"\u2231","cylcty;":"\u232d","Dagger;":"\u2021","dagger;":"\u2020","daleth;":"\u2138","Darr;":"\u21a1","dArr;":"\u21d3","darr;":"\u2193","dash;":"\u2010","Dashv;":"\u2ae4","dashv;":"\u22a3","dbkarow;":"\u290f","dblac;":"\u02dd","Dcaron;":"\u010e","dcaron;":"\u010f","Dcy;":"\u0414","dcy;":"\u0434","DD;":"\u2145","dd;":"\u2146","ddagger;":"\u2021","ddarr;":"\u21ca","DDotrahd;":"\u2911","ddotseq;":"\u2a77","deg":"\u00b0","deg;":"\u00b0","Del;":"\u2207","Delta;":"\u0394","delta;":"\u03b4","demptyv;":"\u29b1","dfisht;":"\u297f","Dfr;":"\ud835\udd07","dfr;":"\ud835\udd21","dHar;":"\u2965","dharl;":"\u21c3","dharr;":"\u21c2","DiacriticalAcute;":"\u00b4","DiacriticalDot;":"\u02d9","DiacriticalDoubleAcute;":"\u02dd","DiacriticalGrave;":"`","DiacriticalTilde;":"\u02dc","diam;":"\u22c4","Diamond;":"\u22c4","diamond;":"\u22c4","diamondsuit;":"\u2666","diams;":"\u2666","die;":"\u00a8","DifferentialD;":"\u2146","digamma;":"\u03dd","disin;":"\u22f2","div;":"\u00f7","divide":"\u00f7","divide;":"\u00f7","divideontimes;":"\u22c7","divonx;":"\u22c7","DJcy;":"\u0402","djcy;":"\u0452","dlcorn;":"\u231e","dlcrop;":"\u230d","dollar;":"$","Dopf;":"\ud835\udd3b","dopf;":"\ud835\udd55","Dot;":"\u00a8","dot;":"\u02d9","DotDot;":"\u20dc","doteq;":"\u2250","doteqdot;":"\u2251","DotEqual;":"\u2250","dotminus;":"\u2238","dotplus;":"\u2214","dotsquare;":"\u22a1","doublebarwedge;":"\u2306","DoubleContourIntegral;":"\u222f","DoubleDot;":"\u00a8","DoubleDownArrow;":"\u21d3","DoubleLeftArrow;":"\u21d0","DoubleLeftRightArrow;":"\u21d4","DoubleLeftTee;":"\u2ae4","DoubleLongLeftArrow;":"\u27f8","DoubleLongLeftRightArrow;":"\u27fa","DoubleLongRightArrow;":"\u27f9","DoubleRightArrow;":"\u21d2","DoubleRightTee;":"\u22a8","DoubleUpArrow;":"\u21d1","DoubleUpDownArrow;":"\u21d5","DoubleVerticalBar;":"\u2225","DownArrow;":"\u2193","Downarrow;":"\u21d3","downarrow;":"\u2193","DownArrowBar;":"\u2913","DownArrowUpArrow;":"\u21f5","DownBreve;":"\u0311","downdownarrows;":"\u21ca","downharpoonleft;":"\u21c3","downharpoonright;":"\u21c2","DownLeftRightVector;":"\u2950","DownLeftTeeVector;":"\u295e","DownLeftVector;":"\u21bd","DownLeftVectorBar;":"\u2956","DownRightTeeVector;":"\u295f","DownRightVector;":"\u21c1","DownRightVectorBar;":"\u2957","DownTee;":"\u22a4","DownTeeArrow;":"\u21a7","drbkarow;":"\u2910","drcorn;":"\u231f","drcrop;":"\u230c","Dscr;":"\ud835\udc9f","dscr;":"\ud835\udcb9","DScy;":"\u0405","dscy;":"\u0455","dsol;":"\u29f6","Dstrok;":"\u0110","dstrok;":"\u0111","dtdot;":"\u22f1","dtri;":"\u25bf","dtrif;":"\u25be","duarr;":"\u21f5","duhar;":"\u296f","dwangle;":"\u29a6","DZcy;":"\u040f","dzcy;":"\u045f","dzigrarr;":"\u27ff","Eacute":"\u00c9","eacute":"\u00e9","Eacute;":"\u00c9","eacute;":"\u00e9","easter;":"\u2a6e","Ecaron;":"\u011a","ecaron;":"\u011b","ecir;":"\u2256","Ecirc":"\u00ca","ecirc":"\u00ea","Ecirc;":"\u00ca","ecirc;":"\u00ea","ecolon;":"\u2255","Ecy;":"\u042d","ecy;":"\u044d","eDDot;":"\u2a77","Edot;":"\u0116","eDot;":"\u2251","edot;":"\u0117","ee;":"\u2147","efDot;":"\u2252","Efr;":"\ud835\udd08","efr;":"\ud835\udd22","eg;":"\u2a9a","Egrave":"\u00c8","egrave":"\u00e8","Egrave;":"\u00c8","egrave;":"\u00e8","egs;":"\u2a96","egsdot;":"\u2a98","el;":"\u2a99","Element;":"\u2208","elinters;":"\u23e7","ell;":"\u2113","els;":"\u2a95","elsdot;":"\u2a97","Emacr;":"\u0112","emacr;":"\u0113","empty;":"\u2205","emptyset;":"\u2205","EmptySmallSquare;":"\u25fb","emptyv;":"\u2205","EmptyVerySmallSquare;":"\u25ab","emsp13;":"\u2004","emsp14;":"\u2005","emsp;":"\u2003","ENG;":"\u014a","eng;":"\u014b","ensp;":"\u2002","Eogon;":"\u0118","eogon;":"\u0119","Eopf;":"\ud835\udd3c","eopf;":"\ud835\udd56","epar;":"\u22d5","eparsl;":"\u29e3","eplus;":"\u2a71","epsi;":"\u03b5","Epsilon;":"\u0395","epsilon;":"\u03b5","epsiv;":"\u03f5","eqcirc;":"\u2256","eqcolon;":"\u2255","eqsim;":"\u2242","eqslantgtr;":"\u2a96","eqslantless;":"\u2a95","Equal;":"\u2a75","equals;":"=","EqualTilde;":"\u2242","equest;":"\u225f","Equilibrium;":"\u21cc","equiv;":"\u2261","equivDD;":"\u2a78","eqvparsl;":"\u29e5","erarr;":"\u2971","erDot;":"\u2253","Escr;":"\u2130","escr;":"\u212f","esdot;":"\u2250","Esim;":"\u2a73","esim;":"\u2242","Eta;":"\u0397","eta;":"\u03b7","ETH":"\u00d0","eth":"\u00f0","ETH;":"\u00d0","eth;":"\u00f0","Euml":"\u00cb","euml":"\u00eb","Euml;":"\u00cb","euml;":"\u00eb","euro;":"\u20ac","excl;":"!","exist;":"\u2203","Exists;":"\u2203","expectation;":"\u2130","ExponentialE;":"\u2147","exponentiale;":"\u2147","fallingdotseq;":"\u2252","Fcy;":"\u0424","fcy;":"\u0444","female;":"\u2640","ffilig;":"\ufb03","fflig;":"\ufb00","ffllig;":"\ufb04","Ffr;":"\ud835\udd09","ffr;":"\ud835\udd23","filig;":"\ufb01","FilledSmallSquare;":"\u25fc","FilledVerySmallSquare;":"\u25aa","fjlig;":"fj","flat;":"\u266d","fllig;":"\ufb02","fltns;":"\u25b1","fnof;":"\u0192","Fopf;":"\ud835\udd3d","fopf;":"\ud835\udd57","ForAll;":"\u2200","forall;":"\u2200","fork;":"\u22d4","forkv;":"\u2ad9","Fouriertrf;":"\u2131","fpartint;":"\u2a0d","frac12":"\u00bd","frac12;":"\u00bd","frac13;":"\u2153","frac14":"\u00bc","frac14;":"\u00bc","frac15;":"\u2155","frac16;":"\u2159","frac18;":"\u215b","frac23;":"\u2154","frac25;":"\u2156","frac34":"\u00be","frac34;":"\u00be","frac35;":"\u2157","frac38;":"\u215c","frac45;":"\u2158","frac56;":"\u215a","frac58;":"\u215d","frac78;":"\u215e","frasl;":"\u2044","frown;":"\u2322","Fscr;":"\u2131","fscr;":"\ud835\udcbb","gacute;":"\u01f5","Gamma;":"\u0393","gamma;":"\u03b3","Gammad;":"\u03dc","gammad;":"\u03dd","gap;":"\u2a86","Gbreve;":"\u011e","gbreve;":"\u011f","Gcedil;":"\u0122","Gcirc;":"\u011c","gcirc;":"\u011d","Gcy;":"\u0413","gcy;":"\u0433","Gdot;":"\u0120","gdot;":"\u0121","gE;":"\u2267","ge;":"\u2265","gEl;":"\u2a8c","gel;":"\u22db","geq;":"\u2265","geqq;":"\u2267","geqslant;":"\u2a7e","ges;":"\u2a7e","gescc;":"\u2aa9","gesdot;":"\u2a80","gesdoto;":"\u2a82","gesdotol;":"\u2a84","gesl;":"\u22db\ufe00","gesles;":"\u2a94","Gfr;":"\ud835\udd0a","gfr;":"\ud835\udd24","Gg;":"\u22d9","gg;":"\u226b","ggg;":"\u22d9","gimel;":"\u2137","GJcy;":"\u0403","gjcy;":"\u0453","gl;":"\u2277","gla;":"\u2aa5","glE;":"\u2a92","glj;":"\u2aa4","gnap;":"\u2a8a","gnapprox;":"\u2a8a","gnE;":"\u2269","gne;":"\u2a88","gneq;":"\u2a88","gneqq;":"\u2269","gnsim;":"\u22e7","Gopf;":"\ud835\udd3e","gopf;":"\ud835\udd58","grave;":"`","GreaterEqual;":"\u2265","GreaterEqualLess;":"\u22db","GreaterFullEqual;":"\u2267","GreaterGreater;":"\u2aa2","GreaterLess;":"\u2277","GreaterSlantEqual;":"\u2a7e","GreaterTilde;":"\u2273","Gscr;":"\ud835\udca2","gscr;":"\u210a","gsim;":"\u2273","gsime;":"\u2a8e","gsiml;":"\u2a90","GT":">","gt":">","GT;":">","Gt;":"\u226b","gt;":">","gtcc;":"\u2aa7","gtcir;":"\u2a7a","gtdot;":"\u22d7","gtlPar;":"\u2995","gtquest;":"\u2a7c","gtrapprox;":"\u2a86","gtrarr;":"\u2978","gtrdot;":"\u22d7","gtreqless;":"\u22db","gtreqqless;":"\u2a8c","gtrless;":"\u2277","gtrsim;":"\u2273","gvertneqq;":"\u2269\ufe00","gvnE;":"\u2269\ufe00","Hacek;":"\u02c7","hairsp;":"\u200a","half;":"\u00bd","hamilt;":"\u210b","HARDcy;":"\u042a","hardcy;":"\u044a","hArr;":"\u21d4","harr;":"\u2194","harrcir;":"\u2948","harrw;":"\u21ad","Hat;":"^","hbar;":"\u210f","Hcirc;":"\u0124","hcirc;":"\u0125","hearts;":"\u2665","heartsuit;":"\u2665","hellip;":"\u2026","hercon;":"\u22b9","Hfr;":"\u210c","hfr;":"\ud835\udd25","HilbertSpace;":"\u210b","hksearow;":"\u2925","hkswarow;":"\u2926","hoarr;":"\u21ff","homtht;":"\u223b","hookleftarrow;":"\u21a9","hookrightarrow;":"\u21aa","Hopf;":"\u210d","hopf;":"\ud835\udd59","horbar;":"\u2015","HorizontalLine;":"\u2500","Hscr;":"\u210b","hscr;":"\ud835\udcbd","hslash;":"\u210f","Hstrok;":"\u0126","hstrok;":"\u0127","HumpDownHump;":"\u224e","HumpEqual;":"\u224f","hybull;":"\u2043","hyphen;":"\u2010","Iacute":"\u00cd","iacute":"\u00ed","Iacute;":"\u00cd","iacute;":"\u00ed","ic;":"\u2063","Icirc":"\u00ce","icirc":"\u00ee","Icirc;":"\u00ce","icirc;":"\u00ee","Icy;":"\u0418","icy;":"\u0438","Idot;":"\u0130","IEcy;":"\u0415","iecy;":"\u0435","iexcl":"\u00a1","iexcl;":"\u00a1","iff;":"\u21d4","Ifr;":"\u2111","ifr;":"\ud835\udd26","Igrave":"\u00cc","igrave":"\u00ec","Igrave;":"\u00cc","igrave;":"\u00ec","ii;":"\u2148","iiiint;":"\u2a0c","iiint;":"\u222d","iinfin;":"\u29dc","iiota;":"\u2129","IJlig;":"\u0132","ijlig;":"\u0133","Im;":"\u2111","Imacr;":"\u012a","imacr;":"\u012b","image;":"\u2111","ImaginaryI;":"\u2148","imagline;":"\u2110","imagpart;":"\u2111","imath;":"\u0131","imof;":"\u22b7","imped;":"\u01b5","Implies;":"\u21d2","in;":"\u2208","incare;":"\u2105","infin;":"\u221e","infintie;":"\u29dd","inodot;":"\u0131","Int;":"\u222c","int;":"\u222b","intcal;":"\u22ba","integers;":"\u2124","Integral;":"\u222b","intercal;":"\u22ba","Intersection;":"\u22c2","intlarhk;":"\u2a17","intprod;":"\u2a3c","InvisibleComma;":"\u2063","InvisibleTimes;":"\u2062","IOcy;":"\u0401","iocy;":"\u0451","Iogon;":"\u012e","iogon;":"\u012f","Iopf;":"\ud835\udd40","iopf;":"\ud835\udd5a","Iota;":"\u0399","iota;":"\u03b9","iprod;":"\u2a3c","iquest":"\u00bf","iquest;":"\u00bf","Iscr;":"\u2110","iscr;":"\ud835\udcbe","isin;":"\u2208","isindot;":"\u22f5","isinE;":"\u22f9","isins;":"\u22f4","isinsv;":"\u22f3","isinv;":"\u2208","it;":"\u2062","Itilde;":"\u0128","itilde;":"\u0129","Iukcy;":"\u0406","iukcy;":"\u0456","Iuml":"\u00cf","iuml":"\u00ef","Iuml;":"\u00cf","iuml;":"\u00ef","Jcirc;":"\u0134","jcirc;":"\u0135","Jcy;":"\u0419","jcy;":"\u0439","Jfr;":"\ud835\udd0d","jfr;":"\ud835\udd27","jmath;":"\u0237","Jopf;":"\ud835\udd41","jopf;":"\ud835\udd5b","Jscr;":"\ud835\udca5","jscr;":"\ud835\udcbf","Jsercy;":"\u0408","jsercy;":"\u0458","Jukcy;":"\u0404","jukcy;":"\u0454","Kappa;":"\u039a","kappa;":"\u03ba","kappav;":"\u03f0","Kcedil;":"\u0136","kcedil;":"\u0137","Kcy;":"\u041a","kcy;":"\u043a","Kfr;":"\ud835\udd0e","kfr;":"\ud835\udd28","kgreen;":"\u0138","KHcy;":"\u0425","khcy;":"\u0445","KJcy;":"\u040c","kjcy;":"\u045c","Kopf;":"\ud835\udd42","kopf;":"\ud835\udd5c","Kscr;":"\ud835\udca6","kscr;":"\ud835\udcc0","lAarr;":"\u21da","Lacute;":"\u0139","lacute;":"\u013a","laemptyv;":"\u29b4","lagran;":"\u2112","Lambda;":"\u039b","lambda;":"\u03bb","Lang;":"\u27ea","lang;":"\u27e8","langd;":"\u2991","langle;":"\u27e8","lap;":"\u2a85","Laplacetrf;":"\u2112","laquo":"\u00ab","laquo;":"\u00ab","Larr;":"\u219e","lArr;":"\u21d0","larr;":"\u2190","larrb;":"\u21e4","larrbfs;":"\u291f","larrfs;":"\u291d","larrhk;":"\u21a9","larrlp;":"\u21ab","larrpl;":"\u2939","larrsim;":"\u2973","larrtl;":"\u21a2","lat;":"\u2aab","lAtail;":"\u291b","latail;":"\u2919","late;":"\u2aad","lates;":"\u2aad\ufe00","lBarr;":"\u290e","lbarr;":"\u290c","lbbrk;":"\u2772","lbrace;":"{","lbrack;":"[","lbrke;":"\u298b","lbrksld;":"\u298f","lbrkslu;":"\u298d","Lcaron;":"\u013d","lcaron;":"\u013e","Lcedil;":"\u013b","lcedil;":"\u013c","lceil;":"\u2308","lcub;":"{","Lcy;":"\u041b","lcy;":"\u043b","ldca;":"\u2936","ldquo;":"\u201c","ldquor;":"\u201e","ldrdhar;":"\u2967","ldrushar;":"\u294b","ldsh;":"\u21b2","lE;":"\u2266","le;":"\u2264","LeftAngleBracket;":"\u27e8","LeftArrow;":"\u2190","Leftarrow;":"\u21d0","leftarrow;":"\u2190","LeftArrowBar;":"\u21e4","LeftArrowRightArrow;":"\u21c6","leftarrowtail;":"\u21a2","LeftCeiling;":"\u2308","LeftDoubleBracket;":"\u27e6","LeftDownTeeVector;":"\u2961","LeftDownVector;":"\u21c3","LeftDownVectorBar;":"\u2959","LeftFloor;":"\u230a","leftharpoondown;":"\u21bd","leftharpoonup;":"\u21bc","leftleftarrows;":"\u21c7","LeftRightArrow;":"\u2194","Leftrightarrow;":"\u21d4","leftrightarrow;":"\u2194","leftrightarrows;":"\u21c6","leftrightharpoons;":"\u21cb","leftrightsquigarrow;":"\u21ad","LeftRightVector;":"\u294e","LeftTee;":"\u22a3","LeftTeeArrow;":"\u21a4","LeftTeeVector;":"\u295a","leftthreetimes;":"\u22cb","LeftTriangle;":"\u22b2","LeftTriangleBar;":"\u29cf","LeftTriangleEqual;":"\u22b4","LeftUpDownVector;":"\u2951","LeftUpTeeVector;":"\u2960","LeftUpVector;":"\u21bf","LeftUpVectorBar;":"\u2958","LeftVector;":"\u21bc","LeftVectorBar;":"\u2952","lEg;":"\u2a8b","leg;":"\u22da","leq;":"\u2264","leqq;":"\u2266","leqslant;":"\u2a7d","les;":"\u2a7d","lescc;":"\u2aa8","lesdot;":"\u2a7f","lesdoto;":"\u2a81","lesdotor;":"\u2a83","lesg;":"\u22da\ufe00","lesges;":"\u2a93","lessapprox;":"\u2a85","lessdot;":"\u22d6","lesseqgtr;":"\u22da","lesseqqgtr;":"\u2a8b","LessEqualGreater;":"\u22da","LessFullEqual;":"\u2266","LessGreater;":"\u2276","lessgtr;":"\u2276","LessLess;":"\u2aa1","lesssim;":"\u2272","LessSlantEqual;":"\u2a7d","LessTilde;":"\u2272","lfisht;":"\u297c","lfloor;":"\u230a","Lfr;":"\ud835\udd0f","lfr;":"\ud835\udd29","lg;":"\u2276","lgE;":"\u2a91","lHar;":"\u2962","lhard;":"\u21bd","lharu;":"\u21bc","lharul;":"\u296a","lhblk;":"\u2584","LJcy;":"\u0409","ljcy;":"\u0459","Ll;":"\u22d8","ll;":"\u226a","llarr;":"\u21c7","llcorner;":"\u231e","Lleftarrow;":"\u21da","llhard;":"\u296b","lltri;":"\u25fa","Lmidot;":"\u013f","lmidot;":"\u0140","lmoust;":"\u23b0","lmoustache;":"\u23b0","lnap;":"\u2a89","lnapprox;":"\u2a89","lnE;":"\u2268","lne;":"\u2a87","lneq;":"\u2a87","lneqq;":"\u2268","lnsim;":"\u22e6","loang;":"\u27ec","loarr;":"\u21fd","lobrk;":"\u27e6","LongLeftArrow;":"\u27f5","Longleftarrow;":"\u27f8","longleftarrow;":"\u27f5","LongLeftRightArrow;":"\u27f7","Longleftrightarrow;":"\u27fa","longleftrightarrow;":"\u27f7","longmapsto;":"\u27fc","LongRightArrow;":"\u27f6","Longrightarrow;":"\u27f9","longrightarrow;":"\u27f6","looparrowleft;":"\u21ab","looparrowright;":"\u21ac","lopar;":"\u2985","Lopf;":"\ud835\udd43","lopf;":"\ud835\udd5d","loplus;":"\u2a2d","lotimes;":"\u2a34","lowast;":"\u2217","lowbar;":"_","LowerLeftArrow;":"\u2199","LowerRightArrow;":"\u2198","loz;":"\u25ca","lozenge;":"\u25ca","lozf;":"\u29eb","lpar;":"(","lparlt;":"\u2993","lrarr;":"\u21c6","lrcorner;":"\u231f","lrhar;":"\u21cb","lrhard;":"\u296d","lrm;":"\u200e","lrtri;":"\u22bf","lsaquo;":"\u2039","Lscr;":"\u2112","lscr;":"\ud835\udcc1","Lsh;":"\u21b0","lsh;":"\u21b0","lsim;":"\u2272","lsime;":"\u2a8d","lsimg;":"\u2a8f","lsqb;":"[","lsquo;":"\u2018","lsquor;":"\u201a","Lstrok;":"\u0141","lstrok;":"\u0142","LT":"<","lt":"<","LT;":"<","Lt;":"\u226a","lt;":"<","ltcc;":"\u2aa6","ltcir;":"\u2a79","ltdot;":"\u22d6","lthree;":"\u22cb","ltimes;":"\u22c9","ltlarr;":"\u2976","ltquest;":"\u2a7b","ltri;":"\u25c3","ltrie;":"\u22b4","ltrif;":"\u25c2","ltrPar;":"\u2996","lurdshar;":"\u294a","luruhar;":"\u2966","lvertneqq;":"\u2268\ufe00","lvnE;":"\u2268\ufe00","macr":"\u00af","macr;":"\u00af","male;":"\u2642","malt;":"\u2720","maltese;":"\u2720","Map;":"\u2905","map;":"\u21a6","mapsto;":"\u21a6","mapstodown;":"\u21a7","mapstoleft;":"\u21a4","mapstoup;":"\u21a5","marker;":"\u25ae","mcomma;":"\u2a29","Mcy;":"\u041c","mcy;":"\u043c","mdash;":"\u2014","mDDot;":"\u223a","measuredangle;":"\u2221","MediumSpace;":"\u205f","Mellintrf;":"\u2133","Mfr;":"\ud835\udd10","mfr;":"\ud835\udd2a","mho;":"\u2127","micro":"\u00b5","micro;":"\u00b5","mid;":"\u2223","midast;":"*","midcir;":"\u2af0","middot":"\u00b7","middot;":"\u00b7","minus;":"\u2212","minusb;":"\u229f","minusd;":"\u2238","minusdu;":"\u2a2a","MinusPlus;":"\u2213","mlcp;":"\u2adb","mldr;":"\u2026","mnplus;":"\u2213","models;":"\u22a7","Mopf;":"\ud835\udd44","mopf;":"\ud835\udd5e","mp;":"\u2213","Mscr;":"\u2133","mscr;":"\ud835\udcc2","mstpos;":"\u223e","Mu;":"\u039c","mu;":"\u03bc","multimap;":"\u22b8","mumap;":"\u22b8","nabla;":"\u2207","Nacute;":"\u0143","nacute;":"\u0144","nang;":"\u2220\u20d2","nap;":"\u2249","napE;":"\u2a70\u0338","napid;":"\u224b\u0338","napos;":"\u0149","napprox;":"\u2249","natur;":"\u266e","natural;":"\u266e","naturals;":"\u2115","nbsp":"\u00a0","nbsp;":"\u00a0","nbump;":"\u224e\u0338","nbumpe;":"\u224f\u0338","ncap;":"\u2a43","Ncaron;":"\u0147","ncaron;":"\u0148","Ncedil;":"\u0145","ncedil;":"\u0146","ncong;":"\u2247","ncongdot;":"\u2a6d\u0338","ncup;":"\u2a42","Ncy;":"\u041d","ncy;":"\u043d","ndash;":"\u2013","ne;":"\u2260","nearhk;":"\u2924","neArr;":"\u21d7","nearr;":"\u2197","nearrow;":"\u2197","nedot;":"\u2250\u0338","NegativeMediumSpace;":"\u200b","NegativeThickSpace;":"\u200b","NegativeThinSpace;":"\u200b","NegativeVeryThinSpace;":"\u200b","nequiv;":"\u2262","nesear;":"\u2928","nesim;":"\u2242\u0338","NestedGreaterGreater;":"\u226b","NestedLessLess;":"\u226a","NewLine;":"\n","nexist;":"\u2204","nexists;":"\u2204","Nfr;":"\ud835\udd11","nfr;":"\ud835\udd2b","ngE;":"\u2267\u0338","nge;":"\u2271","ngeq;":"\u2271","ngeqq;":"\u2267\u0338","ngeqslant;":"\u2a7e\u0338","nges;":"\u2a7e\u0338","nGg;":"\u22d9\u0338","ngsim;":"\u2275","nGt;":"\u226b\u20d2","ngt;":"\u226f","ngtr;":"\u226f","nGtv;":"\u226b\u0338","nhArr;":"\u21ce","nharr;":"\u21ae","nhpar;":"\u2af2","ni;":"\u220b","nis;":"\u22fc","nisd;":"\u22fa","niv;":"\u220b","NJcy;":"\u040a","njcy;":"\u045a","nlArr;":"\u21cd","nlarr;":"\u219a","nldr;":"\u2025","nlE;":"\u2266\u0338","nle;":"\u2270","nLeftarrow;":"\u21cd","nleftarrow;":"\u219a","nLeftrightarrow;":"\u21ce","nleftrightarrow;":"\u21ae","nleq;":"\u2270","nleqq;":"\u2266\u0338","nleqslant;":"\u2a7d\u0338","nles;":"\u2a7d\u0338","nless;":"\u226e","nLl;":"\u22d8\u0338","nlsim;":"\u2274","nLt;":"\u226a\u20d2","nlt;":"\u226e","nltri;":"\u22ea","nltrie;":"\u22ec","nLtv;":"\u226a\u0338","nmid;":"\u2224","NoBreak;":"\u2060","NonBreakingSpace;":"\u00a0","Nopf;":"\u2115","nopf;":"\ud835\udd5f","not":"\u00ac","Not;":"\u2aec","not;":"\u00ac","NotCongruent;":"\u2262","NotCupCap;":"\u226d","NotDoubleVerticalBar;":"\u2226","NotElement;":"\u2209","NotEqual;":"\u2260","NotEqualTilde;":"\u2242\u0338","NotExists;":"\u2204","NotGreater;":"\u226f","NotGreaterEqual;":"\u2271","NotGreaterFullEqual;":"\u2267\u0338","NotGreaterGreater;":"\u226b\u0338","NotGreaterLess;":"\u2279","NotGreaterSlantEqual;":"\u2a7e\u0338","NotGreaterTilde;":"\u2275","NotHumpDownHump;":"\u224e\u0338","NotHumpEqual;":"\u224f\u0338","notin;":"\u2209","notindot;":"\u22f5\u0338","notinE;":"\u22f9\u0338","notinva;":"\u2209","notinvb;":"\u22f7","notinvc;":"\u22f6","NotLeftTriangle;":"\u22ea","NotLeftTriangleBar;":"\u29cf\u0338","NotLeftTriangleEqual;":"\u22ec","NotLess;":"\u226e","NotLessEqual;":"\u2270","NotLessGreater;":"\u2278","NotLessLess;":"\u226a\u0338","NotLessSlantEqual;":"\u2a7d\u0338","NotLessTilde;":"\u2274","NotNestedGreaterGreater;":"\u2aa2\u0338","NotNestedLessLess;":"\u2aa1\u0338","notni;":"\u220c","notniva;":"\u220c","notnivb;":"\u22fe","notnivc;":"\u22fd","NotPrecedes;":"\u2280","NotPrecedesEqual;":"\u2aaf\u0338","NotPrecedesSlantEqual;":"\u22e0","NotReverseElement;":"\u220c","NotRightTriangle;":"\u22eb","NotRightTriangleBar;":"\u29d0\u0338","NotRightTriangleEqual;":"\u22ed","NotSquareSubset;":"\u228f\u0338","NotSquareSubsetEqual;":"\u22e2","NotSquareSuperset;":"\u2290\u0338","NotSquareSupersetEqual;":"\u22e3","NotSubset;":"\u2282\u20d2","NotSubsetEqual;":"\u2288","NotSucceeds;":"\u2281","NotSucceedsEqual;":"\u2ab0\u0338","NotSucceedsSlantEqual;":"\u22e1","NotSucceedsTilde;":"\u227f\u0338","NotSuperset;":"\u2283\u20d2","NotSupersetEqual;":"\u2289","NotTilde;":"\u2241","NotTildeEqual;":"\u2244","NotTildeFullEqual;":"\u2247","NotTildeTilde;":"\u2249","NotVerticalBar;":"\u2224","npar;":"\u2226","nparallel;":"\u2226","nparsl;":"\u2afd\u20e5","npart;":"\u2202\u0338","npolint;":"\u2a14","npr;":"\u2280","nprcue;":"\u22e0","npre;":"\u2aaf\u0338","nprec;":"\u2280","npreceq;":"\u2aaf\u0338","nrArr;":"\u21cf","nrarr;":"\u219b","nrarrc;":"\u2933\u0338","nrarrw;":"\u219d\u0338","nRightarrow;":"\u21cf","nrightarrow;":"\u219b","nrtri;":"\u22eb","nrtrie;":"\u22ed","nsc;":"\u2281","nsccue;":"\u22e1","nsce;":"\u2ab0\u0338","Nscr;":"\ud835\udca9","nscr;":"\ud835\udcc3","nshortmid;":"\u2224","nshortparallel;":"\u2226","nsim;":"\u2241","nsime;":"\u2244","nsimeq;":"\u2244","nsmid;":"\u2224","nspar;":"\u2226","nsqsube;":"\u22e2","nsqsupe;":"\u22e3","nsub;":"\u2284","nsubE;":"\u2ac5\u0338","nsube;":"\u2288","nsubset;":"\u2282\u20d2","nsubseteq;":"\u2288","nsubseteqq;":"\u2ac5\u0338","nsucc;":"\u2281","nsucceq;":"\u2ab0\u0338","nsup;":"\u2285","nsupE;":"\u2ac6\u0338","nsupe;":"\u2289","nsupset;":"\u2283\u20d2","nsupseteq;":"\u2289","nsupseteqq;":"\u2ac6\u0338","ntgl;":"\u2279","Ntilde":"\u00d1","ntilde":"\u00f1","Ntilde;":"\u00d1","ntilde;":"\u00f1","ntlg;":"\u2278","ntriangleleft;":"\u22ea","ntrianglelefteq;":"\u22ec","ntriangleright;":"\u22eb","ntrianglerighteq;":"\u22ed","Nu;":"\u039d","nu;":"\u03bd","num;":"#","numero;":"\u2116","numsp;":"\u2007","nvap;":"\u224d\u20d2","nVDash;":"\u22af","nVdash;":"\u22ae","nvDash;":"\u22ad","nvdash;":"\u22ac","nvge;":"\u2265\u20d2","nvgt;":">\u20d2","nvHarr;":"\u2904","nvinfin;":"\u29de","nvlArr;":"\u2902","nvle;":"\u2264\u20d2","nvlt;":"<\u20d2","nvltrie;":"\u22b4\u20d2","nvrArr;":"\u2903","nvrtrie;":"\u22b5\u20d2","nvsim;":"\u223c\u20d2","nwarhk;":"\u2923","nwArr;":"\u21d6","nwarr;":"\u2196","nwarrow;":"\u2196","nwnear;":"\u2927","Oacute":"\u00d3","oacute":"\u00f3","Oacute;":"\u00d3","oacute;":"\u00f3","oast;":"\u229b","ocir;":"\u229a","Ocirc":"\u00d4","ocirc":"\u00f4","Ocirc;":"\u00d4","ocirc;":"\u00f4","Ocy;":"\u041e","ocy;":"\u043e","odash;":"\u229d","Odblac;":"\u0150","odblac;":"\u0151","odiv;":"\u2a38","odot;":"\u2299","odsold;":"\u29bc","OElig;":"\u0152","oelig;":"\u0153","ofcir;":"\u29bf","Ofr;":"\ud835\udd12","ofr;":"\ud835\udd2c","ogon;":"\u02db","Ograve":"\u00d2","ograve":"\u00f2","Ograve;":"\u00d2","ograve;":"\u00f2","ogt;":"\u29c1","ohbar;":"\u29b5","ohm;":"\u03a9","oint;":"\u222e","olarr;":"\u21ba","olcir;":"\u29be","olcross;":"\u29bb","oline;":"\u203e","olt;":"\u29c0","Omacr;":"\u014c","omacr;":"\u014d","Omega;":"\u03a9","omega;":"\u03c9","Omicron;":"\u039f","omicron;":"\u03bf","omid;":"\u29b6","ominus;":"\u2296","Oopf;":"\ud835\udd46","oopf;":"\ud835\udd60","opar;":"\u29b7","OpenCurlyDoubleQuote;":"\u201c","OpenCurlyQuote;":"\u2018","operp;":"\u29b9","oplus;":"\u2295","Or;":"\u2a54","or;":"\u2228","orarr;":"\u21bb","ord;":"\u2a5d","order;":"\u2134","orderof;":"\u2134","ordf":"\u00aa","ordf;":"\u00aa","ordm":"\u00ba","ordm;":"\u00ba","origof;":"\u22b6","oror;":"\u2a56","orslope;":"\u2a57","orv;":"\u2a5b","oS;":"\u24c8","Oscr;":"\ud835\udcaa","oscr;":"\u2134","Oslash":"\u00d8","oslash":"\u00f8","Oslash;":"\u00d8","oslash;":"\u00f8","osol;":"\u2298","Otilde":"\u00d5","otilde":"\u00f5","Otilde;":"\u00d5","otilde;":"\u00f5","Otimes;":"\u2a37","otimes;":"\u2297","otimesas;":"\u2a36","Ouml":"\u00d6","ouml":"\u00f6","Ouml;":"\u00d6","ouml;":"\u00f6","ovbar;":"\u233d","OverBar;":"\u203e","OverBrace;":"\u23de","OverBracket;":"\u23b4","OverParenthesis;":"\u23dc","par;":"\u2225","para":"\u00b6","para;":"\u00b6","parallel;":"\u2225","parsim;":"\u2af3","parsl;":"\u2afd","part;":"\u2202","PartialD;":"\u2202","Pcy;":"\u041f","pcy;":"\u043f","percnt;":"%","period;":".","permil;":"\u2030","perp;":"\u22a5","pertenk;":"\u2031","Pfr;":"\ud835\udd13","pfr;":"\ud835\udd2d","Phi;":"\u03a6","phi;":"\u03c6","phiv;":"\u03d5","phmmat;":"\u2133","phone;":"\u260e","Pi;":"\u03a0","pi;":"\u03c0","pitchfork;":"\u22d4","piv;":"\u03d6","planck;":"\u210f","planckh;":"\u210e","plankv;":"\u210f","plus;":"+","plusacir;":"\u2a23","plusb;":"\u229e","pluscir;":"\u2a22","plusdo;":"\u2214","plusdu;":"\u2a25","pluse;":"\u2a72","PlusMinus;":"\u00b1","plusmn":"\u00b1","plusmn;":"\u00b1","plussim;":"\u2a26","plustwo;":"\u2a27","pm;":"\u00b1","Poincareplane;":"\u210c","pointint;":"\u2a15","Popf;":"\u2119","popf;":"\ud835\udd61","pound":"\u00a3","pound;":"\u00a3","Pr;":"\u2abb","pr;":"\u227a","prap;":"\u2ab7","prcue;":"\u227c","prE;":"\u2ab3","pre;":"\u2aaf","prec;":"\u227a","precapprox;":"\u2ab7","preccurlyeq;":"\u227c","Precedes;":"\u227a","PrecedesEqual;":"\u2aaf","PrecedesSlantEqual;":"\u227c","PrecedesTilde;":"\u227e","preceq;":"\u2aaf","precnapprox;":"\u2ab9","precneqq;":"\u2ab5","precnsim;":"\u22e8","precsim;":"\u227e","Prime;":"\u2033","prime;":"\u2032","primes;":"\u2119","prnap;":"\u2ab9","prnE;":"\u2ab5","prnsim;":"\u22e8","prod;":"\u220f","Product;":"\u220f","profalar;":"\u232e","profline;":"\u2312","profsurf;":"\u2313","prop;":"\u221d","Proportion;":"\u2237","Proportional;":"\u221d","propto;":"\u221d","prsim;":"\u227e","prurel;":"\u22b0","Pscr;":"\ud835\udcab","pscr;":"\ud835\udcc5","Psi;":"\u03a8","psi;":"\u03c8","puncsp;":"\u2008","Qfr;":"\ud835\udd14","qfr;":"\ud835\udd2e","qint;":"\u2a0c","Qopf;":"\u211a","qopf;":"\ud835\udd62","qprime;":"\u2057","Qscr;":"\ud835\udcac","qscr;":"\ud835\udcc6","quaternions;":"\u210d","quatint;":"\u2a16","quest;":"?","questeq;":"\u225f","QUOT":"\"","quot":"\"","QUOT;":"\"","quot;":"\"","rAarr;":"\u21db","race;":"\u223d\u0331","Racute;":"\u0154","racute;":"\u0155","radic;":"\u221a","raemptyv;":"\u29b3","Rang;":"\u27eb","rang;":"\u27e9","rangd;":"\u2992","range;":"\u29a5","rangle;":"\u27e9","raquo":"\u00bb","raquo;":"\u00bb","Rarr;":"\u21a0","rArr;":"\u21d2","rarr;":"\u2192","rarrap;":"\u2975","rarrb;":"\u21e5","rarrbfs;":"\u2920","rarrc;":"\u2933","rarrfs;":"\u291e","rarrhk;":"\u21aa","rarrlp;":"\u21ac","rarrpl;":"\u2945","rarrsim;":"\u2974","Rarrtl;":"\u2916","rarrtl;":"\u21a3","rarrw;":"\u219d","rAtail;":"\u291c","ratail;":"\u291a","ratio;":"\u2236","rationals;":"\u211a","RBarr;":"\u2910","rBarr;":"\u290f","rbarr;":"\u290d","rbbrk;":"\u2773","rbrace;":"}","rbrack;":"]","rbrke;":"\u298c","rbrksld;":"\u298e","rbrkslu;":"\u2990","Rcaron;":"\u0158","rcaron;":"\u0159","Rcedil;":"\u0156","rcedil;":"\u0157","rceil;":"\u2309","rcub;":"}","Rcy;":"\u0420","rcy;":"\u0440","rdca;":"\u2937","rdldhar;":"\u2969","rdquo;":"\u201d","rdquor;":"\u201d","rdsh;":"\u21b3","Re;":"\u211c","real;":"\u211c","realine;":"\u211b","realpart;":"\u211c","reals;":"\u211d","rect;":"\u25ad","REG":"\u00ae","reg":"\u00ae","REG;":"\u00ae","reg;":"\u00ae","ReverseElement;":"\u220b","ReverseEquilibrium;":"\u21cb","ReverseUpEquilibrium;":"\u296f","rfisht;":"\u297d","rfloor;":"\u230b","Rfr;":"\u211c","rfr;":"\ud835\udd2f","rHar;":"\u2964","rhard;":"\u21c1","rharu;":"\u21c0","rharul;":"\u296c","Rho;":"\u03a1","rho;":"\u03c1","rhov;":"\u03f1","RightAngleBracket;":"\u27e9","RightArrow;":"\u2192","Rightarrow;":"\u21d2","rightarrow;":"\u2192","RightArrowBar;":"\u21e5","RightArrowLeftArrow;":"\u21c4","rightarrowtail;":"\u21a3","RightCeiling;":"\u2309","RightDoubleBracket;":"\u27e7","RightDownTeeVector;":"\u295d","RightDownVector;":"\u21c2","RightDownVectorBar;":"\u2955","RightFloor;":"\u230b","rightharpoondown;":"\u21c1","rightharpoonup;":"\u21c0","rightleftarrows;":"\u21c4","rightleftharpoons;":"\u21cc","rightrightarrows;":"\u21c9","rightsquigarrow;":"\u219d","RightTee;":"\u22a2","RightTeeArrow;":"\u21a6","RightTeeVector;":"\u295b","rightthreetimes;":"\u22cc","RightTriangle;":"\u22b3","RightTriangleBar;":"\u29d0","RightTriangleEqual;":"\u22b5","RightUpDownVector;":"\u294f","RightUpTeeVector;":"\u295c","RightUpVector;":"\u21be","RightUpVectorBar;":"\u2954","RightVector;":"\u21c0","RightVectorBar;":"\u2953","ring;":"\u02da","risingdotseq;":"\u2253","rlarr;":"\u21c4","rlhar;":"\u21cc","rlm;":"\u200f","rmoust;":"\u23b1","rmoustache;":"\u23b1","rnmid;":"\u2aee","roang;":"\u27ed","roarr;":"\u21fe","robrk;":"\u27e7","ropar;":"\u2986","Ropf;":"\u211d","ropf;":"\ud835\udd63","roplus;":"\u2a2e","rotimes;":"\u2a35","RoundImplies;":"\u2970","rpar;":")","rpargt;":"\u2994","rppolint;":"\u2a12","rrarr;":"\u21c9","Rrightarrow;":"\u21db","rsaquo;":"\u203a","Rscr;":"\u211b","rscr;":"\ud835\udcc7","Rsh;":"\u21b1","rsh;":"\u21b1","rsqb;":"]","rsquo;":"\u2019","rsquor;":"\u2019","rthree;":"\u22cc","rtimes;":"\u22ca","rtri;":"\u25b9","rtrie;":"\u22b5","rtrif;":"\u25b8","rtriltri;":"\u29ce","RuleDelayed;":"\u29f4","ruluhar;":"\u2968","rx;":"\u211e","Sacute;":"\u015a","sacute;":"\u015b","sbquo;":"\u201a","Sc;":"\u2abc","sc;":"\u227b","scap;":"\u2ab8","Scaron;":"\u0160","scaron;":"\u0161","sccue;":"\u227d","scE;":"\u2ab4","sce;":"\u2ab0","Scedil;":"\u015e","scedil;":"\u015f","Scirc;":"\u015c","scirc;":"\u015d","scnap;":"\u2aba","scnE;":"\u2ab6","scnsim;":"\u22e9","scpolint;":"\u2a13","scsim;":"\u227f","Scy;":"\u0421","scy;":"\u0441","sdot;":"\u22c5","sdotb;":"\u22a1","sdote;":"\u2a66","searhk;":"\u2925","seArr;":"\u21d8","searr;":"\u2198","searrow;":"\u2198","sect":"\u00a7","sect;":"\u00a7","semi;":";","seswar;":"\u2929","setminus;":"\u2216","setmn;":"\u2216","sext;":"\u2736","Sfr;":"\ud835\udd16","sfr;":"\ud835\udd30","sfrown;":"\u2322","sharp;":"\u266f","SHCHcy;":"\u0429","shchcy;":"\u0449","SHcy;":"\u0428","shcy;":"\u0448","ShortDownArrow;":"\u2193","ShortLeftArrow;":"\u2190","shortmid;":"\u2223","shortparallel;":"\u2225","ShortRightArrow;":"\u2192","ShortUpArrow;":"\u2191","shy":"\u00ad","shy;":"\u00ad","Sigma;":"\u03a3","sigma;":"\u03c3","sigmaf;":"\u03c2","sigmav;":"\u03c2","sim;":"\u223c","simdot;":"\u2a6a","sime;":"\u2243","simeq;":"\u2243","simg;":"\u2a9e","simgE;":"\u2aa0","siml;":"\u2a9d","simlE;":"\u2a9f","simne;":"\u2246","simplus;":"\u2a24","simrarr;":"\u2972","slarr;":"\u2190","SmallCircle;":"\u2218","smallsetminus;":"\u2216","smashp;":"\u2a33","smeparsl;":"\u29e4","smid;":"\u2223","smile;":"\u2323","smt;":"\u2aaa","smte;":"\u2aac","smtes;":"\u2aac\ufe00","SOFTcy;":"\u042c","softcy;":"\u044c","sol;":"/","solb;":"\u29c4","solbar;":"\u233f","Sopf;":"\ud835\udd4a","sopf;":"\ud835\udd64","spades;":"\u2660","spadesuit;":"\u2660","spar;":"\u2225","sqcap;":"\u2293","sqcaps;":"\u2293\ufe00","sqcup;":"\u2294","sqcups;":"\u2294\ufe00","Sqrt;":"\u221a","sqsub;":"\u228f","sqsube;":"\u2291","sqsubset;":"\u228f","sqsubseteq;":"\u2291","sqsup;":"\u2290","sqsupe;":"\u2292","sqsupset;":"\u2290","sqsupseteq;":"\u2292","squ;":"\u25a1","Square;":"\u25a1","square;":"\u25a1","SquareIntersection;":"\u2293","SquareSubset;":"\u228f","SquareSubsetEqual;":"\u2291","SquareSuperset;":"\u2290","SquareSupersetEqual;":"\u2292","SquareUnion;":"\u2294","squarf;":"\u25aa","squf;":"\u25aa","srarr;":"\u2192","Sscr;":"\ud835\udcae","sscr;":"\ud835\udcc8","ssetmn;":"\u2216","ssmile;":"\u2323","sstarf;":"\u22c6","Star;":"\u22c6","star;":"\u2606","starf;":"\u2605","straightepsilon;":"\u03f5","straightphi;":"\u03d5","strns;":"\u00af","Sub;":"\u22d0","sub;":"\u2282","subdot;":"\u2abd","subE;":"\u2ac5","sube;":"\u2286","subedot;":"\u2ac3","submult;":"\u2ac1","subnE;":"\u2acb","subne;":"\u228a","subplus;":"\u2abf","subrarr;":"\u2979","Subset;":"\u22d0","subset;":"\u2282","subseteq;":"\u2286","subseteqq;":"\u2ac5","SubsetEqual;":"\u2286","subsetneq;":"\u228a","subsetneqq;":"\u2acb","subsim;":"\u2ac7","subsub;":"\u2ad5","subsup;":"\u2ad3","succ;":"\u227b","succapprox;":"\u2ab8","succcurlyeq;":"\u227d","Succeeds;":"\u227b","SucceedsEqual;":"\u2ab0","SucceedsSlantEqual;":"\u227d","SucceedsTilde;":"\u227f","succeq;":"\u2ab0","succnapprox;":"\u2aba","succneqq;":"\u2ab6","succnsim;":"\u22e9","succsim;":"\u227f","SuchThat;":"\u220b","Sum;":"\u2211","sum;":"\u2211","sung;":"\u266a","sup1":"\u00b9","sup1;":"\u00b9","sup2":"\u00b2","sup2;":"\u00b2","sup3":"\u00b3","sup3;":"\u00b3","Sup;":"\u22d1","sup;":"\u2283","supdot;":"\u2abe","supdsub;":"\u2ad8","supE;":"\u2ac6","supe;":"\u2287","supedot;":"\u2ac4","Superset;":"\u2283","SupersetEqual;":"\u2287","suphsol;":"\u27c9","suphsub;":"\u2ad7","suplarr;":"\u297b","supmult;":"\u2ac2","supnE;":"\u2acc","supne;":"\u228b","supplus;":"\u2ac0","Supset;":"\u22d1","supset;":"\u2283","supseteq;":"\u2287","supseteqq;":"\u2ac6","supsetneq;":"\u228b","supsetneqq;":"\u2acc","supsim;":"\u2ac8","supsub;":"\u2ad4","supsup;":"\u2ad6","swarhk;":"\u2926","swArr;":"\u21d9","swarr;":"\u2199","swarrow;":"\u2199","swnwar;":"\u292a","szlig":"\u00df","szlig;":"\u00df","Tab;":"\t","target;":"\u2316","Tau;":"\u03a4","tau;":"\u03c4","tbrk;":"\u23b4","Tcaron;":"\u0164","tcaron;":"\u0165","Tcedil;":"\u0162","tcedil;":"\u0163","Tcy;":"\u0422","tcy;":"\u0442","tdot;":"\u20db","telrec;":"\u2315","Tfr;":"\ud835\udd17","tfr;":"\ud835\udd31","there4;":"\u2234","Therefore;":"\u2234","therefore;":"\u2234","Theta;":"\u0398","theta;":"\u03b8","thetasym;":"\u03d1","thetav;":"\u03d1","thickapprox;":"\u2248","thicksim;":"\u223c","ThickSpace;":"\u205f\u200a","thinsp;":"\u2009","ThinSpace;":"\u2009","thkap;":"\u2248","thksim;":"\u223c","THORN":"\u00de","thorn":"\u00fe","THORN;":"\u00de","thorn;":"\u00fe","Tilde;":"\u223c","tilde;":"\u02dc","TildeEqual;":"\u2243","TildeFullEqual;":"\u2245","TildeTilde;":"\u2248","times":"\u00d7","times;":"\u00d7","timesb;":"\u22a0","timesbar;":"\u2a31","timesd;":"\u2a30","tint;":"\u222d","toea;":"\u2928","top;":"\u22a4","topbot;":"\u2336","topcir;":"\u2af1","Topf;":"\ud835\udd4b","topf;":"\ud835\udd65","topfork;":"\u2ada","tosa;":"\u2929","tprime;":"\u2034","TRADE;":"\u2122","trade;":"\u2122","triangle;":"\u25b5","triangledown;":"\u25bf","triangleleft;":"\u25c3","trianglelefteq;":"\u22b4","triangleq;":"\u225c","triangleright;":"\u25b9","trianglerighteq;":"\u22b5","tridot;":"\u25ec","trie;":"\u225c","triminus;":"\u2a3a","TripleDot;":"\u20db","triplus;":"\u2a39","trisb;":"\u29cd","tritime;":"\u2a3b","trpezium;":"\u23e2","Tscr;":"\ud835\udcaf","tscr;":"\ud835\udcc9","TScy;":"\u0426","tscy;":"\u0446","TSHcy;":"\u040b","tshcy;":"\u045b","Tstrok;":"\u0166","tstrok;":"\u0167","twixt;":"\u226c","twoheadleftarrow;":"\u219e","twoheadrightarrow;":"\u21a0","Uacute":"\u00da","uacute":"\u00fa","Uacute;":"\u00da","uacute;":"\u00fa","Uarr;":"\u219f","uArr;":"\u21d1","uarr;":"\u2191","Uarrocir;":"\u2949","Ubrcy;":"\u040e","ubrcy;":"\u045e","Ubreve;":"\u016c","ubreve;":"\u016d","Ucirc":"\u00db","ucirc":"\u00fb","Ucirc;":"\u00db","ucirc;":"\u00fb","Ucy;":"\u0423","ucy;":"\u0443","udarr;":"\u21c5","Udblac;":"\u0170","udblac;":"\u0171","udhar;":"\u296e","ufisht;":"\u297e","Ufr;":"\ud835\udd18","ufr;":"\ud835\udd32","Ugrave":"\u00d9","ugrave":"\u00f9","Ugrave;":"\u00d9","ugrave;":"\u00f9","uHar;":"\u2963","uharl;":"\u21bf","uharr;":"\u21be","uhblk;":"\u2580","ulcorn;":"\u231c","ulcorner;":"\u231c","ulcrop;":"\u230f","ultri;":"\u25f8","Umacr;":"\u016a","umacr;":"\u016b","uml":"\u00a8","uml;":"\u00a8","UnderBar;":"_","UnderBrace;":"\u23df","UnderBracket;":"\u23b5","UnderParenthesis;":"\u23dd","Union;":"\u22c3","UnionPlus;":"\u228e","Uogon;":"\u0172","uogon;":"\u0173","Uopf;":"\ud835\udd4c","uopf;":"\ud835\udd66","UpArrow;":"\u2191","Uparrow;":"\u21d1","uparrow;":"\u2191","UpArrowBar;":"\u2912","UpArrowDownArrow;":"\u21c5","UpDownArrow;":"\u2195","Updownarrow;":"\u21d5","updownarrow;":"\u2195","UpEquilibrium;":"\u296e","upharpoonleft;":"\u21bf","upharpoonright;":"\u21be","uplus;":"\u228e","UpperLeftArrow;":"\u2196","UpperRightArrow;":"\u2197","Upsi;":"\u03d2","upsi;":"\u03c5","upsih;":"\u03d2","Upsilon;":"\u03a5","upsilon;":"\u03c5","UpTee;":"\u22a5","UpTeeArrow;":"\u21a5","upuparrows;":"\u21c8","urcorn;":"\u231d","urcorner;":"\u231d","urcrop;":"\u230e","Uring;":"\u016e","uring;":"\u016f","urtri;":"\u25f9","Uscr;":"\ud835\udcb0","uscr;":"\ud835\udcca","utdot;":"\u22f0","Utilde;":"\u0168","utilde;":"\u0169","utri;":"\u25b5","utrif;":"\u25b4","uuarr;":"\u21c8","Uuml":"\u00dc","uuml":"\u00fc","Uuml;":"\u00dc","uuml;":"\u00fc","uwangle;":"\u29a7","vangrt;":"\u299c","varepsilon;":"\u03f5","varkappa;":"\u03f0","varnothing;":"\u2205","varphi;":"\u03d5","varpi;":"\u03d6","varpropto;":"\u221d","vArr;":"\u21d5","varr;":"\u2195","varrho;":"\u03f1","varsigma;":"\u03c2","varsubsetneq;":"\u228a\ufe00","varsubsetneqq;":"\u2acb\ufe00","varsupsetneq;":"\u228b\ufe00","varsupsetneqq;":"\u2acc\ufe00","vartheta;":"\u03d1","vartriangleleft;":"\u22b2","vartriangleright;":"\u22b3","Vbar;":"\u2aeb","vBar;":"\u2ae8","vBarv;":"\u2ae9","Vcy;":"\u0412","vcy;":"\u0432","VDash;":"\u22ab","Vdash;":"\u22a9","vDash;":"\u22a8","vdash;":"\u22a2","Vdashl;":"\u2ae6","Vee;":"\u22c1","vee;":"\u2228","veebar;":"\u22bb","veeeq;":"\u225a","vellip;":"\u22ee","Verbar;":"\u2016","verbar;":"|","Vert;":"\u2016","vert;":"|","VerticalBar;":"\u2223","VerticalLine;":"|","VerticalSeparator;":"\u2758","VerticalTilde;":"\u2240","VeryThinSpace;":"\u200a","Vfr;":"\ud835\udd19","vfr;":"\ud835\udd33","vltri;":"\u22b2","vnsub;":"\u2282\u20d2","vnsup;":"\u2283\u20d2","Vopf;":"\ud835\udd4d","vopf;":"\ud835\udd67","vprop;":"\u221d","vrtri;":"\u22b3","Vscr;":"\ud835\udcb1","vscr;":"\ud835\udccb","vsubnE;":"\u2acb\ufe00","vsubne;":"\u228a\ufe00","vsupnE;":"\u2acc\ufe00","vsupne;":"\u228b\ufe00","Vvdash;":"\u22aa","vzigzag;":"\u299a","Wcirc;":"\u0174","wcirc;":"\u0175","wedbar;":"\u2a5f","Wedge;":"\u22c0","wedge;":"\u2227","wedgeq;":"\u2259","weierp;":"\u2118","Wfr;":"\ud835\udd1a","wfr;":"\ud835\udd34","Wopf;":"\ud835\udd4e","wopf;":"\ud835\udd68","wp;":"\u2118","wr;":"\u2240","wreath;":"\u2240","Wscr;":"\ud835\udcb2","wscr;":"\ud835\udccc","xcap;":"\u22c2","xcirc;":"\u25ef","xcup;":"\u22c3","xdtri;":"\u25bd","Xfr;":"\ud835\udd1b","xfr;":"\ud835\udd35","xhArr;":"\u27fa","xharr;":"\u27f7","Xi;":"\u039e","xi;":"\u03be","xlArr;":"\u27f8","xlarr;":"\u27f5","xmap;":"\u27fc","xnis;":"\u22fb","xodot;":"\u2a00","Xopf;":"\ud835\udd4f","xopf;":"\ud835\udd69","xoplus;":"\u2a01","xotime;":"\u2a02","xrArr;":"\u27f9","xrarr;":"\u27f6","Xscr;":"\ud835\udcb3","xscr;":"\ud835\udccd","xsqcup;":"\u2a06","xuplus;":"\u2a04","xutri;":"\u25b3","xvee;":"\u22c1","xwedge;":"\u22c0","Yacute":"\u00dd","yacute":"\u00fd","Yacute;":"\u00dd","yacute;":"\u00fd","YAcy;":"\u042f","yacy;":"\u044f","Ycirc;":"\u0176","ycirc;":"\u0177","Ycy;":"\u042b","ycy;":"\u044b","yen":"\u00a5","yen;":"\u00a5","Yfr;":"\ud835\udd1c","yfr;":"\ud835\udd36","YIcy;":"\u0407","yicy;":"\u0457","Yopf;":"\ud835\udd50","yopf;":"\ud835\udd6a","Yscr;":"\ud835\udcb4","yscr;":"\ud835\udcce","YUcy;":"\u042e","yucy;":"\u044e","yuml":"\u00ff","Yuml;":"\u0178","yuml;":"\u00ff","Zacute;":"\u0179","zacute;":"\u017a","Zcaron;":"\u017d","zcaron;":"\u017e","Zcy;":"\u0417","zcy;":"\u0437","Zdot;":"\u017b","zdot;":"\u017c","zeetrf;":"\u2128","ZeroWidthSpace;":"\u200b","Zeta;":"\u0396","zeta;":"\u03b6","Zfr;":"\u2128","zfr;":"\ud835\udd37","ZHcy;":"\u0416","zhcy;":"\u0436","zigrarr;":"\u21dd","Zopf;":"\u2124","zopf;":"\ud835\udd6b","Zscr;":"\ud835\udcb5","zscr;":"\ud835\udccf","zwj;":"\u200d","zwnj;":"\u200c"};

// Remapeo de referencias numericas 0x80-0x9F (tabla windows-1252 de la spec).
const NUMERIC_REMAP = {
  0x80: 0x20AC, 0x82: 0x201A, 0x83: 0x0192, 0x84: 0x201E, 0x85: 0x2026,
  0x86: 0x2020, 0x87: 0x2021, 0x88: 0x02C6, 0x89: 0x2030, 0x8A: 0x0160,
  0x8B: 0x2039, 0x8C: 0x0152, 0x8E: 0x017D, 0x91: 0x2018, 0x92: 0x2019,
  0x93: 0x201C, 0x94: 0x201D, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014,
  0x98: 0x02DC, 0x99: 0x2122, 0x9A: 0x0161, 0x9B: 0x203A, 0x9C: 0x0153,
  0x9E: 0x017E, 0x9F: 0x0178,
};

function decodeEntities(str, inAttr = false) {
  if (!str || str.indexOf('&') === -1) return str;
  return str.replace(/&(#(?:[xX][0-9a-fA-F]+|[0-9]+)|[a-zA-Z][a-zA-Z0-9]*)(;?)/g,
    (m, body, semi, offset, whole) => {
      if (body.charCodeAt(0) === 35) { // '#'
        let cp;
        if (body[1] === 'x' || body[1] === 'X') cp = parseInt(body.slice(2), 16);
        else cp = parseInt(body.slice(1), 10);
        if (!cp || cp > 0x10FFFF || (cp >= 0xD800 && cp <= 0xDFFF)) cp = 0xFFFD;
        else if (NUMERIC_REMAP[cp]) cp = NUMERIC_REMAP[cp];
        return String.fromCodePoint(cp);
      }
      // Con ';' se exige la forma completa; sin ';' solo las entidades
      // "legacy" que la tabla trae sin punto y coma.
      const v = ENTITIES[semi ? body + ';' : body];
      if (v === undefined) return m;
      if (!semi && inAttr) {
        // En atributos, una referencia sin ';' seguida de alfanumerico o '='
        // no se decodifica (regla de la spec para no romper URLs).
        const next = whole[offset + m.length];
        if (next && /[0-9a-zA-Z=]/.test(next)) return m;
      }
      return v;
    });
}

// ---------------------------------------------------------------------------
// Parser (tokenizer + constructor de arbol, subconjunto fiel de HTML5)
// ---------------------------------------------------------------------------

const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta',
  'param', 'source', 'track', 'wbr',
]);
const RAWTEXT_ELEMENTS = new Set(['script', 'style', 'xmp', 'iframe', 'noembed', 'noframes']);
const RCDATA_ELEMENTS = new Set(['title', 'textarea']);
// Etiquetas cuyo elemento de inicio cierra un <p> abierto ("in body").
const P_CLOSERS = new Set([
  'address', 'article', 'aside', 'blockquote', 'center', 'details', 'dialog',
  'dir', 'div', 'dl', 'fieldset', 'figcaption', 'figure', 'footer', 'form',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hgroup', 'hr', 'main', 'menu',
  'nav', 'ol', 'p', 'pre', 'section', 'summary', 'table', 'ul', 'listing',
]);
// Alcance (scope) base para busquedas en la pila de elementos abiertos.
const SCOPE_STOPS = new Set([
  'applet', 'caption', 'html', 'table', 'td', 'th', 'marquee', 'object',
  'template', 'body',
]);
const IMPLIED_END = new Set(['dd', 'dt', 'li', 'option', 'optgroup', 'p', 'rb', 'rp', 'rt', 'rtc']);
const HEAD_TAGS = new Set(['base', 'link', 'meta', 'title', 'style', 'script', 'noscript', 'template']);
const TABLE_CONTEXT = new Set(['table', 'tbody', 'thead', 'tfoot', 'tr']);
const TABLE_ALLOWED = {
  table: new Set(['caption', 'colgroup', 'tbody', 'thead', 'tfoot', 'tr', 'style', 'script', 'template']),
  tbody: new Set(['tr', 'style', 'script', 'template']),
  thead: new Set(['tr', 'style', 'script', 'template']),
  tfoot: new Set(['tr', 'style', 'script', 'template']),
  tr: new Set(['td', 'th', 'style', 'script', 'template']),
};
// Etiquetas que, dentro de contenido extranjero (SVG/MathML), fuerzan salida.
const FOREIGN_BREAKOUT = new Set([
  'b', 'big', 'blockquote', 'body', 'br', 'center', 'code', 'dd', 'div', 'dl',
  'dt', 'em', 'embed', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'head', 'hr', 'i',
  'img', 'li', 'listing', 'menu', 'meta', 'nobr', 'ol', 'p', 'pre', 'ruby',
  'small', 'span', 'strong', 'strike', 'sub', 'sup', 'table', 'tt', 'u', 'ul', 'var',
]);

function makeNode(t, props = {}) {
  return { t, tag: null, attrs: null, children: [], parent: null, data: null, foreign: false, ...props };
}

function appendChild(parent, node) {
  node.parent = parent;
  parent.children.push(node);
  return node;
}

function insertBefore(parent, node, ref) {
  node.parent = parent;
  parent.children.splice(parent.children.indexOf(ref), 0, node);
  return node;
}

function getAttr(node, name) {
  if (!node.attrs) return undefined;
  for (const [k, v] of node.attrs) if (k === name) return v;
  return undefined;
}

function parseHtmlDocument(input, baseUrl = null) {
  const s = String(input);
  const len = s.length;
  const docNode = makeNode('document');
  const doc = { root: docNode, baseUrl };
  const stack = []; // elementos abiertos (sin el documento)
  let htmlEl = null, headEl = null, bodyEl = null, formEl = null;
  let mode = 'beforeHtml';
  let pos = 0;

  const current = () => (stack.length ? stack[stack.length - 1] : docNode);
  const inForeign = () => {
    const c = current();
    return c.t === 'element' && c.foreign;
  };

  function mergeAttrs(el, attrs) {
    if (!el || !attrs) return;
    for (const [k, v] of attrs) if (getAttr(el, k) === undefined) el.attrs.push([k, v]);
  }

  function inScope(tag, extraStops) {
    for (let i = stack.length - 1; i >= 0; i--) {
      const el = stack[i];
      if (el.tag === tag) return true;
      if (SCOPE_STOPS.has(el.tag) || (extraStops && extraStops.has(el.tag))) return false;
    }
    return false;
  }

  function popThrough(tag) {
    while (stack.length) {
      const el = stack.pop();
      if (el === formEl) formEl = null;
      if (el.tag === tag) return true;
    }
    return false;
  }

  function closePInButtonScope() {
    if (inScope('p', new Set(['button']))) popThrough('p');
  }

  function generateImpliedEndTags(except) {
    while (stack.length) {
      const c = current();
      if (c.t === 'element' && IMPLIED_END.has(c.tag) && c.tag !== except) stack.pop();
      else break;
    }
  }

  // Foster parenting simplificado: inserta antes de la <table> abierta.
  function fosterInsert(node) {
    for (let i = stack.length - 1; i >= 0; i--) {
      if (stack[i].tag === 'table') {
        const table = stack[i];
        if (table.parent) {
          if (node.t === 'text') {
            const idx = table.parent.children.indexOf(table);
            const prev = table.parent.children[idx - 1];
            if (prev && prev.t === 'text') { prev.data += node.data; return prev; }
          }
          return insertBefore(table.parent, node, table);
        }
        break;
      }
    }
    return appendChild(current(), node);
  }

  function insertText(data) {
    if (!data) return;
    const c = current();
    if (c.t === 'element' && TABLE_CONTEXT.has(c.tag) && /\S/.test(data)) {
      fosterInsert(makeNode('text', { data }));
      return;
    }
    const last = c.children[c.children.length - 1];
    if (last && last.t === 'text') last.data += data;
    else appendChild(c, makeNode('text', { data }));
  }

  function insertElement(tag, attrs, { push = true, foreign = false } = {}) {
    const el = makeNode('element', { tag, attrs: attrs || [], foreign });
    const c = current();
    if (c.t === 'element' && TABLE_CONTEXT.has(c.tag) && !(TABLE_ALLOWED[c.tag] || new Set()).has(tag)) {
      fosterInsert(el);
    } else {
      appendChild(c, el);
    }
    if (push) stack.push(el);
    return el;
  }

  function implyHtml() {
    htmlEl = appendChild(docNode, makeNode('element', { tag: 'html', attrs: [] }));
    stack.push(htmlEl);
    mode = 'beforeHead';
  }
  function implyHead() {
    headEl = appendChild(htmlEl, makeNode('element', { tag: 'head', attrs: [] }));
    stack.push(headEl);
    mode = 'inHead';
  }
  function implyBody() {
    bodyEl = appendChild(htmlEl, makeNode('element', { tag: 'body', attrs: [] }));
    stack.push(bodyEl);
    mode = 'inBody';
  }

  // Consume contenido raw (script/style/title/textarea) ya insertado `el`:
  // busca su etiqueta de cierre desde `pos` y deja `pos` tras ella.
  function consumeRawText(el, tag, decode) {
    const close = '</' + tag;
    const lower = s.toLowerCase();
    let idx = lower.indexOf(close, pos);
    while (idx !== -1) {
      const after = s[idx + close.length];
      if (after === undefined || after === '>' || after === '/' || /\s/.test(after)) break;
      idx = lower.indexOf(close, idx + 1);
    }
    let raw;
    if (idx === -1) { raw = s.slice(pos); pos = len; }
    else {
      raw = s.slice(pos, idx);
      const gt = s.indexOf('>', idx);
      pos = gt === -1 ? len : gt + 1;
    }
    if (tag === 'textarea' && raw.startsWith('\n')) raw = raw.slice(1);
    if (raw) appendChild(el, makeNode('text', { data: decode ? decodeEntities(raw) : raw }));
    if (stack[stack.length - 1] === el) stack.pop();
  }

  // Procesa un token. Devuelve true si el token debe reprocesarse (cambio de modo).
  function handleStartTag(tag, attrs, selfClosing) {
    // --- modos previos al cuerpo ---
    if (mode === 'beforeHtml') {
      if (tag === 'html') {
        htmlEl = appendChild(docNode, makeNode('element', { tag, attrs }));
        stack.push(htmlEl);
        mode = 'beforeHead';
        return false;
      }
      implyHtml();
      return true;
    }
    if (mode === 'beforeHead') {
      if (tag === 'html') { mergeAttrs(htmlEl, attrs); return false; }
      if (tag === 'head') {
        headEl = appendChild(htmlEl, makeNode('element', { tag, attrs }));
        stack.push(headEl);
        mode = 'inHead';
        return false;
      }
      implyHead();
      return true;
    }
    if (mode === 'inHead') {
      if (tag === 'html') { mergeAttrs(htmlEl, attrs); return false; }
      if (tag === 'head') return false;
      if (tag === 'base' || tag === 'link' || tag === 'meta') {
        insertElement(tag, attrs, { push: false });
        return false;
      }
      if (RAWTEXT_ELEMENTS.has(tag) || RCDATA_ELEMENTS.has(tag)) {
        const el = insertElement(tag, attrs);
        consumeRawText(el, tag, RCDATA_ELEMENTS.has(tag));
        return false;
      }
      if (tag === 'noscript' || tag === 'template') {
        insertElement(tag, attrs);
        return false;
      }
      // cualquier otra cosa cierra el head
      if (current() === headEl) stack.pop();
      mode = 'afterHead';
      return true;
    }
    if (mode === 'afterHead') {
      if (tag === 'html') { mergeAttrs(htmlEl, attrs); return false; }
      if (tag === 'body') {
        bodyEl = appendChild(htmlEl, makeNode('element', { tag, attrs }));
        stack.push(bodyEl);
        mode = 'inBody';
        return false;
      }
      if (tag === 'head') return false;
      if (HEAD_TAGS.has(tag) && headEl) {
        // La spec los procesa "en el head" aunque ya haya cerrado.
        const el = appendChild(headEl, makeNode('element', { tag, attrs: attrs || [] }));
        if (RAWTEXT_ELEMENTS.has(tag) || RCDATA_ELEMENTS.has(tag)) {
          stack.push(el);
          consumeRawText(el, tag, RCDATA_ELEMENTS.has(tag));
        }
        return false;
      }
      implyBody();
      return true;
    }

    // --- inBody ---
    if (tag === 'html') { mergeAttrs(htmlEl, attrs); return false; }
    if (tag === 'body') { mergeAttrs(bodyEl, attrs); return false; }
    if (tag === 'head') return false;

    // Contenido extranjero: se honra el autocierre y hay etiquetas de escape.
    const c = current();
    if (c.t === 'element' && c.foreign) {
      if (FOREIGN_BREAKOUT.has(tag) && !(tag === 'font' && attrs && attrs.some(([k]) => ['color', 'face', 'size'].includes(k)))) {
        while (stack.length && current().foreign) stack.pop();
        return handleStartTag(tag, attrs, selfClosing);
      }
      const el = insertElement(tag, attrs, { foreign: true, push: !selfClosing });
      return false;
    }
    if (tag === 'svg' || tag === 'math') {
      insertElement(tag, attrs, { foreign: true, push: !selfClosing });
      return false;
    }

    if (tag === 'image') tag = 'img'; // rareza historica de la spec

    // Tabla: celdas/filas implicitas y cierre de contextos.
    if (tag === 'tr') {
      closePInButtonScope();
      let cur = current();
      if (cur.tag === 'table') { insertElement('tbody', []); cur = current(); }
      if (cur.tag === 'tr') popThrough('tr');
      else if (cur.tag === 'td' || cur.tag === 'th') { popThrough('tr'); if (current().tag === 'table') insertElement('tbody', []); }
      insertElement('tr', attrs);
      return false;
    }
    if (tag === 'td' || tag === 'th') {
      let cur = current();
      if (cur.tag === 'table') { insertElement('tbody', []); insertElement('tr', []); cur = current(); }
      else if (TABLE_CONTEXT.has(cur.tag) && cur.tag !== 'tr') insertElement('tr', []);
      else if (cur.tag === 'td' || cur.tag === 'th') stack.pop();
      insertElement(tag, attrs);
      return false;
    }
    if (tag === 'tbody' || tag === 'thead' || tag === 'tfoot' || tag === 'caption' || tag === 'colgroup') {
      let cur = current();
      if (['td', 'th', 'tr', 'tbody', 'thead', 'tfoot', 'caption', 'colgroup'].includes(cur.tag)) {
        while (stack.length && !['table', 'html', 'body'].includes(current().tag)) stack.pop();
      }
      insertElement(tag, attrs, { push: tag !== 'caption' ? true : true });
      return false;
    }
    if (tag === 'col') { insertElement('col', attrs, { push: false }); return false; }

    if (tag === 'li') {
      // cierra un <li> abierto en el mismo ambito de lista
      for (let i = stack.length - 1; i >= 0; i--) {
        const el = stack[i];
        if (el.tag === 'li') { popThrough('li'); break; }
        if (SCOPE_STOPS.has(el.tag) || el.tag === 'ol' || el.tag === 'ul') break;
      }
      closePInButtonScope();
      insertElement(tag, attrs);
      return false;
    }
    if (tag === 'dd' || tag === 'dt') {
      for (let i = stack.length - 1; i >= 0; i--) {
        const el = stack[i];
        if (el.tag === 'dd' || el.tag === 'dt') { popThrough(el.tag); break; }
        if (SCOPE_STOPS.has(el.tag) || el.tag === 'dl') break;
      }
      closePInButtonScope();
      insertElement(tag, attrs);
      return false;
    }
    if (tag === 'option') {
      if (current().tag === 'option') stack.pop();
      insertElement(tag, attrs);
      return false;
    }
    if (tag === 'optgroup') {
      if (current().tag === 'option') stack.pop();
      if (current().tag === 'optgroup') stack.pop();
      closePInButtonScope();
      insertElement(tag, attrs);
      return false;
    }
    if (tag === 'form') {
      if (formEl) return false; // un solo form activo
      closePInButtonScope();
      formEl = insertElement(tag, attrs);
      return false;
    }
    if (tag === 'a') {
      if (inScope('a')) popThrough('a');
      insertElement(tag, attrs);
      return false;
    }
    if (tag === 'button') {
      if (inScope('button', new Set(['button']))) popThrough('button');
      closePInButtonScope();
      insertElement(tag, attrs);
      return false;
    }
    if (/^h[1-6]$/.test(tag)) {
      closePInButtonScope();
      if (/^h[1-6]$/.test(current().tag || '')) stack.pop();
      insertElement(tag, attrs);
      return false;
    }
    if (P_CLOSERS.has(tag)) closePInButtonScope();
    if (VOID_ELEMENTS.has(tag)) {
      insertElement(tag, attrs, { push: false });
      return false;
    }
    if (RAWTEXT_ELEMENTS.has(tag) || RCDATA_ELEMENTS.has(tag)) {
      const el = insertElement(tag, attrs);
      consumeRawText(el, tag, RCDATA_ELEMENTS.has(tag));
      return false;
    }
    if (tag === 'plaintext') {
      const el = insertElement(tag, attrs);
      const raw = s.slice(pos);
      pos = len;
      if (raw) appendChild(el, makeNode('text', { data: raw }));
      return false;
    }
    if (tag === 'pre' || tag === 'listing') {
      const el = insertElement(tag, attrs);
      // la spec descarta el primer salto de linea tras <pre>
      if (s[pos] === '\r' && s[pos + 1] === '\n') pos += 2;
      else if (s[pos] === '\n') pos += 1;
      return false;
    }
    insertElement(tag, attrs);
    return false;
  }

  function handleEndTag(tag) {
    if (mode === 'beforeHtml') {
      if (['html', 'head', 'body', 'br'].includes(tag)) { implyHtml(); return true; }
      return false;
    }
    if (mode === 'beforeHead') {
      if (['head', 'body', 'html', 'br'].includes(tag)) { implyHead(); return true; }
      return false;
    }
    if (mode === 'inHead') {
      if (tag === 'head') {
        if (current() === headEl) stack.pop();
        mode = 'afterHead';
        return false;
      }
      if (['body', 'html', 'br'].includes(tag)) {
        if (current() === headEl) stack.pop();
        mode = 'afterHead';
        return true;
      }
      if (stack.some((el) => el.tag === tag)) { generateImpliedEndTags(tag); popThrough(tag); }
      return false;
    }
    if (mode === 'afterHead') {
      if (['body', 'html', 'br'].includes(tag)) { implyBody(); return true; }
      return false;
    }
    // inBody
    if (tag === 'body' || tag === 'html') return false;
    if (tag === 'br') { handleStartTag('br', [], false); return false; }
    if (tag === 'form') {
      if (formEl) { generateImpliedEndTags('form'); popThrough('form'); formEl = null; }
      return false;
    }
    if (tag === 'p' && !inScope('p', new Set(['button']))) return false;
    if (stack.some((el) => el.tag === tag)) {
      generateImpliedEndTags(tag);
      popThrough(tag);
    }
    return false;
  }

  function handleText(data) {
    if (!data) return;
    if (mode === 'beforeHtml' || mode === 'beforeHead') {
      if (!/\S/.test(data)) return; // espacios antes del html/head: se ignoran
      if (mode === 'beforeHtml') { implyHtml(); handleText(data); return; }
      implyHead(); handleText(data); return;
    }
    if (mode === 'inHead') {
      if (current() === headEl && /\S/.test(data)) {
        stack.pop();
        mode = 'afterHead';
        handleText(data);
        return;
      }
      insertText(data);
      return;
    }
    if (mode === 'afterHead') {
      if (!/\S/.test(data)) return;
      implyBody();
      insertText(data);
      return;
    }
    insertText(data);
  }

  function handleComment(data) {
    const node = makeNode('comment', { data });
    if (mode === 'beforeHtml') appendChild(docNode, node);
    else if (mode === 'beforeHead') appendChild(htmlEl, node);
    else appendChild(current(), node);
  }

  // --- tokenizer principal ---
  while (pos < len) {
    const lt = s.indexOf('<', pos);
    if (lt === -1) {
      handleText(decodeEntities(s.slice(pos)));
      break;
    }
    if (lt > pos) handleText(decodeEntities(s.slice(pos, lt)));
    pos = lt;
    const c1 = s[pos + 1];

    if (c1 === '!') {
      if (s.startsWith('<!--', pos)) {
        let end = s.indexOf('-->', pos + 4);
        if (end === -1) end = len;
        let data = s.slice(pos + 4, end);
        if (data.startsWith('>')) data = data.slice(1);
        if (data.startsWith('->')) data = data.slice(2);
        handleComment(data);
        pos = end === len ? len : end + 3;
        continue;
      }
      if (s.slice(pos, pos + 9).toLowerCase() === '<!doctype') {
        const gt = s.indexOf('>', pos);
        appendChild(docNode, makeNode('doctype', { data: s.slice(pos + 9, gt === -1 ? len : gt).trim() }));
        pos = gt === -1 ? len : gt + 1;
        if (mode === 'beforeHtml') { /* el doctype vive en el documento */ }
        continue;
      }
      if (s.startsWith('<![CDATA[', pos) && inForeign()) {
        const end = s.indexOf(']]>', pos + 9);
        const data = s.slice(pos + 9, end === -1 ? len : end);
        insertText(data);
        pos = end === -1 ? len : end + 3;
        continue;
      }
      // comentario bogus <! ... >
      const gt = s.indexOf('>', pos);
      handleComment(s.slice(pos + 2, gt === -1 ? len : gt));
      pos = gt === -1 ? len : gt + 1;
      continue;
    }
    if (c1 === '?') {
      const gt = s.indexOf('>', pos);
      handleComment(s.slice(pos + 2, gt === -1 ? len : gt));
      pos = gt === -1 ? len : gt + 1;
      continue;
    }
    if (c1 === '/') {
      const c2 = s[pos + 2];
      if (c2 === '>') { pos += 3; continue; }
      if (!c2 || !/[a-zA-Z]/.test(c2)) {
        const gt = s.indexOf('>', pos);
        pos = gt === -1 ? len : gt + 1;
        continue;
      }
      let i = pos + 2;
      let name = '';
      while (i < len && !/[\s/>]/.test(s[i])) { name += s[i]; i++; }
      const gt = s.indexOf('>', i);
      pos = gt === -1 ? len : gt + 1;
      let again = handleEndTag(inForeign() ? name : name.toLowerCase());
      while (again) again = handleEndTag(inForeign() ? name : name.toLowerCase());
      continue;
    }
    if (!c1 || !/[a-zA-Z]/.test(c1)) {
      handleText('<');
      pos += 1;
      continue;
    }
    // etiqueta de inicio
    let i = pos + 1;
    let name = '';
    while (i < len && !/[\s/>]/.test(s[i])) { name += s[i]; i++; }
    const tagForeign = inForeign() || name.toLowerCase() === 'svg' || name.toLowerCase() === 'math';
    const tag = tagForeign ? name : name.toLowerCase();
    const attrs = [];
    let selfClosing = false;
    while (i < len) {
      while (i < len && /\s/.test(s[i])) i++;
      if (i >= len) break;
      if (s[i] === '>') { i++; break; }
      if (s[i] === '/') {
        if (s[i + 1] === '>') { selfClosing = true; i += 2; break; }
        i++;
        continue;
      }
      let aname = '';
      while (i < len && !/[\s=/>]/.test(s[i])) { aname += s[i]; i++; }
      if (!aname) { i++; continue; }
      let j = i;
      while (j < len && /\s/.test(s[j])) j++;
      let avalue = '';
      if (s[j] === '=') {
        j++;
        while (j < len && /\s/.test(s[j])) j++;
        const q = s[j];
        if (q === '"' || q === "'") {
          const end = s.indexOf(q, j + 1);
          avalue = s.slice(j + 1, end === -1 ? len : end);
          j = end === -1 ? len : end + 1;
        } else {
          let v = '';
          while (j < len && !/[\s>]/.test(s[j])) { v += s[j]; j++; }
          avalue = v;
        }
        avalue = decodeEntities(avalue, true);
        i = j;
      }
      const key = tagForeign ? aname : aname.toLowerCase();
      if (!attrs.some(([k]) => k === key)) attrs.push([key, avalue]);
    }
    pos = i;
    let again = handleStartTag(tag, attrs, selfClosing);
    while (again) again = handleStartTag(tag, attrs, selfClosing);
  }

  // Cierre implicito de fin de documento: garantiza html/head/body.
  if (!htmlEl) implyHtml();
  if (!headEl) {
    headEl = makeNode('element', { tag: 'head', attrs: [] });
    htmlEl.children.unshift(headEl);
    headEl.parent = htmlEl;
  }
  if (!bodyEl) {
    bodyEl = appendChild(htmlEl, makeNode('element', { tag: 'body', attrs: [] }));
  }
  doc.documentElement = htmlEl;
  return doc;
}

// Texto completo de un nodo (descendientes, en orden) — como textContent.
function nodeText(node) {
  let out = '';
  const walk = (n) => {
    if (n.t === 'text') { out += n.data; return; }
    for (const c of n.children) walk(c);
  };
  walk(node);
  return out;
}

// Texto propio: solo los nodos de texto hijos directos.
function nodeOwnText(node) {
  let out = '';
  for (const c of node.children) if (c.t === 'text') out += c.data;
  return out;
}

function elementParent(node) {
  let p = node.parent;
  while (p && p.t !== 'element') p = p.parent;
  return p;
}

function elementChildren(node) {
  return node.children.filter((c) => c.t === 'element');
}

function prevElementSibling(node) {
  if (!node.parent) return null;
  const sibs = node.parent.children;
  for (let i = sibs.indexOf(node) - 1; i >= 0; i--) {
    if (sibs[i].t === 'element') return sibs[i];
  }
  return null;
}

function nextElementSibling(node) {
  if (!node.parent) return null;
  const sibs = node.parent.children;
  for (let i = sibs.indexOf(node) + 1; i < sibs.length; i++) {
    if (sibs[i].t === 'element') return sibs[i];
  }
  return null;
}

function descendants(node, out = []) {
  for (const c of node.children) {
    if (c.t === 'element') {
      out.push(c);
      descendants(c, out);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Selectores CSS
// ---------------------------------------------------------------------------

class SelectorError extends Error {}

function splitTopLevel(str, sep) {
  const parts = [];
  let depth = 0, bracket = 0, quote = null, start = 0;
  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === '[') bracket++;
    else if (c === ']') bracket--;
    else if (c === sep && depth === 0 && bracket === 0) {
      parts.push(str.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(str.slice(start));
  return parts;
}

function parseIdent(str, i) {
  let out = '';
  while (i < str.length) {
    const c = str[i];
    if (c === '\\') {
      const hex = /^[0-9a-fA-F]{1,6}/.exec(str.slice(i + 1));
      if (hex) {
        out += String.fromCodePoint(parseInt(hex[0], 16) || 0xFFFD);
        i += 1 + hex[0].length;
        if (str[i] === ' ') i++;
      } else if (i + 1 < str.length) {
        out += str[i + 1];
        i += 2;
      } else i++;
      continue;
    }
    if (/[a-zA-Z0-9_-]/.test(c) || c.charCodeAt(0) >= 0x80) { out += c; i++; continue; }
    break;
  }
  if (!out) throw new SelectorError('identificador vacio en: ' + str);
  return [out, i];
}

// Lee un bloque (...) equilibrado; str[i] debe ser '('. Devuelve [inner, nextI].
function parseParens(str, i) {
  let depth = 0, quote = null;
  const start = i + 1;
  for (; i < str.length; i++) {
    const c = str[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if (c === '\\') i++;
    else if (c === '(') depth++;
    else if (c === ')') {
      depth--;
      if (depth === 0) return [str.slice(start, i), i + 1];
    }
  }
  throw new SelectorError('parentesis sin cerrar en: ' + str);
}

function parseNth(arg) {
  const t = arg.replace(/\s+/g, '').toLowerCase();
  if (t === 'odd') return [2, 1];
  if (t === 'even') return [2, 0];
  if (/^[+-]?\d+$/.test(t)) return [0, parseInt(t, 10)];
  const m = /^([+-]?\d*)n([+-]?\d+)?$/.exec(t);
  if (!m) throw new SelectorError('argumento nth invalido: ' + arg);
  let a;
  if (m[1] === '' || m[1] === '+') a = 1;
  else if (m[1] === '-') a = -1;
  else a = parseInt(m[1], 10);
  const b = m[2] ? parseInt(m[2], 10) : 0;
  return [a, b];
}

function nthMatches(index, a, b) {
  if (a === 0) return index === b;
  const d = index - b;
  return d % a === 0 && d / a >= 0;
}

// Parsea [attr], [attr=val], [attr*=val i], etc. str[i] === '['.
function parseAttrSelector(str, i) {
  i++;
  const skipWs = () => { while (i < str.length && /\s/.test(str[i])) i++; };
  skipWs();
  let name;
  [name, i] = parseIdent(str, i);
  skipWs();
  if (str[i] === ']') return [{ type: 'attr', name, op: null, value: null, ci: false }, i + 1];
  let op;
  if (str[i] === '=') { op = '='; i++; }
  else if ('~|^$*'.includes(str[i]) && str[i + 1] === '=') { op = str[i] + '='; i += 2; }
  else throw new SelectorError('operador de atributo invalido en: ' + str);
  skipWs();
  let value;
  if (str[i] === '"' || str[i] === "'") {
    const q = str[i];
    let v = '';
    i++;
    while (i < str.length && str[i] !== q) {
      if (str[i] === '\\' && i + 1 < str.length) { v += str[i + 1]; i += 2; }
      else { v += str[i]; i++; }
    }
    if (i >= str.length) throw new SelectorError('comilla sin cerrar en: ' + str);
    i++;
    value = v;
  } else {
    [value, i] = parseIdent(str, i);
  }
  skipWs();
  let ci = false;
  if (str[i] && /[is]/i.test(str[i]) && str[i + 1] !== undefined) {
    const flag = str[i].toLowerCase();
    const save = i;
    i++;
    skipWs();
    if (str[i] === ']') {
      ci = flag === 'i';
      return [{ type: 'attr', name, op, value, ci }, i + 1];
    }
    i = save;
  }
  if (str[i] !== ']') throw new SelectorError('se esperaba ] en: ' + str);
  return [{ type: 'attr', name, op, value, ci }, i + 1];
}

const SIMPLE_PSEUDOS = new Set([
  'first-child', 'last-child', 'only-child', 'first-of-type', 'last-of-type',
  'only-of-type', 'empty', 'root', 'link', 'any-link',
]);
const NEVER_MATCH_PSEUDOS = new Set([
  'hover', 'active', 'focus', 'focus-within', 'focus-visible', 'visited',
  'target', 'enabled', 'disabled', 'checked', 'indeterminate', 'read-only',
  'read-write', 'placeholder-shown', 'autofill', 'playing', 'paused',
  'seeking', 'buffering', 'stalled', 'muted', 'locked', 'selection',
  'marker', 'before', 'after', 'first-line', 'first-letter', 'backdrop',
  'placeholder', 'file-selector-button', 'grammar-error', 'spelling-error',
]);

function parsePseudo(str, i, compound) {
  // str[i] === ':'
  i++;
  let doubleColon = false;
  if (str[i] === ':') { doubleColon = true; i++; }
  let name;
  [name, i] = parseIdent(str, i);
  name = name.toLowerCase();
  if (str[i] === '(') {
    let inner;
    [inner, i] = parseParens(str, i);
    if (name === 'nth-child' || name === 'nth-last-child' || name === 'nth-of-type' || name === 'nth-last-of-type') {
      const [a, b] = parseNth(inner);
      compound.push({ type: 'pseudo', name, a, b });
      return i;
    }
    if (name === 'not' || name === 'is' || name === 'where' || name === 'matches') {
      compound.push({ type: 'pseudo', name: name === 'matches' ? 'is' : name, list: parseSelectorList(inner) });
      return i;
    }
    if (name === 'has') {
      compound.push({ type: 'pseudo', name, list: parseSelectorList(inner, true) });
      return i;
    }
    if (name === 'contains' || name === 'containsown') {
      let arg = inner.trim();
      if ((arg.startsWith('"') && arg.endsWith('"')) || (arg.startsWith("'") && arg.endsWith("'"))) {
        arg = arg.slice(1, -1);
      }
      arg = arg.replace(/\\(.)/g, '$1');
      compound.push({ type: 'pseudo', name, arg: arg.toLowerCase() });
      return i;
    }
    throw new SelectorError('pseudo-clase no soportada: :' + name + '()');
  }
  if (doubleColon || NEVER_MATCH_PSEUDOS.has(name)) {
    compound.push({ type: 'pseudo', name: '__never' });
    return i;
  }
  if (SIMPLE_PSEUDOS.has(name)) {
    compound.push({ type: 'pseudo', name });
    return i;
  }
  // pseudo desconocida sin argumentos: como el crate selectors, se rechaza
  throw new SelectorError('pseudo-clase desconocida: :' + name);
}

// Parsea un selector complejo (sin comas). Con `relative`, puede empezar con
// un combinador (forma de :has). Devuelve [{compound, combinatorToPrev}...]
// de izquierda a derecha.
function parseComplex(str, relative = false) {
  const parts = [];
  let i = 0;
  let pendingCombinator = relative ? ' ' : null;
  let first = true;
  while (i < str.length) {
    let sawWs = false;
    while (i < str.length && /\s/.test(str[i])) { sawWs = true; i++; }
    if (i >= str.length) break;
    const c = str[i];
    if (c === '>' || c === '+' || c === '~') {
      if (first && !relative) throw new SelectorError('combinador inicial en: ' + str);
      pendingCombinator = c;
      i++;
      continue;
    }
    if (sawWs && !first && pendingCombinator === null) pendingCombinator = ' ';
    if (first && pendingCombinator === null) pendingCombinator = relative ? ' ' : null;
    // compuesto
    const compound = [];
    if (c === '*') { compound.push({ type: 'universal' }); i++; }
    else if (/[a-zA-Z_-]/.test(c) || c === '\\' || c.charCodeAt(0) >= 0x80) {
      let tag;
      [tag, i] = parseIdent(str, i);
      compound.push({ type: 'tag', name: tag, lower: tag.toLowerCase() });
    }
    while (i < str.length) {
      const ch = str[i];
      if (ch === '#') { let v; [v, i] = parseIdent(str, i + 1); compound.push({ type: 'id', value: v }); }
      else if (ch === '.') { let v; [v, i] = parseIdent(str, i + 1); compound.push({ type: 'class', value: v }); }
      else if (ch === '[') { let a; [a, i] = parseAttrSelector(str, i); compound.push(a); }
      else if (ch === ':') { i = parsePseudo(str, i, compound); }
      else break;
    }
    if (!compound.length) throw new SelectorError('compuesto vacio en: ' + str);
    parts.push({ compound, combinator: first && !relative ? null : (pendingCombinator || ' ') });
    first = false;
    pendingCombinator = null;
  }
  if (!parts.length) throw new SelectorError('selector vacio');
  if (pendingCombinator) throw new SelectorError('combinador colgante en: ' + str);
  return parts;
}

function parseSelectorList(str, relative = false) {
  const groups = splitTopLevel(str, ',').map((g) => g.trim()).filter((g) => g.length);
  if (!groups.length) throw new SelectorError('lista de selectores vacia');
  return groups.map((g) => parseComplex(g, relative));
}

// Punto de entrada: devuelve el AST o lanza SelectorError.
function parseCssSelector(str) {
  if (typeof str !== 'string' || !str.trim()) throw new SelectorError('selector vacio');
  return parseSelectorList(str);
}

// --- coincidencia -----------------------------------------------------------

function matchCompound(node, compound) {
  for (const part of compound) {
    switch (part.type) {
      case 'universal':
        break;
      case 'tag': {
        const ok = node.foreign ? node.tag === part.name : node.tag === part.lower;
        if (!ok) return false;
        break;
      }
      case 'id':
        if (getAttr(node, 'id') !== part.value) return false;
        break;
      case 'class': {
        const cls = getAttr(node, 'class');
        if (!cls || !cls.split(/\s+/).includes(part.value)) return false;
        break;
      }
      case 'attr': {
        let v = getAttr(node, part.name);
        if (v === undefined) {
          // en contenido HTML los nombres de atributo van en minusculas
          if (!node.foreign) v = getAttr(node, part.name.toLowerCase());
          if (v === undefined) return false;
        }
        if (part.op === null) break;
        let value = part.value;
        if (part.ci) { v = v.toLowerCase(); value = value.toLowerCase(); }
        switch (part.op) {
          case '=': if (v !== value) return false; break;
          case '~=': if (!value || !v.split(/\s+/).includes(value)) return false; break;
          case '|=': if (v !== value && !v.startsWith(value + '-')) return false; break;
          case '^=': if (!value || !v.startsWith(value)) return false; break;
          case '$=': if (!value || !v.endsWith(value)) return false; break;
          case '*=': if (!value || !v.includes(value)) return false; break;
          default: return false;
        }
        break;
      }
      case 'pseudo':
        if (!matchPseudo(node, part)) return false;
        break;
      default:
        return false;
    }
  }
  return true;
}

function siblingIndex(node, ofType, fromEnd) {
  const parent = node.parent;
  if (!parent) return 1;
  let sibs = parent.children.filter((c) => c.t === 'element');
  if (ofType) sibs = sibs.filter((c) => c.tag === node.tag && c.foreign === node.foreign);
  const idx = sibs.indexOf(node);
  if (idx === -1) return 1;
  return fromEnd ? sibs.length - idx : idx + 1;
}

function matchPseudo(node, p) {
  switch (p.name) {
    case '__never': return false;
    case 'first-child': return prevElementSibling(node) === null;
    case 'last-child': return nextElementSibling(node) === null;
    case 'only-child': return prevElementSibling(node) === null && nextElementSibling(node) === null;
    case 'first-of-type': return siblingIndex(node, true, false) === 1;
    case 'last-of-type': return siblingIndex(node, true, true) === 1;
    case 'only-of-type': {
      const parent = node.parent;
      if (!parent) return true;
      return parent.children.filter((c) => c.t === 'element' && c.tag === node.tag).length === 1;
    }
    case 'nth-child': return nthMatches(siblingIndex(node, false, false), p.a, p.b);
    case 'nth-last-child': return nthMatches(siblingIndex(node, false, true), p.a, p.b);
    case 'nth-of-type': return nthMatches(siblingIndex(node, true, false), p.a, p.b);
    case 'nth-last-of-type': return nthMatches(siblingIndex(node, true, true), p.a, p.b);
    case 'empty':
      return !node.children.some((c) => c.t === 'element' || (c.t === 'text' && c.data.length > 0));
    case 'root':
      return !!node.parent && node.parent.t === 'document';
    case 'link':
    case 'any-link':
      return (node.tag === 'a' || node.tag === 'area') && getAttr(node, 'href') !== undefined;
    case 'contains':
      return elementText(node).toLowerCase().includes(p.arg);
    case 'containsown':
      return nodeOwnText(node).replace(/\s+/g, ' ').trim().toLowerCase().includes(p.arg);
    case 'not':
      return !p.list.some((complex) => matchComplex(node, complex, complex.length - 1, null));
    case 'is':
    case 'where':
      return p.list.some((complex) => matchComplex(node, complex, complex.length - 1, null));
    case 'has': {
      for (const complex of p.list) {
        if (matchHas(node, complex)) return true;
      }
      return false;
    }
    default:
      return false;
  }
}

// Coincidencia de un selector complejo contra `node` como extremo derecho.
// `boundary`: si se da, la cadena no puede subir mas alla de ese nodo
// (el propio boundary si puede coincidir con compuestos de la izquierda).
function matchComplex(node, parts, idx, boundary) {
  if (!node || node.t !== 'element') return false;
  if (!matchCompound(node, parts[idx].compound)) return false;
  if (idx === 0) return true;
  const comb = parts[idx].combinator || ' ';
  if (comb === '>') {
    if (boundary && node === boundary) return false;
    const parent = elementParent(node);
    return !!parent && matchComplex(parent, parts, idx - 1, boundary);
  }
  if (comb === ' ') {
    let parent = elementParent(node);
    while (parent) {
      if (matchComplex(parent, parts, idx - 1, boundary)) return true;
      if (boundary && parent === boundary) break;
      parent = elementParent(parent);
    }
    return false;
  }
  if (comb === '+') {
    const prev = prevElementSibling(node);
    return !!prev && matchComplex(prev, parts, idx - 1, boundary);
  }
  if (comb === '~') {
    let prev = prevElementSibling(node);
    while (prev) {
      if (matchComplex(prev, parts, idx - 1, boundary)) return true;
      prev = prevElementSibling(prev);
    }
    return false;
  }
  return false;
}

function matchHas(anchor, complex) {
  const firstComb = complex[0].combinator || ' ';
  let candidates;
  if (firstComb === '>') candidates = elementChildren(anchor);
  else if (firstComb === '+') {
    const n = nextElementSibling(anchor);
    candidates = n ? [n] : [];
  } else if (firstComb === '~') {
    candidates = [];
    let n = nextElementSibling(anchor);
    while (n) { candidates.push(n); n = nextElementSibling(n); }
  } else {
    candidates = descendants(anchor);
  }
  return candidates.some((cand) => matchComplex(cand, complex, complex.length - 1, anchor));
}

// --- consultas (equivalentes a scraper con "root" incluido) -------------------

function matchesSelectorList(node, ast) {
  return ast.some((complex) => matchComplex(node, complex, complex.length - 1, null));
}

// Como Html::select / ElementRef::select del crate scraper, pero incluyendo
// el propio elemento raiz si coincide (select_with_root de aidoku-rs).
function selectFromDocument(doc, ast) {
  return descendants(doc.root).filter((el) => matchesSelectorList(el, ast));
}

function selectFromElement(doc, node, ast) {
  const out = [];
  if (matchesSelectorList(node, ast)) out.push(node);
  for (const el of descendants(node)) {
    if (matchesSelectorList(el, ast)) out.push(el);
  }
  return out;
}

function selectFromList(doc, nodes, ast) {
  const out = [];
  for (const node of nodes) out.push(...selectFromElement(doc, node, ast));
  return out;
}

// attr con semantica de aidoku-rs: prefijo "abs:" resuelve contra la base.
function resolveAttr(doc, node, rawName) {
  let name = rawName;
  let abs = false;
  if (name.startsWith('abs:')) { abs = true; name = name.slice(4); }
  let v = getAttr(node, name);
  if (v === undefined && !node.foreign) v = getAttr(node, name.toLowerCase());
  if (v === undefined) return null;
  if (abs && doc.baseUrl) {
    try {
      return new URL(v, doc.baseUrl).href;
    } catch {
      return v;
    }
  }
  return v;
}

// Texto de un elemento con la semantica que el SDK de aidoku promete para
// `text()`: combinado, con el whitespace NORMALIZADO (cada racha de espacios/
// saltos colapsa a un espacio) y recortado. Es la semantica de SwiftSoup/jsoup
// del host nativo; el test-runner en Rust solo concatena y recorta, pero las
// fuentes se escriben contra el comportamiento documentado (p. ej. Weeb
// Central espera titulos como "Official One Piece" para recortar el prefijo).
function elementText(node) {
  return nodeText(node).replace(/\s+/g, ' ').trim();
}


// ===== host (fuente modular: worker-src.js) (worker-src.js) =====
// Host Aidoku en Web Worker (Fase 1).
// Transporte de red sincrono segun ADR-0001:
//   1) JSPI (WebAssembly.Suspending/promising) con fetch asincrono.
//   2) Respaldo universal sin transformar binarios: XHR sincrono en el worker.
// Semantica del ABI verificada en Fase 0 contra aidoku-rs (test-runner).




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
const HOST_BUILD = '1.8.0';
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
  // OJO: no anadir cabeceras personalizadas a las peticiones via proxy.
  // Una cabecera no-simple dispara preflight CORS, y el XHR sincrono del
  // respaldo no puede resolver preflights en Safari (el iPhone del usuario).
  // El UA lo pone el proxy (uno de navegador; el de Aidoku lo desafia
  // Cloudflare al salir desde un Worker: 403 en Weeb Central, Fase 2).
  const res = await fetch(effectiveUrl(req.url), init);
  const data = new Uint8Array(await res.arrayBuffer());
  const headers = new Map();
  res.headers.forEach((v, k) => headers.set(k.toLowerCase(), v));
  // url = la pedida por la fuente (con proxy, res.url seria la del proxy y
  // romperia la resolucion de URLs relativas/abs: del modulo html).
  return { status: res.status, data, headers, url: req.url };
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
    html: (rid) => {
      const req = ctx.store.get(rid);
      if (!req || req.kind !== 'request') return -1;
      if (!req.response) return -8;
      let text;
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(req.response.data);
      } catch { return -2; }
      const doc = parseHtmlDocument(text, req.response.url || req.url);
      return storeItem(ctx, { kind: 'htmlDoc', doc });
    },
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
      // OJO: los items 'string' se leen como UTF-8 CRUDO, sin prefijo
      // postcard (StoreItem::String -> s.as_bytes() en el test-runner).
      // Con prefijo, attr("abs:href") de Weeb Central devolvia la URL con un
      // byte de longitud delante y strip_prefix fallaba: 0 resultados.
      if (it.kind === 'string') return new TextEncoder().encode(it.value).length;
      return -1;
    },
    read_buffer: (rid, ptr, size) => {
      const it = ctx.store.get(rid);
      if (!it) return -1;
      const data = it.kind === 'encoded' ? it.data
        : it.kind === 'string' ? new TextEncoder().encode(it.value) : null;
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

  // Modulo html (Fase 2): semantica del test-runner de aidoku-rs
  // (imports/html.rs + libs/html.rs). Codigos: -1 descriptor invalido,
  // -2 string invalido, -4 selector invalido, -5 sin resultado.
  const traceHtml = (fn, q) => {
    try { if (globalThis.__tintaHtmlTrace) globalThis.__tintaHtmlTrace(fn, q); } catch { /* noop */ }
  };
  const readHostString = (ptr, len) => {
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(mem().slice(ptr, ptr + len));
    } catch { return null; }
  };
  const isHtmlItem = (it) => !!it && (it.kind === 'htmlDoc' || it.kind === 'htmlElement' || it.kind === 'htmlList');
  const selectRefs = (item, ast) => {
    if (item.kind === 'htmlDoc') {
      return selectFromDocument(item.doc, ast).map((node) => ({ doc: item.doc, node }));
    }
    if (item.kind === 'htmlElement') {
      return selectFromElement(item.doc, item.node, ast).map((node) => ({ doc: item.doc, node }));
    }
    return selectFromList(item.doc, item.elements.map((e) => e.node), ast)
      .map((node) => ({ doc: item.doc, node }));
  };
  const html = {
    select: (rid, ptr, len) => {
      const q = readHostString(ptr, len);
      if (q === null) return -2;
      const item = ctx.store.get(rid);
      if (!isHtmlItem(item)) return -1;
      let ast;
      try { ast = parseCssSelector(q); } catch { return -4; }
      traceHtml('select', q);
      return storeItem(ctx, { kind: 'htmlList', elements: selectRefs(item, ast) });
    },
    select_first: (rid, ptr, len) => {
      const q = readHostString(ptr, len);
      if (q === null) return -2;
      const item = ctx.store.get(rid);
      if (!isHtmlItem(item)) return -1;
      let ast;
      try { ast = parseCssSelector(q); } catch { return -4; }
      traceHtml('select_first', q);
      const refs = selectRefs(item, ast);
      if (!refs.length) return -5;
      return storeItem(ctx, { kind: 'htmlElement', ...refs[0] });
    },
    size: (rid) => {
      const item = ctx.store.get(rid);
      if (!item || item.kind !== 'htmlList') return -1;
      return item.elements.length;
    },
    first: (rid) => {
      const item = ctx.store.get(rid);
      if (!item || item.kind !== 'htmlList' || !item.elements.length) return -1;
      return storeItem(ctx, { kind: 'htmlElement', ...item.elements[0] });
    },
    last: (rid) => {
      const item = ctx.store.get(rid);
      if (!item || item.kind !== 'htmlList' || !item.elements.length) return -1;
      return storeItem(ctx, { kind: 'htmlElement', ...item.elements[item.elements.length - 1] });
    },
    get: (rid, index) => {
      const item = ctx.store.get(rid);
      if (!item || item.kind !== 'htmlList') return -1;
      const el = item.elements[index];
      if (!el) return -1;
      return storeItem(ctx, { kind: 'htmlElement', ...el });
    },
    attr: (rid, ptr, len) => {
      const key = readHostString(ptr, len);
      if (key === null) return -2;
      const item = ctx.store.get(rid);
      if (!isHtmlItem(item) || item.kind === 'htmlDoc') return -1;
      traceHtml('attr', key);
      let v = null;
      if (item.kind === 'htmlElement') {
        v = resolveAttr(item.doc, item.node, key);
      } else {
        for (const e of item.elements) {
          v = resolveAttr(e.doc, e.node, key);
          if (v !== null) break;
        }
      }
      return v === null ? -5 : storeItem(ctx, { kind: 'string', value: v });
    },
    text: (rid) => {
      const item = ctx.store.get(rid);
      if (!isHtmlItem(item) || item.kind === 'htmlDoc') return -1;
      traceHtml('text', '');
      const v = item.kind === 'htmlElement'
        ? elementText(item.node)
        : item.elements.map((e) => elementText(e.node)).join(' ');
      return storeItem(ctx, { kind: 'string', value: v });
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

  // Modulos aun no implementados: stubs con error limpio (js, canvas)
  const stubModule = () => new Proxy({}, { get: (_t, name) => (typeof name === 'string' ? () => -2 : undefined) });

  return { env, std, net, defaults, html, js: stubModule(), canvas: stubModule() };
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
