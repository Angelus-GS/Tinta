// Genera app/host-worker.js (worker CLASICO de un solo archivo) desde las
// fuentes modulares: lib/postcard.js + lib/types.js + lib/unzip.js + worker-src.js
// Motivo: Safari ha sido históricamente frágil con workers de tipo módulo;
// el worker clásico autocontenido corre en cualquier navegador.
import { readFileSync, writeFileSync } from 'node:fs';

const strip = (src) => src
  .replace(/^import[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm, '')   // imports multilinea y simples
  .replace(/^import\s+['"][^'"]+['"];?\s*$/gm, '')
  .replace(/^export\s*\{[^}]*\};?\s*$/gm, '')                    // export { ... }
  .replace(/^export\s+(?=(async\s+)?(function|class|const|let|var)\s)/gm, '');

const parts = [
  ['lib/postcard.js', 'postcard'],
  ['lib/types.js', 'tipos Aidoku'],
  ['lib/unzip.js', 'unzip .aix'],
  ['lib/html.js', 'motor HTML (parser + selectores CSS)'],
  ['worker-src.js', 'host (fuente modular: worker-src.js)'],
];
let out = `// GENERADO por e2e/bundle-worker.mjs — NO editar a mano.
// Worker clásico autocontenido de Tinta (host Aidoku). Fuentes:
// lib/postcard.js, lib/types.js, lib/unzip.js y worker-src.js en este repo.\n`;
for (const [file, label] of parts) {
  out += `\n// ===== ${label} (${file}) =====\n` + strip(readFileSync(new URL('../app/' + file, import.meta.url), 'utf8'));
}
writeFileSync(new URL('../app/host-worker.js', import.meta.url), out);
console.log('host-worker.js generado:', out.length, 'bytes');
