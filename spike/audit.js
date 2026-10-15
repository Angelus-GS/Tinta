// Fase 0 spike: audita imports/exports reales de un .aix (main.wasm)
const fs = require('fs');
const path = process.argv[2];
const bytes = fs.readFileSync(path);
const mod = new WebAssembly.Module(bytes);
const imports = WebAssembly.Module.imports(mod);
const exports_ = WebAssembly.Module.exports(mod);
const byMod = {};
for (const i of imports) {
  (byMod[i.module] ??= []).push(`${i.name}:${i.kind}`);
}
console.log(`== ${path} (${bytes.length} bytes) ==`);
for (const m of Object.keys(byMod).sort()) {
  console.log(`IMPORTS ${m} (${byMod[m].length}): ${byMod[m].join(', ')}`);
}
const fns = exports_.filter(e => e.kind === 'function').map(e => e.name);
const other = exports_.filter(e => e.kind !== 'function').map(e => `${e.name}:${e.kind}`);
console.log(`EXPORTS functions (${fns.length}): ${fns.join(', ')}`);
console.log(`EXPORTS other: ${other.join(', ')}`);
