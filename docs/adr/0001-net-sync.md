# ADR-0001: Cómo resolver `net.send` síncrono en el navegador

- **Estado:** aceptado (2026-10-15, cierre de Fase 0)
- **Contexto:** SPEC §5.4

## Contexto

El ABI de Aidoku es síncrono: la fuente llama `net.send(rid)` y espera el
resultado *al volver la llamada*. En la web, `fetch` es asíncrono y el hilo
principal no puede bloquear. El host vive en un Web Worker, donde bloquear
es tolerable pero sigue requiriendo un mecanismo para esperar una promesa
desde código WASM síncrono.

Opciones evaluadas (verificadas en Fase 0):

1. **JSPI** (JavaScript Promise Integration): el WASM se suspende de forma
   nativa mientras la promesa se resuelve. Disponible por defecto en
   Chrome/Edge 137+ y Firefox 153; en Safari llegó con la 27 (2026) —
   Safari 26 y anteriores no lo tienen.
2. **Asyncify** (Binaryen): transforma el `.aix` al instalarlo para que
   pueda pausar/reanudar. Funciona en todo navegador con WASM, a cambio de
   ~30–50% más tamaño de binario y overhead por llamada. Una sola
   suspensión concurrente por instancia (suficiente: el host serializa las
   llamadas de cada fuente de todos modos).
3. **Worker + `Atomics.wait` + SharedArrayBuffer**: exige aislamiento
   cross-origin (cabeceras COOP/COEP). **GitHub Pages no puede emitir
   cabeceras personalizadas**, así que esta ruta obligaría a mover el
   hosting a Cloudflare Pages y asumir sus efectos colaterales (recursos
   cross-origin sin CORP quedan bloqueados).

## Decisión

**Detección en runtime, en este orden:**

1. Si `WebAssembly.Suspending` existe → **JSPI** (ruta principal).
2. Si no → **Asyncify**: la transformación se aplica **al instalar la
   fuente**, sobre una copia del `.aix`; el paquete original nunca se
   muta. La versión transformada se cachea junto a la fuente instalada.

La ruta SAB/`Atomics.wait` queda **descartada como mecanismo por defecto**
(no se prohíbe como experimento futuro si el hosting migra a Cloudflare
Pages por otras razones).

## Consecuencias

- El dispositivo objetivo deja de ser una apuesta binaria: Chromium y
  Safari 27+ usan la ruta rápida; Safari ≤26 y Firefox viejos degradan a
  Asyncify sin perder funcionalidad.
- El spike de Fase 0 usó HTTP bloqueante en Node solo como referencia
  semántica (es lo que hace el test-runner oficial con `reqwest::blocking`);
  ninguna línea de ese transporte se reutiliza en el navegador.
- La instalación de fuentes incluye un paso de transformación opcional:
  hay que medir su costo con los `.aix` reales (MangaDex: 636 KB) en Fase 1.
- El proxy anti-CORS (SPEC §6) no cambia: con JSPI o Asyncify, el `fetch`
  del host sigue pasando por el Worker de Cloudflare.
