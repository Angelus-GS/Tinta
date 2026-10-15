# Fase 0 — Hallazgos del spike del ABI Aidoku

Fecha: 2026-10-15. Entorno: Node 24 (host de referencia), paquetes reales del
catálogo comunitario: **MangaDex v14** (`multi.mangadex`) y **Weeb Central v8**
(`en.weebcentral`).

## Resultado principal

**El ABI de Aidoku SÍ se puede alojar fuera de la app nativa.** Con un host
escrito desde cero en JavaScript (~350 líneas) se ejecutó la cadena completa
de lectura contra la API real, sin modificar los `.aix`:

1. Instanciar `main.wasm` y llamar `start()`. ✅ (ambas fuentes)
2. `get_search_manga_list("One Piece")` → HTTP 200 a `api.mangadex.org`,
   resultado postcard decodificado **byte-exacto**: 20 entradas,
   `has_next_page=true`. ✅
3. `get_manga_update(details, chapters)` → One Piece: status *Ongoing*,
   autor "Oda Eiichirou (尾田栄一郎)", 929 capítulos decodificados
   byte-exacto (149,928/149,928 bytes). ✅
4. `get_page_list` → Yotsuba to!: 51 páginas; la primera URL
   (`*.mangadex.network`) respondió **HTTP 200, image/png, 3.9 MB**. ✅

## Correcciones a la documentación de terceros del ABI

Verificadas contra los binarios y contra el código de `aidoku-rs`
(la implementación de referencia es su `test-runner`):

1. **Layout del `.aix`**: todo vive en `Payload/` (`source.json`,
   `filters.json`, `settings.json`). No existe carpeta `res/` en los
   paquetes actuales. (Errata ya aplicada a SPEC §4.)
2. **Orden de `HttpMethod`**: 0=GET, 1=POST, 2=PUT, **3=HEAD, 4=DELETE,
   5=PATCH**, 6=OPTIONS, 7=CONNECT, 8=TRACE. (El doc externo decía
   5=HEAD: incorrecto.)
3. **`net.send(rid)` NO devuelve un rid de respuesta**: devuelve un código
   (0 = éxito, negativos = error). La respuesta queda colgada del *propio
   rid de la petición*; `data_len`/`read_data`/`get_status_code`/
   `get_header` operan sobre ese rid.
4. **Parámetros String de los exports = UTF-8 crudo** (se leen con
   `read_string`), NO postcard. Con postcard, el byte de longitud se cuela
   como carácter en la query (visto en vivo: `title=%09One%20Piece`).
   Los parámetros compuestos (filtros, descriptores Manga/Chapter) SÍ van
   en postcard.
5. **Buffer de resultado**: `[len i32 LE][capacidad i32 LE][payload
   postcard]`, donde `len` incluye los 8 bytes del prefijo. Error de la
   fuente: `len = -1` y el mensaje viaja tras el prefijo (p. ej.
   `"Missing chapter data"`).
6. **`defaults` se siembra desde `settings.json`** (select→String,
   switch→Bool, multi-select/editable-list→StringArray), y la clave
   **`languages`** no está en `settings.json`: la provee la app anfitriona.
   Sin siembra, la fuente falla con error elegante
   (`Unable to fetch default content ratings`).
7. **`start()` devuelve void** y su primer acto es registrar el rate limit
   de la fuente (`net.set_rate_limit` — MangaDex: 5, Weeb: 1).
8. **`env.print(ptr, len)`** lee la cadena de la memoria del WASM;
   `env.abort()` no lleva argumentos.

## Hallazgo de dominio (importante para el roadmap)

En MangaDex, `Chapter.locked` mapea `isUnavailable` de su API: series muy
populares (One Piece, Frieren de Kirei Cake, Dandadan) tienen **todos** sus
capítulos marcados no disponibles — el endpoint `at-home` responde 404
aunque la metadata y el conteo de páginas existen. No es un fallo del host:
es el estado real del catálogo en 2026, y es exactamente el motivo por el
que el host debe soportar **varias fuentes** (de ahí Weeb Central como
segunda fuente de aceptación).

## Red síncrona

En Node el spike usó HTTP bloqueante (equivalente semántico al
`reqwest::blocking` del test-runner oficial). La decisión para el navegador
está en `docs/adr/0001-net-sync.md`.

## Pendientes que el spike NO cubre (por diseño)

- Módulo `html` completo (Weeb Central) → Fase 2. Su WASM ya instancia y
  `start()` corre; importa solo 8 funciones `html` en v8.
- `get_home`, `get_listings`, `get_alternate_covers`, `get_image_request`,
  `handle_deep_link`: firmas auditadas, aún no ejercitadas.
- Ejecutar el host en un navegador real (Worker) → Fase 1.
