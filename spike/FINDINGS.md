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

---

# Fase 2 — Hallazgos del módulo `html` (2026-10-16)

**Resultado:** Weeb Central v8 corre el flujo completo sin tocar su `.aix`:
búsqueda “One Piece” → 5 resultados; detalle con autor, tags, estado y
**1196 capítulos**; capítulo con **17 páginas**. Verificado en Node y en
Chromium real (JSPI **y** respaldo XHR síncrono), siempre a través del
proxy desplegado. El motor vive en `app/lib/html.js` (parser HTML5 +
selectores CSS en JS puro, sin DOM) e implementa las 8 funciones `html`
que la fuente importa (`select`, `select_first`, `size`, `first`, `last`,
`get`, `attr`, `text`) más `net.html`, con los códigos de error del
test-runner (-1/-2/-4/-5). La semántica se tomó de
`crates/test-runner/src/imports/html.rs` y `src/libs/html.rs` de aidoku-rs
(copias en `spike/aidoku-rs-ref/html.rs` y `libs-html.rs`).

## Tres minas que la Fase 1 no había pisado

1. **`std.read_buffer` de un item String es UTF-8 CRUDO, no postcard.**
   El host de Fases 0/1 devolvía las cadenas `string` con el prefijo de
   longitud postcard (`encString`). MangaDex nunca lo notó porque no lee
   cadenas del host en sus flujos de aceptación; Weeb Central sí:
   `attr("abs:href")` llegaba como `")https://weebcentral.com/…"`,
   `strip_prefix` fallaba en silencio y la búsqueda daba **0 resultados
   sin error**. La referencia (`libs/store.rs::as_encoded`) es tajante:
   `StoreItem::String → s.as_bytes()`. Corregido en `app/worker-src.js`.
2. **`text()` normaliza el whitespace** (semántica SwiftSoup/jsoup que el
   SDK documenta: “normalized, combined text”), aunque el test-runner en
   Rust solo concatene y recorte. Las fuentes se escriben contra la
   documentación: Weeb Central espera `"Official One Piece"` en una línea
   para recortar el prefijo `Official `; con la concatenación cruda el
   título salía con saltos de línea y el recorte no aplicaba. El motor
   implementa la normalización (y `:contains()` insensible a mayúsculas
   sobre ese texto, también documentado).
3. **El proxy y Cloudflare, en dos actos.** (a) El UA por defecto del
   proxy (el de Aidoku) lo desafía Cloudflare al salir desde un Worker:
   403 en `weebcentral.com` con cualquier otro header correcto; con UA de
   navegador pasa (también desde el iPhone, cuyo Safari trae UA válido).
   El proxy ahora usa por defecto un UA de navegador. (b) Nada de
   cabeceras personalizadas desde el host: una sola (`x-tinta-ua`) bastó
   para disparar preflight CORS en cada petición, y el XHR síncrono del
   respaldo no puede resolver preflights en Safari. El host ya no añade
   cabeceras al pasar por el proxy; el mecanismo `x-tinta-ua` queda en el
   proxy (con su `Access-Control-Allow-Headers` corregido) por si un
   cliente fetch/JSPI lo necesita.

## Proxy: allowlist

- `temp.compsci88.com` (CDN de portadas y páginas de Weeb Central) se
  sumó a la allowlist y se redesplegó; portada y página verificadas a
  través del proxy (200, imagen real).

## Selectores ejercitados de verdad (trazados en ejecución)

`article:has(section)`, `section[x-data] > section`,
`ul > li:has(strong:contains(Author|Tag|Type|Status)) …`,
`li:has(strong:contains(Description)) > p`, `div[x-data]`,
`span.flex > span`, `time[datetime]`, `section[x-data*=scroll] > img`,
`article:not(.hidden)`, `.text-lg`, `main a` — el motor soporta además
`:nth-*`, `:is/:where/:not` con selectores complejos, `:has` con
combinador inicial, atributos `~= | = ^ = $ = * =` con bandera `i`, y el
detalle `select` con raíz incluida (`select_with_root` de aidoku-rs: el
propio elemento cuenta si coincide).
