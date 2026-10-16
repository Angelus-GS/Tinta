# Tinta

**Tinta** es un lector de manga como **PWA** que funciona como *host* de fuentes **Aidoku**
(`.aix`, WebAssembly) en el navegador.

No es un port de KOReader. La apuesta es otra: las fuentes que Rakuyomi corre
sobre KOReader ya son WebAssembly (el ecosistema Aidoku), así que en vez de
portar el lector, portamos el **runtime de fuentes** a la web.

## Estado

📄 **Fases 0, 1 y 2 completas.** El diseño vive en [SPEC.md](SPEC.md)
(v0.1, 2026-10-14). La **Fase 0** demostró el ABI con un host en Node
contra la API real (detalle en [spike/FINDINGS.md](spike/FINDINGS.md) y
[docs/adr/0001-net-sync.md](docs/adr/0001-net-sync.md)). La **Fase 1**
llevó ese host a un Web Worker dentro de la PWA (`app/`) y se verificó
en un Chromium real: **JSPI activo**, MangaDex instalada desde el
catálogo, búsqueda, detalle con 137 capítulos de Yotsuba y un capítulo
leído con **49/49 páginas cargadas**. La **Fase 2** (v1.4.0) añadió el
módulo `html` — parser y selectores CSS en JS puro — y Weeb Central
corre el mismo flujo completo (5 resultados para “One Piece”, 1196
capítulos, 17/17 páginas de un capítulo), en ambos transportes de red.
Para usarla fuera de `localhost` hace falta desplegar el proxy
(`proxy/`, guía incluida) y pegar su URL en Ajustes. Lo siguiente es
la Fase 3: biblioteca y descargas offline.

## Fuentes de aceptación

El host se considera correcto solo si corre las dos, sin código especial
para ninguna:

- **MangaDex** — API REST/JSON (ejercita `net`, `defaults`, postcard).
- **Weeb Central** — scraper HTML (ejercita el módulo `html` completo).

## Arquitectura en 30 segundos

```
PWA UI  ⇄  Source Host (Web Worker)  ⇄  fuente .aix (WASM)
                     │  imports Aidoku: net · html · std · defaults · js
                     ▼
              Proxy (Cloudflare Worker, anti-CORS + allowlist)
                     ▼
        api.mangadex.org · weebcentral.com · CDNs de imágenes

Persistencia local: IndexedDB (biblioteca/progreso) + OPFS (descargas)
```

El problema duro, declarado desde la spec: el ABI de Aidoku espera red
**síncrona** y `fetch` es asíncrono. La Fase 0 es un spike para resolverlo
(JSPI vs Asyncify vs Worker + `Atomics.wait`) y dejarlo en un ADR antes de
escribir el host completo.

## Roadmap

| Fase | Qué |
|---|---|
| 0 ✅ | Spike ABI: `.aix` real contra API real (buscar → capítulos → páginas) + ADR de red síncrona |
| 1 ✅ | MVP MangaDex de principio a fin (instalar → buscar → leer), verificado en Chromium real con JSPI |
| 2 ✅ | Weeb Central: módulo `html` completo (parser + selectores CSS en JS puro), verificado en Chromium en ambos transportes |
| 3 | Biblioteca, descargas offline, exportar CBZ |
| 4 | Más fuentes del catálogo Aidoku, EPUB/PDF locales (posterior) |

## Límites honestos

- Sin fuentes que requieran webview interactivo (login / anti-bot).
- Sin plugins Lua de KOReader.
- Sin evasión de DRM, paywalls ni protecciones anti-bot.
