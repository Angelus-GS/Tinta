// Fase 0 spike: instancia un .aix con imports stub y llama start()
const fs = require('fs');
const path = process.argv[2];
const bytes = fs.readFileSync(path);

const stub = (name) => (...args) => {
  console.log(`  [stub] ${name}(${args.join(', ')}) -> 0`);
  return 0;
};

async function main() {
  const mod = await WebAssembly.compile(bytes);
  const importsDesc = WebAssembly.Module.imports(mod);
  const importObj = {};
  for (const d of importsDesc) {
    (importObj[d.module] ??= {})[d.name] = stub(`${d.module}.${d.name}`);
  }
  // env.abort debe interrumpir, no seguir como si nada
  importObj.env.abort = (...a) => { throw new Error(`wasm abort(${a.join(',')})`); };
  const instance = await WebAssembly.instantiate(mod, importObj);
  const ex = instance.exports;
  console.log(`Instanciado OK: ${path}`);
  console.log(`start() ->`, ex.start());
  console.log('exports listos:', Object.keys(ex).filter(k => typeof ex[k] === 'function').join(', '));
}
main().catch(e => { console.error('FALLO:', e.message); process.exit(1); });
