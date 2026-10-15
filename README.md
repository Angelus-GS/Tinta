# Tinta

**Tinta** es un lector de manga como **PWA** que funciona como *host* de fuentes **Aidoku**
(`.aix`, WebAssembly) en el navegador.

No es un port de KOReader. La apuesta es otra: las fuentes que Rakuyomi corre
sobre KOReader ya son WebAssembly (el ecosistema Aidoku), así que en vez de
portar el lector, portamos el **runtime de fuentes** a la web.

## Estado

📄 **Spec primero, spike ya corrido.** El diseño vive en [SPEC.md](SPEC.md)
(v0.1, 2026-10-14). La **Fase 0 está completa**: un host mínimo en Node
ejecutó el `.aix` real de MangaDex contra su API — buscar, detalle con
capítulos y lista de páginas, todo decodificado — y el ADR de red síncrona
quedó aceptado. Detalle en [spike/FINDINGS.md](spike/FINDINGS.md) y
[docs/adr/0001-net-sync.md](docs/adr/0001-net-sync.md). Lo siguiente es la
Fase 1: el host en un Web Worker dentro de la PWA.

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
| 1 | MVP MangaDex de principio a fin (instalar → buscar → leer) |
| 2 | Weeb Central: módulo `html` completo |
| 3 | Biblioteca, descargas offline, exportar CBZ |
| 4 | Más fuentes del catálogo Aidoku, EPUB/PDF locales (posterior) |

## Límites honestos

- Sin fuentes que requieran webview interactivo (login / anti-bot).
- Sin plugins Lua de KOReader.
- Sin evasión de DRM, paywalls ni protecciones anti-bot.
