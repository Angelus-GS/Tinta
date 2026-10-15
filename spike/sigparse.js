// Parsea la seccion de tipos (1) e imports (2) de un wasm y resuelve firmas
const fs = require('fs');
const buf = fs.readFileSync(process.argv[2]);
let p = 8; // magic + version
function uleb() { let r = 0, s = 0; while (true) { const b = buf[p++]; r |= (b & 0x7f) << s; if (!(b & 0x80)) return r >>> 0; s += 7; } }
const VT = { 0x7f: 'i32', 0x7e: 'i64', 0x7d: 'f32', 0x7c: 'f64', 0x70: 'funcref', 0x6f: 'externref' };
const types = [], imports = [], exports_ = [];
let funcTypeIdx = [];
while (p < buf.length) {
  const sec = buf[p++]; const size = uleb(); const end = p + size;
  if (sec === 1) { const n = uleb(); for (let i = 0; i < n; i++) { p++; /*0x60*/ const np = uleb(); const params = []; for (let j = 0; j < np; j++) params.push(VT[buf[p++]]); const nr = uleb(); const results = []; for (let j = 0; j < nr; j++) results.push(VT[buf[p++]]); types.push({ params, results }); } }
  else if (sec === 2) { const n = uleb(); for (let i = 0; i < n; i++) { const ml = uleb(); const module = buf.toString('utf8', p, p + ml); p += ml; const nl = uleb(); const name = buf.toString('utf8', p, p + nl); p += nl; const kind = buf[p++]; if (kind === 0) { const t = uleb(); imports.push({ module, name, type: t }); funcTypeIdx.push(t); } else if (kind === 1) { p++; p++; if (buf[p-1] & 1) uleb(); } else if (kind === 2) { const fl = buf[p++]; uleb(); if (fl) uleb(); } else if (kind === 3) { p += 2; } } }
  else if (sec === 3) { const n = uleb(); for (let i = 0; i < n; i++) funcTypeIdx.push(uleb()); }
  else if (sec === 7) { const n = uleb(); for (let i = 0; i < n; i++) { const nl = uleb(); const name = buf.toString('utf8', p, p + nl); p += nl; const kind = buf[p++]; const idx = uleb(); exports_.push({ name, kind, idx }); } }
  p = end;
}
const sig = t => `(${t.params.join(',')}) -> (${t.results.join(',')})`;
console.log('IMPORTS con firma:');
for (const i of imports) console.log(`  ${i.module}.${i.name} ${sig(types[i.type])}`);
console.log('EXPORTS funcion con firma:');
let fi = imports.filter(x => x).length; // offset de funciones importadas
const importedFuncs = imports.length;
for (const e of exports_.filter(e => e.kind === 0)) {
  const tIdx = funcTypeIdx[e.idx];
  console.log(`  ${e.name} ${sig(types[tIdx])}`);
}
