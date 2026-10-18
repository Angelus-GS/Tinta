// Tinta — UI de la PWA (flujo: instalar → buscar → detalle → leer, con
// biblioteca, descargas offline, CBZ local y progreso de lectura).
import { idb } from './lib/idb.js';
import { MangaStatus, ContentRating } from './lib/types.js';
import { unzip } from './lib/unzip.js';

window.__tintaBooted = false;

// Versión visible de la app: súbela (y la cache del SW) en cada publicación.
// El host reporta la suya (HOST_BUILD en worker-src.js); si difieren, la
// actualización llegó a medias a este dispositivo.
const APP_VERSION = '1.8.0';

const CATALOG_BASE = 'https://aidoku-community.github.io/sources/';
const ANCHORS = ['multi.mangadex', 'en.weebcentral'];
const $ = (sel) => document.querySelector(sel);

// Preferencias del lector (localStorage, se editan en Ajustes).
const pref = {
  readerMode: () => localStorage.getItem('tinta.readerMode') || 'scroll',
  pageDir: () => localStorage.getItem('tinta.pageDir') || 'ltr',
  pageFit: () => localStorage.getItem('tinta.pageFit') || 'ajustar',
  // Orden de la lista de capítulos: 'asc' = del más viejo al más nuevo
  // (defecto, como pidió el usuario) · 'desc' = del más nuevo al más viejo.
  chapterOrder: () => localStorage.getItem('tinta.chapterOrder') || 'asc',
  // Fondo del lector: 'negro' (defecto) · 'papel' (cálido) · 'blanco'.
  readerBg: () => localStorage.getItem('tinta.readerBg') || 'negro',
  preloadCount: () => {
    const n = parseInt(localStorage.getItem('tinta.preloadCount') ?? '1', 10);
    return Number.isFinite(n) ? Math.min(3, Math.max(0, n)) : 1;
  },
};

// Portadas y páginas también viajan por el proxy cuando está configurado:
// en algunas redes los dominios de imágenes de MangaDex no responden en
// directo, y el proxy ya los trae en su lista permitida.
function imgUrl(u) {
  if (!u) return u;
  const base = localStorage.getItem('tinta.proxyBase') || '';
  if (!base) return u;
  return base.replace(/\/?$/, '/') + '?u=' + encodeURIComponent(u);
}

// Si el proxy no puede con una imagen (p. ej. un CDN de scanlation que aún
// no está en su lista), reintentar en directo una sola vez: las imágenes no
// necesitan CORS y muchos CDN sí responden al navegador tal cual.
function armImgFallback(img, originalUrl) {
  if (!img || !originalUrl || img.src === originalUrl) return;
  img.addEventListener('error', () => { img.src = originalUrl; }, { once: true });
}
function wireImgFallbacks(container) {
  container.querySelectorAll('img[data-direct]').forEach((img) => armImgFallback(img, img.dataset.direct));
}

const libKeyOf = (sourceId, mangaKey) => `${sourceId}::${mangaKey}`;
const dlKeyOf = (sourceId, mangaKey, chapterKey) => `${sourceId}::${mangaKey}::${chapterKey}`;
const padIdx = (i) => String(i).padStart(5, '0');

function chapterLabelOf(ch) {
  return [
    ch.chapter_number != null ? `Cap. ${ch.chapter_number}` : '',
    ch.volume_number != null ? `Vol. ${ch.volume_number}` : '',
    ch.title || '',
  ].filter(Boolean).join(' — ') || ch.key;
}

const state = {
  catalog: [],
  installed: new Map(), // id -> { id, name, version, iconUrl }
  currentSource: null,
  mode: 'search',        // 'search' | 'listing'
  listingId: null,
  page: 1,
  lastQuery: '',
  currentManga: null,
  currentChapters: [],
  chapterPage: 0,        // página vigente de la lista de capítulos paginada
  chapterPages: [],      // páginas calculadas de la lista (ver buildChapterPages)
  downloaded: new Set(), // dlKeys con descarga completa
  downloading: new Map(), // dlKey -> { done, total }
  reader: null,          // sesión del lector en curso
};

// --- Worker client ---------------------------------------------------------
// Worker clásico autocontenido (ver e2e/bundle-worker.mjs): Safari ha sido
// frágil con workers de tipo módulo; el clásico corre en todos lados.
const worker = new Worker('host-worker.js');
const pending = new Map();
let seq = 1;
let workerReady = null;

function call(msg) {
  return new Promise((resolve, reject) => {
    const id = seq++;
    pending.set(id, { resolve, reject });
    worker.postMessage({ ...msg, id });
  });
}

worker.onmessage = (e) => {
  const d = e.data;
  if (d.type === 'ready') {
    workerReady = d;
    return;
  }
  if (d.type === 'partial') return; // los parciales no se pintan aún
  const p = pending.get(d.id);
  if (!p) return;
  pending.delete(d.id);
  if (d.ok) p.resolve(d.result);
  else p.reject(new Error(d.error));
};
worker.onerror = (e) => toast(`Error del worker: ${e.message}`, true);

// --- Utilidades UI ---------------------------------------------------------
function toast(msg, isError = false) {
  const el = $('#toast');
  el.textContent = msg;
  el.className = isError ? 'error' : '';
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.hidden = true; }, isError ? 7000 : 3500);
}

function show(view) {
  for (const id of ['view-sources', 'view-browse', 'view-manga', 'view-reader']) {
    document.getElementById(id).hidden = id !== view;
  }
  if (view !== 'view-reader') setImmersive(false);
  window.scrollTo(0, 0);
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

// --- Fuentes ---------------------------------------------------------------
async function installFromCatalog(entry, { silent = false } = {}) {
  const res = await fetch(CATALOG_BASE + entry.downloadURL);
  if (!res.ok) throw new Error(`No se pudo descargar ${entry.name} (HTTP ${res.status})`);
  const aixBytes = await res.arrayBuffer();
  await idb.putSource({
    id: entry.id, name: entry.name, version: entry.version, aixBytes,
  });
  const info = await call({ type: 'install', aixBytes });
  registerInstalled(entry.id, entry.name, info.version, info.icon);
  if (!silent) toast(`${entry.name} instalada`);
}

function registerInstalled(id, name, version, iconBytes) {
  let iconUrl = null;
  if (iconBytes) {
    const bytes = iconBytes instanceof Uint8Array ? iconBytes : new Uint8Array(iconBytes);
    iconUrl = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));
  }
  state.installed.set(id, { id, name, version, iconUrl });
  renderInstalled();
}

async function restoreInstalled() {
  const records = await idb.allSources();
  for (const rec of records) {
    try {
      const info = await call({ type: 'install', aixBytes: rec.aixBytes });
      registerInstalled(rec.id, rec.name, info.version, info.icon);
    } catch (err) {
      console.warn('No se pudo restaurar', rec.id, err);
    }
  }
}

function renderInstalled() {
  const box = $('#installed');
  if (!state.installed.size) {
    box.innerHTML = '<p class="hint">Ninguna todavía. Instala MangaDex desde el catálogo.</p>';
    return;
  }
  box.innerHTML = '';
  for (const s of state.installed.values()) {
    const row = document.createElement('div');
    row.className = 'source-row';
    row.innerHTML = `
      ${s.iconUrl ? `<img src="${s.iconUrl}" alt="">` : '<img alt="">'}
      <div class="meta"><b>${esc(s.name)}</b><span>v${esc(s.version)} · ${esc(s.id)}</span></div>
      <button type="button" data-open="${esc(s.id)}">Abrir</button>
      <button type="button" class="danger" data-uninstall="${esc(s.id)}">Quitar</button>`;
    box.appendChild(row);
  }
}

function renderCatalog(filter = '') {
  const box = $('#catalog');
  const f = filter.trim().toLowerCase();
  const entries = state.catalog
    .filter((s) => !f || s.name.toLowerCase().includes(f) || s.id.includes(f))
    .sort((a, b) => (ANCHORS.indexOf(b.id) === -1 ? 0 : 1) - (ANCHORS.indexOf(a.id) === -1 ? 0 : 1)
      || a.name.localeCompare(b.name));
  box.innerHTML = '';
  for (const s of entries.slice(0, 120)) {
    const isInstalled = state.installed.has(s.id);
    const row = document.createElement('div');
    row.className = 'source-row';
    row.innerHTML = `
      <img src="${CATALOG_BASE}${esc(s.iconURL)}" alt="" loading="lazy">
      <div class="meta"><b>${esc(s.name)}${ANCHORS.includes(s.id) ? '<span class="badge">ancla del proyecto</span>' : ''}</b>
      <span>${esc(s.id)} · v${s.version} · ${esc((s.languages || []).join(', '))}</span></div>
      <button type="button" data-install="${esc(s.id)}" ${isInstalled ? 'disabled' : ''}>${isInstalled ? 'Instalada' : 'Instalar'}</button>`;
    box.appendChild(row);
  }
  if (!entries.length) box.innerHTML = '<p class="hint">Sin coincidencias.</p>';
}

// --- Biblioteca --------------------------------------------------------------
// Entradas del riel «Seguir leyendo» descartadas a mano (✕): se recuerda el
// updatedAt descartado; si el avance cambia (sigues leyendo), la entrada
// reaparece sola. Quitar la tarjeta NUNCA borra el avance del manga.
function continueDismissed() {
  try { return JSON.parse(localStorage.getItem('tinta.continueDismissed') || '{}'); }
  catch { return {}; }
}
function dismissContinue(key, updatedAt) {
  const d = continueDismissed();
  d[key] = updatedAt;
  localStorage.setItem('tinta.continueDismissed', JSON.stringify(d));
}

// Abrir desde el riel: libros locales van a su lector; series de una fuente
// pasan por su detalle (carga capítulos frescos) y de ahí al capítulo
// guardado, que openChapter retoma en la página exacta.
async function openFromContinue(p) {
  if (p.sourceId === 'local') {
    const book = await idb.getLocalBook(p.mangaKey);
    if (book) { await openLocalBook(book); return; }
    toast('Ese libro local ya no está en este dispositivo', true);
    return;
  }
  if (!state.installed.has(p.sourceId)) {
    toast('Esa fuente no está instalada en este dispositivo', true);
    return;
  }
  state.currentSource = p.sourceId;
  // Con registro en biblioteca se entra por su snapshot (Manga completo,
  // re-serializable); sin registro solo queda el stub mínimo y el detalle
  // puede no cargar capítulos frescos (límite conocido del stub).
  const libRec = await idb.getLibrary(p.key);
  if (libRec) await openManga(libRec.stub, { snapshot: libRec.snapshot });
  else await openManga({ key: p.mangaKey, title: p.title, cover: p.cover });
  const ch = state.currentChapters.find((c) => c.key === p.lastChapterKey);
  if (ch && !ch.locked && state.currentManga) {
    await openChapter(state.currentManga, ch, chapterLabelOf(ch));
  }
}

async function renderLibrary() {
  const box = $('#library');
  if (!box) return;
  const [lib, books, progress] = await Promise.all([
    idb.allLibrary(), idb.allLocalBooks(), idb.allProgress(),
  ]);
  const progByKey = new Map(progress.map((p) => [p.key, p]));
  // Riel «Seguir leyendo»: las últimas lecturas de TODAS las series (del
  // registro de avance de cada una), la más reciente primero, máx. 12.
  const contWrap = $('#continue-wrap');
  const contRail = $('#continue-rail');
  if (contWrap && contRail) {
    const dismissed = continueDismissed();
    const entries = progress
      .filter((p) => p.lastChapterKey && dismissed[p.key] !== p.updatedAt)
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
      .slice(0, 12);
    contWrap.hidden = !entries.length;
    contRail.innerHTML = '';
    for (const p of entries) {
      const where = p.lastTotal
        ? `${p.lastChapterLabel || ''} · pág. ${(p.lastPage ?? 0) + 1} de ${p.lastTotal}`
        : `${p.lastChapterLabel || ''} · pág. ${(p.lastPage ?? 0) + 1}`;
      const card = document.createElement('div');
      card.className = 'card cont-card';
      card.innerHTML = `
        <button type="button" class="lib-x" title="Quitar de «Seguir leyendo» (no borra tu avance)">✕</button>
        ${p.cover ? `<img src="${esc(imgUrl(p.cover))}" data-direct="${esc(p.cover)}" alt="" loading="lazy">` : '<img alt="">'}
        <div class="t">${esc(p.title || p.mangaKey)}</div>
        <div class="sub">${esc(where)}</div>`;
      wireImgFallbacks(card);
      card.querySelector('.lib-x').addEventListener('click', (e) => {
        e.stopPropagation();
        dismissContinue(p.key, p.updatedAt);
        renderLibrary();
      });
      card.addEventListener('click', () => { openFromContinue(p).catch((err) => toast(err.message, true)); });
      contRail.appendChild(card);
    }
  }
  // Sección «Favoritos» del home: los registros de la biblioteca con la
  // marca favorite, con portada; tocar uno abre su detalle (snapshot).
  const favWrap = $('#favorites-wrap');
  const favBox = $('#favorites');
  if (favWrap && favBox) {
    const favs = lib.filter((r) => r.favorite);
    favWrap.hidden = !favs.length;
    favBox.innerHTML = '';
    for (const rec of favs) {
      const srcName = state.installed.get(rec.sourceId)?.name || rec.sourceId;
      const card = document.createElement('div');
      card.className = 'card fav-card';
      card.innerHTML = `
        <span class="fav-star" title="Favorito">⭐</span>
        ${rec.newChapters ? `<span class="new-badge" title="Capítulos nuevos sin ver">+${rec.newChapters}</span>` : ''}
        ${rec.cover ? `<img src="${esc(imgUrl(rec.cover))}" data-direct="${esc(rec.cover)}" alt="" loading="lazy">` : '<img alt="">'}
        <div class="t">${esc(rec.title)}</div>
        <div class="sub">${esc(srcName)}</div>`;
      wireImgFallbacks(card);
      card.addEventListener('click', () => openFromLibrary(rec));
      favBox.appendChild(card);
    }
  }
  box.innerHTML = '';
  let any = false;
  for (const rec of lib) {
    any = true;
    const prog = progByKey.get(rec.key);
    const srcName = state.installed.get(rec.sourceId)?.name || rec.sourceId;
    const cont = prog?.lastChapterLabel
      ? `Continuar: ${prog.lastChapterLabel} · pág. ${(prog.lastPage ?? 0) + 1}` : '';
    const card = document.createElement('div');
    card.className = 'card lib-card';
    card.innerHTML = `
      <button type="button" class="lib-x" title="Quitar de la biblioteca">✕</button>
      ${rec.newChapters ? `<span class="new-badge" title="Capítulos nuevos sin ver">+${rec.newChapters}</span>` : ''}
      ${rec.cover ? `<img src="${esc(imgUrl(rec.cover))}" data-direct="${esc(rec.cover)}" alt="" loading="lazy">` : '<img alt="">'}
      <div class="t">${esc(rec.title)}</div>
      <div class="sub">${esc(srcName)}${cont ? `<br>${esc(cont)}` : ''}</div>`;
    wireImgFallbacks(card);
    card.querySelector('.lib-x').addEventListener('click', async (e) => {
      e.stopPropagation();
      await idb.deleteLibrary(rec.key);
      renderLibrary();
      toast('Quitado de la biblioteca');
    });
    card.addEventListener('click', () => openFromLibrary(rec));
    box.appendChild(card);
  }
  for (const book of books) {
    any = true;
    const card = document.createElement('div');
    card.className = 'card lib-card';
    card.innerHTML = `
      <button type="button" class="lib-x" title="Borrar el libro local">✕</button>
      <img alt="">
      <div class="t">${esc(book.title)}</div>
      <div class="sub">CBZ local · ${book.totalPages} páginas</div>`;
    card.querySelector('.lib-x').addEventListener('click', async (e) => {
      e.stopPropagation();
      await idb.deleteLocalBookCascade(book.id);
      renderLibrary();
      toast('Libro local borrado');
    });
    card.addEventListener('click', () => openLocalBook(book));
    box.appendChild(card);
  }
  if (!any) {
    box.innerHTML = '<p class="hint">Tu biblioteca está vacía: abre un manga y toca «Añadir a la biblioteca».</p>';
  }
}

async function openFromLibrary(rec) {
  if (!state.installed.has(rec.sourceId)) {
    toast('Esa fuente no está instalada en este dispositivo', true);
    return;
  }
  state.currentSource = rec.sourceId;
  await openManga(rec.stub, { snapshot: rec.snapshot });
}

async function toggleLibrary() {
  const m = state.currentManga;
  if (!m) return;
  const key = libKeyOf(state.currentSource, m.key);
  const existing = await idb.getLibrary(key);
  if (existing) {
    await idb.deleteLibrary(key);
    toast('Quitado de la biblioteca');
  } else {
    await idb.putLibrary({
      key,
      sourceId: state.currentSource,
      mangaKey: m.key,
      title: m.title,
      cover: m.cover,
      stub: { key: m.key, title: m.title, cover: m.cover },
      snapshot: m,
      addedAt: Date.now(),
      knownChapterCount: state.currentChapters.length,
      knownLatestChapterKey: state.currentChapters[0]?.key ?? null,
      newChapters: 0,
    });
    toast('Añadido a la biblioteca');
  }
  await refreshLibraryButton();
  await refreshFavButton();
  renderLibrary();
}

async function refreshLibraryButton() {
  const btn = $('#btn-lib');
  if (!btn || !state.currentManga) return;
  const rec = await idb.getLibrary(libKeyOf(state.currentSource, state.currentManga.key));
  btn.textContent = rec ? '✓ En tu biblioteca (quitar)' : '＋ Añadir a la biblioteca';
}

// Favorito = marca `favorite` sobre el registro de la biblioteca (favorito
// implica guardado: si aún no hay registro, se crea con el snapshot). La
// estrella SOLO toca la marca: quitarla saca el manga del home pero el
// registro permanece en la biblioteca.
async function toggleFavorite() {
  const m = state.currentManga;
  if (!m) return;
  const key = libKeyOf(state.currentSource, m.key);
  let rec = await idb.getLibrary(key);
  if (!rec) {
    rec = {
      key,
      sourceId: state.currentSource,
      mangaKey: m.key,
      title: m.title,
      cover: m.cover,
      stub: { key: m.key, title: m.title, cover: m.cover },
      snapshot: m,
      addedAt: Date.now(),
      knownChapterCount: state.currentChapters.length,
      knownLatestChapterKey: state.currentChapters[0]?.key ?? null,
      newChapters: 0,
    };
  }
  rec.favorite = !rec.favorite;
  await idb.putLibrary(rec);
  toast(rec.favorite ? '⭐ Añadido a favoritos' : 'Estrella quitada (sigue en tu biblioteca)');
  await refreshFavButton();
  renderLibrary();
}

async function refreshFavButton() {
  const btn = $('#btn-fav');
  if (!btn || !state.currentManga) return;
  const rec = await idb.getLibrary(libKeyOf(state.currentSource, state.currentManga.key));
  const fav = !!rec?.favorite;
  btn.textContent = fav ? '⭐ Favorito' : '☆ Favorito';
  btn.classList.toggle('fav-on', fav);
}

// --- Novedades (capítulos nuevos en biblioteca/favoritos) -------------------
// Compara la lista de capítulos de cada serie guardada contra lo «conocido»
// (conteo + capítulo más reciente, sembrados al guardar en biblioteca y al
// abrir el detalle). La diferencia se acumula en rec.newChapters y se pinta
// como insignia +N en el home hasta que el detalle se abre. En serie: en el
// transporte síncrono cada consulta ocupa el worker hasta volver; el fallo
// de una serie se traga en silencio y no aborta a las demás.
let updateCheckRunning = false;
async function checkForUpdates({ manual = false } = {}) {
  if (updateCheckRunning) return 0;
  updateCheckRunning = true;
  const btn = $('#btn-check-updates');
  if (btn) { btn.disabled = true; btn.textContent = 'Buscando novedades…'; }
  let seriesWithNews = 0;
  try {
    const lib = await idb.allLibrary();
    for (const rec of lib) {
      if (!state.installed.has(rec.sourceId)) continue;
      try {
        // El update necesita el Manga COMPLETO (encManga exige campos
        // numéricos no opcionales: status, content_rating, viewer…): el
        // stub guardado {key,title,cover} no basta y el codec estalla con
        // «Cannot convert undefined to a BigInt». El snapshot sí es completo.
        const m = await call({ type: 'update', sourceId: rec.sourceId, manga: rec.snapshot || rec.stub });
        const chapters = m.chapters || [];
        const known = rec.knownChapterCount;
        if (known == null) {
          rec.knownChapterCount = chapters.length;
          rec.knownLatestChapterKey = chapters[0]?.key ?? null;
          rec.newChapters = rec.newChapters || 0;
        } else if (chapters.length > known) {
          rec.newChapters = (rec.newChapters || 0) + (chapters.length - known);
          rec.knownChapterCount = chapters.length;
          rec.knownLatestChapterKey = chapters[0]?.key ?? rec.knownLatestChapterKey;
          seriesWithNews++;
        } else if (chapters.length < known) {
          // La fuente recortó capítulos: resembrar sin anunciar «novedad».
          rec.knownChapterCount = chapters.length;
          rec.knownLatestChapterKey = chapters[0]?.key ?? null;
        }
        rec.snapshot = m;
        rec.title = m.title || rec.title;
        rec.cover = m.cover ?? rec.cover;
        await idb.putLibrary(rec);
      } catch (err) { /* serie intratable ahora mismo: se reintentará otro día */
        console.warn('Novedades sin revisar:', rec.key, err?.message);
      }
    }
  } finally {
    localStorage.setItem('tinta.lastUpdateCheck', String(Date.now()));
    updateCheckRunning = false;
    if (btn) { btn.disabled = false; btn.textContent = 'Buscar novedades'; }
    await renderLibrary();
  }
  if (manual) {
    toast(seriesWithNews
      ? `Novedades en ${seriesWithNews} serie(s) de tu biblioteca`
      : 'Sin novedades: tu biblioteca está al día');
  }
  return seriesWithNews;
}

// --- Búsqueda global ----------------------------------------------------------
// Un solo buscador para todas las fuentes instaladas: consulta en serie (en
// el transporte síncrono cada llamada ocupa el worker hasta volver), pinta
// el progreso por fuente («Buscando en X…») y agrupa los resultados bajo la
// cabecera de su fuente; tocar una tarjeta abre el detalle en esa fuente.
async function runGlobalSearch(query) {
  const box = $('#global-results');
  box.innerHTML = '';
  const sources = [...state.installed.values()];
  if (!sources.length) {
    box.innerHTML = '<p class="hint">No hay fuentes instaladas todavía: instala una desde el catálogo de abajo.</p>';
    return;
  }
  for (const s of sources) {
    const group = document.createElement('div');
    group.className = 'global-group';
    group.innerHTML = `<h3 class="global-head">Buscando en ${esc(s.name)}…</h3><div class="grid"></div>`;
    box.appendChild(group);
    const head = group.querySelector('.global-head');
    const grid = group.querySelector('.grid');
    try {
      const result = await call({ type: 'search', sourceId: s.id, query, page: 1 });
      head.textContent = `${s.name} — ${result.entries.length} resultado(s)`;
      if (!result.entries.length) {
        grid.innerHTML = '<p class="hint">Sin resultados en esta fuente.</p>';
      }
      for (const m of result.entries) {
        const card = document.createElement('div');
        card.className = 'card';
        card.innerHTML = `
          ${m.cover ? `<img src="${esc(imgUrl(m.cover))}" data-direct="${esc(m.cover)}" alt="" loading="lazy">` : '<img alt="">'}
          <div class="t">${esc(m.title)}</div>`;
        const cimg = card.querySelector('img[data-direct]');
        if (cimg) armImgFallback(cimg, m.cover);
        card.addEventListener('click', () => {
          state.currentSource = s.id;
          openManga(m).catch((err) => toast(err.message, true));
        });
        grid.appendChild(card);
      }
    } catch (err) {
      head.textContent = `${s.name} — ⚠️ ${err.message}`;
    }
  }
}

// --- Progreso de lectura ------------------------------------------------------
async function getProgressRec(sourceId, mangaKey) {
  return idb.getProgress(libKeyOf(sourceId, mangaKey));
}

// Los guardados de progreso se SERIALIZAN en una cadena: el lector dispara
// muchos saveProgress seguidos (observador de scroll, avance por páginas) y
// cada uno hace get→put; sin orden, un guardado viejo podía aterrizar después
// del último y pisar la página final (la marca quedaba en «pág. N» en vez de
// «✓ leído»). Con la cadena, el último guardado pedido es el que queda.
let progressChain = Promise.resolve();
function saveProgress(sourceId, manga, chapter, page, total) {
  const run = async () => {
    const key = libKeyOf(sourceId, manga.key);
    const rec = (await idb.getProgress(key)) || {
      key, sourceId, mangaKey: manga.key, chapters: {}, updatedAt: 0,
    };
    rec.chapters[chapter.key] = {
      page, total, finished: page >= total - 1, updatedAt: Date.now(),
    };
    rec.lastChapterKey = chapter.key;
    rec.lastChapterLabel = chapterLabelOf(chapter);
    rec.lastPage = page;
    // Para el riel «Seguir leyendo» del home: qué serie es y cuántas páginas
    // tiene el capítulo en curso (el registro de avance ya traía el resto).
    rec.title = manga.title || rec.title;
    rec.cover = manga.cover ?? rec.cover;
    rec.lastTotal = total;
    rec.updatedAt = Date.now();
    await idb.putProgress(rec);
  };
  progressChain = progressChain.then(run, run);
  return progressChain;
}

// --- Descargas offline ---------------------------------------------------------
async function fetchImageBlob(url) {
  const viaProxy = imgUrl(url);
  try {
    const r = await fetch(viaProxy);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.blob();
  } catch (err) {
    if (viaProxy === url) throw err;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.blob();
  }
}

async function downloadChapter(sourceId, manga, chapter, { preload = false } = {}) {
  const key = dlKeyOf(sourceId, manga.key, chapter.key);
  if (state.downloaded.has(key) || state.downloading.has(key)) return 'skip';
  if (await idb.getDownload(key)) { state.downloaded.add(key); return 'skip'; }
  state.downloading.set(key, { done: 0, total: 0 });
  refreshDlButtons();
  try {
    const pages = await call({ type: 'pages', sourceId, manga, chapter });
    const urls = pages.filter((p) => p.content.type === 'url').map((p) => p.content.url);
    if (!urls.length) throw new Error('El capítulo no trae páginas descargables');
    state.downloading.set(key, { done: 0, total: urls.length });
    let size = 0;
    for (let i = 0; i < urls.length; i++) {
      const blob = await fetchImageBlob(urls[i]);
      size += blob.size;
      await idb.putPage({ key: `${key}::${padIdx(i)}`, dlKey: key, index: i, blob });
      const d = state.downloading.get(key);
      if (d) d.done = i + 1;
      refreshDlButtons();
    }
    await idb.putDownload({
      key, sourceId, mangaKey: manga.key, mangaTitle: manga.title,
      chapterKey: chapter.key, chapterLabel: chapterLabelOf(chapter),
      totalPages: urls.length, size, downloadedAt: Date.now(), preloaded: preload,
    });
    state.downloaded.add(key);
    return 'done';
  } catch (err) {
    // Limpieza de páginas a medias: sin registro, no deben contar como descarga
    await idb.deletePagesOf(key).catch(() => {});
    throw err;
  } finally {
    state.downloading.delete(key);
    refreshDlButtons();
  }
}

async function deleteDownload(key) {
  await idb.deleteDownloadCascade(key);
  state.downloaded.delete(key);
  refreshDlButtons();
  toast('Descarga borrada');
}

function refreshDlButtons() {
  document.querySelectorAll('#chapters .chapter').forEach((row) => {
    const chKey = row.dataset.chapterKey;
    if (!chKey || !state.currentManga) return;
    const key = dlKeyOf(state.currentSource, state.currentManga.key, chKey);
    const btn = row.querySelector('.dl-btn');
    if (!btn) return;
    if (state.downloaded.has(key)) {
      btn.textContent = '✓';
      btn.classList.add('done');
      btn.disabled = false;
      btn.title = 'Descargado · toca para borrar la descarga';
      row.classList.add('downloaded');
    } else if (state.downloading.has(key)) {
      const d = state.downloading.get(key);
      btn.textContent = d.total ? `${d.done}/${d.total}` : '…';
      btn.classList.remove('done');
      btn.disabled = true;
      btn.title = 'Descargando…';
      row.classList.remove('downloaded');
    } else {
      btn.textContent = '⬇';
      btn.classList.remove('done');
      btn.disabled = false;
      btn.title = 'Descargar para leer sin conexión';
      row.classList.remove('downloaded');
    }
    const expBtn = row.querySelector('.exp-btn');
    if (expBtn) expBtn.hidden = !state.downloaded.has(key);
  });
}

// Precarga en segundo plano de los capítulos siguientes en la lista (el
// inmediato posterior primero), sin bloquear la lectura ni duplicar.
const preloadInFlight = new Set();
function schedulePreload(manga, chapter) {
  const count = pref.preloadCount();
  if (!count || state.currentSource === 'local') return;
  const chapters = state.currentChapters;
  const idx = chapters.findIndex((c) => c.key === chapter.key);
  if (idx < 0) return;
  const sourceId = state.currentSource;
  setTimeout(async () => {
    if (!state.currentManga || state.currentManga.key !== manga.key) return;
    for (let i = 1; i <= count; i++) {
      const next = chapters[idx + i];
      if (!next || next.locked) continue;
      const key = dlKeyOf(sourceId, manga.key, next.key);
      if (state.downloaded.has(key) || state.downloading.has(key) || preloadInFlight.has(key)) continue;
      preloadInFlight.add(key);
      try {
        await downloadChapter(sourceId, manga, next, { preload: true });
      } catch (err) {
        console.warn('Precarga sin completar:', err.message);
      } finally {
        preloadInFlight.delete(key);
      }
    }
  }, 700);
}

// --- Navegación por fuente ---------------------------------------------------
async function openSource(sourceId) {
  state.currentSource = sourceId;
  state.mode = 'search';
  state.page = 1;
  $('#browse-title').textContent = state.installed.get(sourceId)?.name || sourceId;
  $('#results').innerHTML = '';
  $('#btn-more').hidden = true;
  show('view-browse');
  // Listings (Popular / Recientes…) como pestañas, si la fuente los ofrece
  const tabs = $('#listings');
  tabs.innerHTML = '';
  try {
    const listings = await call({ type: 'listings', sourceId });
    for (const l of listings) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = l.name;
      b.dataset.listing = l.id;
      tabs.appendChild(b);
    }
  } catch { /* sin listings: solo búsqueda */ }
}

function renderResults(result, append) {
  const grid = $('#results');
  if (!append) grid.innerHTML = '';
  for (const m of result.entries) {
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      ${m.cover ? `<img src="${esc(imgUrl(m.cover))}" data-direct="${esc(m.cover)}" alt="" loading="lazy">` : '<img alt="">'}
      <div class="t">${esc(m.title)}</div>`;
    const cimg = card.querySelector('img[data-direct]');
    if (cimg) armImgFallback(cimg, m.cover);
    card.onclick = () => openManga(m);
    grid.appendChild(card);
  }
  if (!result.entries.length && !append) {
    grid.innerHTML = '<p class="hint">Sin resultados.</p>';
  }
  $('#btn-more').hidden = !result.has_next_page;
}

async function runSearch(page, append) {
  const result = await call({
    type: 'search', sourceId: state.currentSource, query: state.lastQuery, page,
  });
  state.page = page;
  renderResults(result, append);
}

async function runListing(page, append) {
  const result = await call({
    type: 'mangaList', sourceId: state.currentSource, listingId: state.listingId, page,
  });
  state.page = page;
  renderResults(result, append);
}

// --- Detalle y capítulos -------------------------------------------------------
async function openManga(mangaStub, opts = {}) {
  show('view-manga');
  $('#manga-detail').innerHTML = '<p class="hint">Cargando detalle y capítulos…</p>';
  $('#chapters').innerHTML = '';
  let m = null;
  let fromSnapshot = false;
  try {
    // Si el stub viene «mínimo» (desde la biblioteca: {key,title,cover}),
    // el update se intenta con el snapshot, que sí es un Manga completo;
    // con el stub mínimo encManga estalla antes de salir al aire.
    const updateInput = (mangaStub && mangaStub.status !== undefined)
      ? mangaStub : (opts.snapshot || mangaStub);
    m = await call({ type: 'update', sourceId: state.currentSource, manga: updateInput });
  } catch (err) {
    if (opts.snapshot) {
      m = opts.snapshot;
      fromSnapshot = true;
    } else {
      $('#manga-detail').innerHTML = `<p class="hint">⚠️ ${esc(err.message)}</p>`;
      return;
    }
  }
  state.currentManga = m;
  state.currentChapters = m.chapters || [];
  // La lista paginada siempre arranca en su primera página (con el orden por
  // defecto: el tomo más viejo primero).
  state.chapterPage = 0;
  if (fromSnapshot) toast('Sin conexión: mostrando la copia guardada en tu biblioteca');
  // Refrescar la copia de la biblioteca con el detalle recién traído
  if (!fromSnapshot) {
    const libRec = await idb.getLibrary(libKeyOf(state.currentSource, m.key));
    if (libRec) {
      libRec.snapshot = m;
      libRec.title = m.title;
      libRec.cover = m.cover;
      // Abrir el detalle marca las novedades como vistas: el «conocido»
      // pasa a ser la lista recién traída y la insignia +N se limpia.
      libRec.knownChapterCount = state.currentChapters.length;
      libRec.knownLatestChapterKey = state.currentChapters[0]?.key ?? null;
      libRec.newChapters = 0;
      await idb.putLibrary(libRec);
      renderLibrary();
    }
  }
  const status = MangaStatus[m.status] || 'Unknown';
  const rating = ContentRating[m.content_rating] || '';
  const prog = await getProgressRec(state.currentSource, m.key);
  $('#manga-detail').innerHTML = `
    <div class="detail">
      ${m.cover ? `<img src="${esc(imgUrl(m.cover))}" data-direct="${esc(m.cover)}" alt="">` : ''}
      <div class="info">
        <h2>${esc(m.title)}</h2>
        <p class="tags">${esc((m.authors || []).join(', '))} · ${esc(status)} · ${esc(rating)}</p>
        <p class="tags">${esc((m.tags || []).join(' · '))}</p>
        <p class="desc">${esc(m.description || '')}</p>
      </div>
    </div>
    <div class="detail-actions">
      <button id="btn-lib" type="button" class="ghost"></button>
      <button id="btn-fav" type="button" class="ghost"></button>
      <button id="btn-continue" type="button" hidden>Continuar leyendo</button>
    </div>`;
  wireImgFallbacks($('#manga-detail'));
  await refreshLibraryButton();
  await refreshFavButton();
  $('#btn-lib').addEventListener('click', toggleLibrary);
  $('#btn-fav').addEventListener('click', toggleFavorite);
  const contBtn = $('#btn-continue');
  if (prog?.lastChapterKey) {
    const ch = state.currentChapters.find((c) => c.key === prog.lastChapterKey);
    if (ch && !ch.locked) {
      contBtn.hidden = false;
      contBtn.textContent = `Continuar: ${chapterLabelOf(ch)} · pág. ${(prog.lastPage ?? 0) + 1}`;
      contBtn.addEventListener('click', () => openChapter(m, ch, chapterLabelOf(ch)));
    }
  }
  await renderChapters(m, prog);
}

function progressMarkOf(cp) {
  if (!cp) return '';
  if (cp.finished) return '✓ leído';
  return cp.page > 0 ? `· pág. ${cp.page + 1}` : '';
}

// Al volver del lector: refrescar marcas de avance y estados de descarga SIN
// reconstruir las filas (reconstruirlas dejaría nodos huérfanos a mitad de un
// toque y perdería la posición de scroll).
async function refreshChapterMarks() {
  if (!state.currentManga) return;
  const prog = await getProgressRec(state.currentSource, state.currentManga.key);
  document.querySelectorAll('#chapters .chapter').forEach((row) => {
    const cp = prog?.chapters?.[row.dataset.chapterKey];
    row.classList.toggle('read', !!cp?.finished);
    const small = row.querySelector('.ch-main small');
    if (small) small.textContent = `${row.dataset.smallBase || ''} ${progressMarkOf(cp)}`.trim();
  });
  refreshDlButtons();
}

// --- Lista de capítulos: orden y paginación ----------------------------------
// state.currentChapters conserva SIEMPRE el orden crudo de la fuente (el más
// nuevo primero): avance, descargas y precarga operan sobre ese orden real.
// El orden de DESPLIEGUE es otra cosa: por defecto ascendente (el tomo más
// viejo primero) e invertible con un botón; la preferencia persiste.
function orderedChapters() {
  const chs = state.currentChapters || [];
  return pref.chapterOrder() === 'asc' ? [...chs].reverse() : [...chs];
}

const CHAPTERS_PER_PAGE = 50;   // sin volúmenes: páginas de 50 capítulos
const VOLUME_PAGE_MAX = 100;    // un volumen absurdo se subdivide en bloques de 100

// Agrupa la lista (ya en orden de despliegue) en páginas: una por volumen
// cuando la fuente trae volume_number; si no, bloques de CHAPTERS_PER_PAGE.
function buildChapterPages(display) {
  const hasVolumes = display.some((c) => c.volume_number != null);
  if (!hasVolumes) {
    const pages = [];
    for (let i = 0; i < display.length; i += CHAPTERS_PER_PAGE) {
      pages.push({ kind: 'plain', chapters: display.slice(i, i + CHAPTERS_PER_PAGE) });
    }
    pages.forEach((p, i) => { p.label = `Página ${i + 1} de ${pages.length}`; });
    return pages;
  }
  const groups = [];
  for (const ch of display) {
    const v = ch.volume_number ?? null;
    const last = groups[groups.length - 1];
    if (last && last.volume === v) last.chapters.push(ch);
    else groups.push({ volume: v, chapters: [ch] });
  }
  const pages = [];
  for (const g of groups) {
    const parts = Math.ceil(g.chapters.length / VOLUME_PAGE_MAX);
    for (let i = 0; i < parts; i++) {
      pages.push({
        kind: 'vol', volume: g.volume, part: i + 1, parts,
        chapters: g.chapters.slice(i * VOLUME_PAGE_MAX, (i + 1) * VOLUME_PAGE_MAX),
      });
    }
  }
  for (const p of pages) {
    const base = p.volume != null ? `Volumen ${p.volume}` : 'Sin volumen';
    p.label = p.parts > 1 ? `${base} · parte ${p.part}/${p.parts}` : base;
  }
  return pages;
}

// ¿En qué página de la lista (orden de despliegue vigente) vive un capítulo?
function chapterListPageOf(chapterKey) {
  const pages = buildChapterPages(orderedChapters());
  return pages.findIndex((p) => p.chapters.some((c) => c.key === chapterKey));
}

function syncOrderUi() {
  const order = pref.chapterOrder();
  const btn = $('#btn-order');
  if (btn) btn.textContent = order === 'asc' ? 'Orden: viejo → nuevo' : 'Orden: nuevo → viejo';
  const sel = $('#set-chapter-order');
  if (sel && sel.value !== order) sel.value = order;
}

function setChapterOrder(order) {
  localStorage.setItem('tinta.chapterOrder', order);
  state.chapterPage = 0;
  syncOrderUi();
  if (state.currentManga) renderChapters(state.currentManga).catch(() => {});
  toast(order === 'asc'
    ? 'Capítulos: del más viejo al más nuevo'
    : 'Capítulos: del más nuevo al más viejo');
}

function renderPagers() {
  const total = state.chapterPages.length;
  for (const sel of ['#chapters-pager-top', '#chapters-pager-bottom']) {
    const el = $(sel);
    if (!el) continue;
    el.innerHTML = '';
    el.hidden = total <= 1;
    if (total <= 1) continue;
    const cur = state.chapterPage;
    const page = state.chapterPages[cur];
    const prev = document.createElement('button');
    prev.type = 'button';
    prev.className = 'ghost';
    prev.textContent = '‹ Anterior';
    prev.disabled = cur <= 0;
    prev.addEventListener('click', () => goChapterPage(cur - 1));
    const info = document.createElement('span');
    info.className = 'pager-info';
    info.textContent = page.kind === 'vol' ? `${page.label} · ${cur + 1} de ${total}` : page.label;
    const next = document.createElement('button');
    next.type = 'button';
    next.className = 'ghost';
    next.textContent = 'Siguiente ›';
    next.disabled = cur >= total - 1;
    next.addEventListener('click', () => goChapterPage(cur + 1));
    el.append(prev, info, next);
  }
}

function goChapterPage(i) {
  const total = state.chapterPages.length;
  const next = Math.min(Math.max(0, i), Math.max(0, total - 1));
  if (next === state.chapterPage || !state.currentManga) return;
  state.chapterPage = next;
  renderChapters(state.currentManga)
    .then(() => document.querySelector('.chapters-head')?.scrollIntoView({ block: 'start' }))
    .catch(() => {});
}

function chapterRow(m, ch, prog) {
  const label = chapterLabelOf(ch);
  const when = ch.date_uploaded ? new Date(ch.date_uploaded * 1000).toLocaleDateString('es-MX') : '';
  const cp = prog?.chapters?.[ch.key];
  const row = document.createElement('div');
  row.className = 'chapter'
    + (ch.locked ? ' locked' : '')
    + (cp?.finished ? ' read' : '');
  row.dataset.chapterKey = ch.key;
  row.dataset.smallBase = `${ch.language || ''} ${when}${ch.locked ? ' · no disponible en la fuente' : ''}`.trim();
  row.innerHTML = `
    <span class="ch-main"><span>${esc(label)}</span>
    <small>${esc(row.dataset.smallBase)} ${esc(progressMarkOf(cp))}</small></span>
    ${ch.locked ? '' : '<span class="ch-actions"><button type="button" class="exp-btn" title="Exportar el capítulo descargado como archivo CBZ" hidden>CBZ</button><button type="button" class="dl-btn" title="Descargar para leer sin conexión">⬇</button></span>'}`;
  if (!ch.locked) {
    row.addEventListener('click', () => openChapter(m, ch, label));
    const dlBtn = row.querySelector('.dl-btn');
    dlBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const key = dlKeyOf(state.currentSource, m.key, ch.key);
      try {
        if (state.downloaded.has(key)) await deleteDownload(key);
        else {
          toast('Descargando capítulo…');
          const r = await downloadChapter(state.currentSource, m, ch);
          if (r === 'done') toast('Capítulo descargado: listo sin conexión');
        }
      } catch (err) {
        toast(`Descarga fallida: ${err.message}`, true);
      }
    });
    const expBtn = row.querySelector('.exp-btn');
    expBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      try { await exportCbz(m, ch); } catch (err) { toast(`Exportación fallida: ${err.message}`, true); }
    });
  }
  return row;
}

// Pinta SOLO la página vigente de la lista (nunca cientos de filas de golpe)
// con su cabecera de volumen y los paginadores de arriba y abajo.
async function renderChapters(m, prog) {
  prog = prog ?? await getProgressRec(state.currentSource, m.key);
  // Refrescar el conjunto de descargas de este manga
  const myDownloads = await idb.allDownloads();
  state.downloaded = new Set(
    myDownloads.map((d) => d.key).filter((k) => k.startsWith(`${state.currentSource}::`)),
  );
  const pages = buildChapterPages(orderedChapters());
  state.chapterPages = pages;
  state.chapterPage = Math.min(Math.max(0, state.chapterPage), Math.max(0, pages.length - 1));
  syncOrderUi();
  renderPagers();
  const box = $('#chapters');
  box.innerHTML = '';
  if (!pages.length) {
    box.innerHTML = '<p class="hint">La fuente no devolvió capítulos.</p>';
    refreshDlButtons();
    return;
  }
  const page = pages[state.chapterPage];
  if (page.kind === 'vol') {
    const h = document.createElement('div');
    h.className = 'vol-header';
    h.textContent = page.volume != null ? `Volumen ${page.volume}` : 'Sin volumen';
    box.appendChild(h);
  }
  for (const ch of page.chapters) box.appendChild(chapterRow(m, ch, prog));
  refreshDlButtons();
}

// Descarga de un blob generado en la página (CBZ, respaldo) vía un <a download>.
function saveBlobAs(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 8000);
}

// --- Ir a un capítulo por número ----------------------------------------------
// Salta la paginación a la página donde vive el capítulo pedido (por
// chapter_number; si el número exacto no existe, al más cercano de la lista)
// y lo resalta unos segundos.
function gotoChapterNumber(n) {
  if (!state.currentManga || !Number.isFinite(n)) return;
  let best = null;
  let bestDist = Infinity;
  for (const ch of orderedChapters()) {
    if (ch.chapter_number == null) continue;
    const d = Math.abs(ch.chapter_number - n);
    if (d < bestDist) { bestDist = d; best = ch; }
  }
  if (!best) { toast('Ningún capítulo de la lista trae número', true); return; }
  const pi = chapterListPageOf(best.key);
  if (pi < 0) return;
  state.chapterPage = pi;
  renderChapters(state.currentManga).then(() => {
    const row = [...document.querySelectorAll('#chapters .chapter')]
      .find((r) => r.dataset.chapterKey === best.key);
    if (row) {
      row.classList.add('highlight');
      row.scrollIntoView({ block: 'center' });
      setTimeout(() => row.classList.remove('highlight'), 3000);
    }
  }).catch(() => {});
  if (best.chapter_number !== n) {
    toast(`No hay cap. ${n}: te llevo al más cercano (cap. ${best.chapter_number})`);
  }
}

// --- Descarga por rango ---------------------------------------------------------
// Cola secuencial de capítulos entre dos números (inclusive) reutilizando
// downloadChapter: misma tienda offline, misma limpieza a medias. Cancelable
// entre capítulos (el que esté en curso termina su descarga).
const rangeJob = { running: false, cancel: false };
function updateRangeUi(done, total, note = '') {
  const el = $('#range-progress');
  if (el) el.textContent = rangeJob.running ? `Descargando rango… ${done}/${total}` : note;
  const go = $('#btn-range-go');
  if (go) go.disabled = rangeJob.running;
  const cancel = $('#btn-range-cancel');
  if (cancel) cancel.hidden = !rangeJob.running;
}
async function downloadRange(from, to) {
  const m = state.currentManga;
  const sourceId = state.currentSource;
  if (!m || rangeJob.running) return;
  const targets = state.currentChapters
    .filter((ch) => !ch.locked && ch.chapter_number != null
      && ch.chapter_number >= from && ch.chapter_number <= to)
    .sort((a, b) => a.chapter_number - b.chapter_number);
  if (!targets.length) {
    toast('Ese rango no trae capítulos descargables', true);
    return;
  }
  rangeJob.running = true;
  rangeJob.cancel = false;
  updateRangeUi(0, targets.length);
  let done = 0;
  let failed = 0;
  let skipped = 0;
  for (const ch of targets) {
    if (rangeJob.cancel) break;
    try {
      const r = await downloadChapter(sourceId, m, ch);
      if (r === 'done') done++; else skipped++;
    } catch { failed++; }
    updateRangeUi(done + skipped + failed, targets.length);
  }
  rangeJob.running = false;
  const note = rangeJob.cancel
    ? `Rango cancelado: ${done} capítulo(s) quedaron descargados`
    : `Rango terminado: ${done} descargado(s), ${skipped} ya estaban, ${failed} con error`;
  updateRangeUi(0, 0, note);
  toast(note, failed > 0 && !rangeJob.cancel);
  refreshDlButtons();
}

// --- Exportación a CBZ ------------------------------------------------------------
// Escritor ZIP mínimo (método 0, «stored»): las páginas ya vienen comprimidas
// (JPEG/PNG/WebP), así que empaquetarlas sin recomprimir es lo correcto y no
// necesita dependencias.
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();
function crc32(data) {
  let c = -1;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function zipStore(files) {
  const enc = new TextEncoder();
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // nombres UTF-8
    local.setUint16(8, 0, true);      // método: stored
    local.setUint16(10, 0, true);      // hora DOS 00:00
    local.setUint16(12, 0x21, true);   // fecha DOS 1980-01-01
    local.setUint32(14, crc, true);
    local.setUint32(18, f.data.length, true);
    local.setUint32(22, f.data.length, true);
    local.setUint16(26, name.length, true);
    chunks.push(new Uint8Array(local.buffer), name, f.data);
    const cen = new DataView(new ArrayBuffer(46));
    cen.setUint32(0, 0x02014b50, true);
    cen.setUint16(4, 20, true);
    cen.setUint16(6, 20, true);
    cen.setUint16(8, 0x0800, true);
    cen.setUint16(10, 0, true);
    cen.setUint16(12, 0, true);
    cen.setUint16(14, 0x21, true);
    cen.setUint32(16, crc, true);
    cen.setUint32(20, f.data.length, true);
    cen.setUint32(24, f.data.length, true);
    cen.setUint16(28, name.length, true);
    cen.setUint32(42, offset, true);
    central.push(new Uint8Array(cen.buffer), name);
    offset += 30 + name.length + f.data.length;
  }
  const centralStart = offset;
  let centralSize = 0;
  for (const c of central) { chunks.push(c); centralSize += c.length; }
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, centralStart, true);
  chunks.push(new Uint8Array(end.buffer));
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let pos = 0;
  for (const c of chunks) { out.set(c, pos); pos += c.length; }
  return out;
}

async function exportCbz(manga, chapter) {
  const key = dlKeyOf(state.currentSource, manga.key, chapter.key);
  const recs = await idb.getPagesOf(key); // ordenadas por índice (clave con ceros)
  if (!recs.length) throw new Error('Ese capítulo no está descargado en este dispositivo');
  const files = [];
  for (let i = 0; i < recs.length; i++) {
    const blob = recs[i].blob;
    const ext = ((blob.type || '').split('/')[1] || 'jpg').replace('jpeg', 'jpg').replace('svg+xml', 'svg');
    files.push({
      name: `${String(i + 1).padStart(4, '0')}.${ext}`,
      data: new Uint8Array(await blob.arrayBuffer()),
    });
  }
  const safe = (s) => String(s || '').replace(/[\\/:*?"<>|]+/g, '_').trim() || 'capitulo';
  const name = `${safe(manga.title)} - ${safe(chapterLabelOf(chapter))}.cbz`;
  saveBlobAs(new Blob([zipStore(files)], { type: 'application/vnd.comicbook+zip' }), name);
  toast(`CBZ exportado: ${name} (${files.length} páginas)`);
}

// --- Tema del lector ---------------------------------------------------------
// Fondo de la vista de lectura (Ajustes → «Fondo del lector»): una clase
// sobre #view-reader que styles.css traduce a colores en ambos modos.
function applyReaderBg() {
  const section = document.getElementById('view-reader');
  if (!section) return;
  section.classList.remove('bg-negro', 'bg-papel', 'bg-blanco');
  section.classList.add(`bg-${pref.readerBg()}`);
}

// --- Respaldo ------------------------------------------------------------------
// Exporta/importa biblioteca (con favoritos), avance y ajustes en un JSON.
// Las descargas y las fuentes instaladas NO viajan: pesan demasiado o se
// reinstalan desde el catálogo.
const BACKUP_PREF_KEYS = [
  'tinta.proxyBase', 'tinta.readerMode', 'tinta.pageDir', 'tinta.pageFit',
  'tinta.chapterOrder', 'tinta.preloadCount', 'tinta.readerBg',
];
async function exportBackup() {
  const prefs = {};
  for (const k of BACKUP_PREF_KEYS) {
    const v = localStorage.getItem(k);
    if (v != null) prefs[k] = v;
  }
  const data = {
    app: 'tinta',
    kind: 'backup',
    version: 1,
    exportedAt: new Date().toISOString(),
    appVersion: APP_VERSION,
    library: await idb.allLibrary(),
    progress: await idb.allProgress(),
    prefs,
  };
  const name = `tinta-respaldo-${new Date().toISOString().slice(0, 10)}.json`;
  saveBlobAs(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), name);
  toast(`Respaldo exportado: ${name}`);
}
async function importBackup(file) {
  const data = JSON.parse(await file.text());
  if (!data || data.app !== 'tinta' || !Array.isArray(data.library) || !Array.isArray(data.progress)) {
    throw new Error('Ese archivo no es un respaldo de Tinta');
  }
  for (const rec of data.library) await idb.putLibrary(rec);
  for (const rec of data.progress) await idb.putProgress(rec);
  if (data.prefs) {
    for (const [k, v] of Object.entries(data.prefs)) {
      if (BACKUP_PREF_KEYS.includes(k) && typeof v === 'string') localStorage.setItem(k, v);
    }
  }
  applyReaderBg();
  await renderLibrary();
  toast(`Respaldo importado: ${data.library.length} en biblioteca, ${data.progress.length} con avance`);
}

// --- Lector ---------------------------------------------------------------------
function revokeReaderUrls() {
  if (state.reader?.objectUrls) {
    for (const u of state.reader.objectUrls) URL.revokeObjectURL(u);
  }
  state.reader = null;
}

async function openChapter(manga, chapter, label) {
  const sourceId = state.currentSource;
  const dlKey = dlKeyOf(sourceId, manga.key, chapter.key);
  show('view-reader');
  $('#reader-title').textContent = `${manga.title} — ${label}`;
  const box = $('#pages');
  box.innerHTML = '<p class="hint">Cargando páginas…</p>';
  try {
    let items = null;
    let objectUrls = [];
    const dl = await idb.getDownload(dlKey);
    if (dl) {
      const recs = await idb.getPagesOf(dlKey);
      if (recs.length) {
        items = recs.map((r) => {
          const u = URL.createObjectURL(r.blob);
          objectUrls.push(u);
          return { src: u, original: null };
        });
      }
    }
    if (!items) {
      const pages = await call({ type: 'pages', sourceId, manga, chapter });
      items = pages
        .filter((p) => p.content.type === 'url')
        .map((p) => ({ src: imgUrl(p.content.url), original: p.content.url }));
    }
    if (!items.length) {
      box.innerHTML = '<p class="hint">Este capítulo no trae páginas mostrables.</p>';
      return;
    }
    revokeReaderUrls();
    state.reader = {
      sourceId, manga, chapter, label, items, objectUrls, idx: 0, local: false,
    };
    renderReader();
    // Retomar donde ibas
    const prog = await getProgressRec(sourceId, manga.key);
    const cp = prog?.chapters?.[chapter.key];
    let startPage = 0;
    if (cp && cp.page > 0 && cp.page < items.length) {
      startPage = cp.page;
      toast(`Retomando en la página ${startPage + 1}`);
    }
    await goToPage(startPage, { quiet: startPage === 0 });
    schedulePreload(manga, chapter);
  } catch (err) {
    box.innerHTML = `<p class="hint">⚠️ ${esc(err.message)}</p>`;
  }
}

async function openLocalBook(book) {
  show('view-reader');
  $('#reader-title').textContent = book.title;
  const box = $('#pages');
  box.innerHTML = '<p class="hint">Cargando páginas…</p>';
  const dlKey = `local::${book.id}`;
  const recs = await idb.getPagesOf(dlKey);
  if (!recs.length) {
    box.innerHTML = '<p class="hint">Este libro local no trae páginas legibles.</p>';
    return;
  }
  const objectUrls = [];
  const items = recs.map((r) => {
    const u = URL.createObjectURL(r.blob);
    objectUrls.push(u);
    return { src: u, original: null };
  });
  revokeReaderUrls();
  const manga = { key: book.id, title: book.title };
  const chapter = { key: 'book' };
  state.reader = {
    sourceId: 'local', manga, chapter, label: book.title, items, objectUrls, idx: 0, local: true,
  };
  renderReader();
  const prog = await getProgressRec('local', book.id);
  const cp = prog?.chapters?.book;
  let startPage = 0;
  if (cp && cp.page > 0 && cp.page < items.length) {
    startPage = cp.page;
    toast(`Retomando en la página ${startPage + 1}`);
  }
  await goToPage(startPage, { quiet: startPage === 0 });
}

// --- Lector inmersivo (modo por páginas a pantalla completa) -----------------
// En modo paginado la app entera se rinde: sin cabecera ni barras, fondo
// negro y la página al máximo. La Fullscreen API se intenta donde existe
// (en iPhone no está para elementos: la inmersión CSS basta y nada se rompe).
function setImmersive(on) {
  const section = document.getElementById('view-reader');
  if (!section) return;
  const isOn = document.body.classList.contains('immersive');
  if (on === isOn) return;
  document.body.classList.toggle('immersive', on);
  section.classList.toggle('immersive', on);
  if (on) {
    setReaderControlsVisible(false);
    try {
      if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
        const p = document.documentElement.requestFullscreen();
        if (p && p.catch) p.catch(() => {});
      }
    } catch { /* sin Fullscreen API: inmersión CSS */ }
  } else {
    try {
      if (document.fullscreenElement && document.exitFullscreen) {
        const p = document.exitFullscreen();
        if (p && p.catch) p.catch(() => {});
      }
    } catch { /* noop */ }
  }
}

function setReaderControlsVisible(v) {
  const rc = $('#reader-controls');
  if (!rc) return;
  rc.hidden = !v;
  if (state.reader) state.reader.controls = v;
}

function syncFitUi() {
  const fit = pref.pageFit();
  const btn = $('#btn-rc-fit');
  if (btn) btn.textContent = `Encuadre: ${fit === 'llenar' ? 'Llenar' : 'Ajustar'}`;
  const sel = $('#set-page-fit');
  if (sel && sel.value !== fit) sel.value = fit;
}

function syncModeUi() {
  const mode = pref.readerMode();
  const label = `Modo: ${mode === 'paged' ? 'Páginas' : 'Scroll'}`;
  $('#btn-mode').textContent = label;
  const rc = $('#btn-rc-mode');
  if (rc) rc.textContent = label;
}

function cycleFit() {
  const next = pref.pageFit() === 'llenar' ? 'ajustar' : 'llenar';
  localStorage.setItem('tinta.pageFit', next);
  syncFitUi();
  if (state.reader && pref.readerMode() === 'paged') paintPaged();
  toast(next === 'llenar' ? 'Encuadre: llenar pantalla (recorta)' : 'Encuadre: ajustar (página completa)');
}

let scrollObserver = null;

function renderReader() {
  const r = state.reader;
  if (!r) return;
  applyReaderBg();
  const box = $('#pages');
  const mode = pref.readerMode();
  box.className = 'pages' + (mode === 'paged' ? ' paged' : '');
  setImmersive(mode === 'paged');
  syncModeUi();
  syncFitUi();
  setReaderControlsVisible(false);
  const rcTitle = $('#rc-title');
  if (rcTitle) rcTitle.textContent = r.local ? r.manga.title : `${r.manga.title} — ${r.label}`;
  if (scrollObserver) { scrollObserver.disconnect(); scrollObserver = null; }
  box.innerHTML = '';
  if (mode === 'paged') {
    const stage = document.createElement('div');
    stage.className = 'paged-stage';
    stage.innerHTML = `
      <div class="zone prev" title="Anterior"></div>
      <div class="zone center" title="Controles"></div>
      <div class="zone next" title="Siguiente"></div>`;
    stage.querySelector('.zone.prev').addEventListener('click', () => zoneNav('prev'));
    stage.querySelector('.zone.next').addEventListener('click', () => zoneNav('next'));
    stage.querySelector('.zone.center').addEventListener('click', () =>
      setReaderControlsVisible(!state.reader?.controls));
    box.appendChild(stage);
    paintPaged();
  } else {
    r.items.forEach((item, i) => {
      const img = document.createElement('img');
      img.src = item.src;
      if (item.original) armImgFallback(img, item.original);
      img.alt = `Página ${i + 1}`;
      img.loading = 'lazy';
      img.dataset.idx = i;
      box.appendChild(img);
    });
    scrollObserver = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          const i = parseInt(e.target.dataset.idx, 10);
          if (i > r.idx) {
            r.idx = i;
            updateIndicator();
            saveProgress(r.sourceId, r.manga, r.chapter, i, r.items.length).catch(() => {});
          }
        }
      }
    }, { threshold: 0.4 });
    box.querySelectorAll('img').forEach((img) => scrollObserver.observe(img));
  }
  updateIndicator();
}

function paintPaged() {
  const r = state.reader;
  const stage = $('#pages .paged-stage');
  if (!stage) return;
  stage.querySelector('img.page-img')?.remove();
  const item = r.items[r.idx];
  const img = document.createElement('img');
  img.className = `page-img fit-${pref.pageFit()}`;
  img.src = item.src;
  if (item.original) armImgFallback(img, item.original);
  img.alt = `Página ${r.idx + 1}`;
  stage.appendChild(img);
  updateIndicator();
}

function updateIndicator() {
  const r = state.reader;
  if (!r) return;
  const text = `${r.idx + 1} / ${r.items.length}`;
  const el = $('#page-indicator');
  if (el) el.textContent = text;
  const rc = $('#rc-indicator');
  if (rc) rc.textContent = text;
}

async function goToPage(i, { quiet = false } = {}) {
  const r = state.reader;
  if (!r) return;
  r.idx = Math.min(Math.max(0, i), r.items.length - 1);
  if (pref.readerMode() === 'paged') {
    paintPaged();
  } else {
    const img = document.querySelector(`#pages img[data-idx="${r.idx}"]`);
    if (img) img.scrollIntoView({ block: 'start' });
    updateIndicator();
  }
  await saveProgress(r.sourceId, r.manga, r.chapter, r.idx, r.items.length).catch(() => {});
  if (!quiet) updateIndicator();
}

// Avance en orden de lectura (la dirección solo decide qué zona/tecla lo pide)
function pageStep(delta) {
  const r = state.reader;
  if (!r || pref.readerMode() !== 'paged') return;
  const next = Math.min(Math.max(0, r.idx + delta), r.items.length - 1);
  if (next !== r.idx) goToPage(next);
}
function zoneNav(zone) {
  const rtl = pref.pageDir() === 'rtl';
  if (zone === 'next') pageStep(rtl ? -1 : 1);
  else pageStep(rtl ? 1 : -1);
}

document.addEventListener('keydown', (e) => {
  if ($('#view-reader').hidden || !state.reader || pref.readerMode() !== 'paged') return;
  if (e.key === 'ArrowRight') zoneNav('next');
  else if (e.key === 'ArrowLeft') zoneNav('prev');
  else if (e.key === ' ' || e.key === 'PageDown') { e.preventDefault(); pageStep(1); }
  else if (e.key === 'PageUp') { e.preventDefault(); pageStep(-1); }
});

// --- CBZ local -------------------------------------------------------------------
function naturalCompare(a, b) {
  const ax = a.split(/(\d+)/);
  const bx = b.split(/(\d+)/);
  for (let i = 0; i < Math.max(ax.length, bx.length); i++) {
    const x = ax[i] ?? '';
    const y = bx[i] ?? '';
    const nx = /^\d+$/.test(x) ? parseInt(x, 10) : null;
    const ny = /^\d+$/.test(y) ? parseInt(y, 10) : null;
    if (nx !== null && ny !== null) { if (nx !== ny) return nx - ny; }
    else if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

const CBZ_MIME = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
  webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp',
};

async function importCbz(file) {
  const buf = new Uint8Array(await file.arrayBuffer());
  const files = await unzip(buf);
  const names = [...files.keys()]
    .filter((n) => !n.endsWith('/') && !n.startsWith('__MACOSX'))
    .filter((n) => CBZ_MIME[n.split('.').pop().toLowerCase()]);
  names.sort(naturalCompare);
  if (!names.length) throw new Error('El CBZ no trae imágenes reconocibles');
  const id = `cbz-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
  const dlKey = `local::${id}`;
  for (let i = 0; i < names.length; i++) {
    const ext = names[i].split('.').pop().toLowerCase();
    const blob = new Blob([files.get(names[i])], { type: CBZ_MIME[ext] });
    await idb.putPage({ key: `${dlKey}::${padIdx(i)}`, dlKey, index: i, blob });
  }
  const title = file.name.replace(/\.cbz$/i, '');
  await idb.putLocalBook({ id, title, totalPages: names.length, addedAt: Date.now() });
  renderLibrary();
  toast(`CBZ importado: ${title} (${names.length} páginas)`);
}

// --- Eventos -----------------------------------------------------------------
document.addEventListener('click', async (e) => {
  const installId = e.target.dataset?.install;
  const openId = e.target.dataset?.open;
  const uninstallId = e.target.dataset?.uninstall;
  const listingId = e.target.dataset?.listing;
  try {
    if (installId) {
      e.target.disabled = true;
      e.target.textContent = 'Instalando…';
      const entry = state.catalog.find((s) => s.id === installId);
      await installFromCatalog(entry);
      renderCatalog($('#catalog-filter').value);
    } else if (openId) {
      await openSource(openId);
    } else if (uninstallId) {
      await idb.deleteSource(uninstallId);
      state.installed.delete(uninstallId);
      renderInstalled();
      renderCatalog($('#catalog-filter').value);
      toast('Fuente quitada (recarga para limpiar su instancia del worker)');
    } else if (listingId) {
      state.mode = 'listing';
      state.listingId = listingId;
      document.querySelectorAll('#listings button').forEach((b) =>
        b.classList.toggle('active', b.dataset.listing === listingId));
      await runListing(1, false);
    }
  } catch (err) {
    toast(err.message, true);
    if (installId) renderCatalog($('#catalog-filter').value);
  }
  if (e.target.closest('[data-back]')) { show('view-sources'); renderLibrary().catch(() => {}); }
  if (e.target.closest('[data-back-browse]')) show('view-browse');
  if (e.target.closest('[data-back-manga]')) {
    const wasLocal = state.reader?.local;
    const readKey = !wasLocal ? state.reader?.chapter?.key : null;
    show(wasLocal ? 'view-sources' : 'view-manga');
    // Al volver del lector, refrescar marcas de avance y descargas. Si el
    // capítulo leído vive en OTRA página de la lista paginada, saltar a ella
    // (re-pintar); si ya es la vigente, basta refrescar las marcas en sitio.
    if (!wasLocal && state.currentManga) {
      const pi = readKey ? chapterListPageOf(readKey) : -1;
      if (pi >= 0 && pi !== state.chapterPage) {
        state.chapterPage = pi;
        renderChapters(state.currentManga).catch(() => {});
      } else {
        refreshChapterMarks().catch(() => {});
      }
    }
  }
});

$('#brand').addEventListener('click', () => { show('view-sources'); renderLibrary().catch(() => {}); });

$('#global-search-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const q = $('#global-search-input').value.trim();
  if (!q) return;
  try { await runGlobalSearch(q); } catch (err) { toast(err.message, true); }
});

$('#btn-check-updates').addEventListener('click', async () => {
  try { await checkForUpdates({ manual: true }); } catch (err) { toast(err.message, true); }
});

$('#goto-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const n = parseFloat($('#goto-input').value);
  if (Number.isFinite(n)) gotoChapterNumber(n);
});

$('#btn-range').addEventListener('click', () => {
  const panel = $('#range-panel');
  panel.hidden = !panel.hidden;
  if (!panel.hidden && state.currentChapters.length) {
    // Sugerencia inicial: los primeros capítulos sin descargar de la serie.
    const nums = state.currentChapters
      .filter((c) => c.chapter_number != null)
      .map((c) => c.chapter_number)
      .sort((a, b) => a - b);
    if (nums.length && !$('#range-from').value) {
      $('#range-from').value = nums[0];
      $('#range-to').value = nums[Math.min(1, nums.length - 1)];
    }
  }
});

$('#btn-range-go').addEventListener('click', () => {
  const from = parseFloat($('#range-from').value);
  const to = parseFloat($('#range-to').value);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) {
    toast('Revisa el rango: «hasta» debe ser mayor o igual que «desde»', true);
    return;
  }
  downloadRange(from, to).catch((err) => toast(err.message, true));
});

$('#btn-range-cancel').addEventListener('click', () => { rangeJob.cancel = true; });

$('#btn-backup-export').addEventListener('click', () => {
  exportBackup().catch((err) => toast(`Respaldo fallido: ${err.message}`, true));
});

$('#backup-file').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  try { await importBackup(file); } catch (err) { toast(`Respaldo no importado: ${err.message}`, true); }
});

$('#btn-order').addEventListener('click', () => {
  setChapterOrder(pref.chapterOrder() === 'asc' ? 'desc' : 'asc');
});

$('#catalog-filter').addEventListener('input', (e) => renderCatalog(e.target.value));

$('#search-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  state.mode = 'search';
  state.lastQuery = $('#search-input').value.trim();
  document.querySelectorAll('#listings button').forEach((b) => b.classList.remove('active'));
  try { await runSearch(1, false); } catch (err) { toast(err.message, true); }
});

$('#btn-more').addEventListener('click', async () => {
  try {
    if (state.mode === 'listing') await runListing(state.page + 1, true);
    else await runSearch(state.page + 1, true);
  } catch (err) { toast(err.message, true); }
});

function toggleReaderMode() {
  const next = pref.readerMode() === 'paged' ? 'scroll' : 'paged';
  localStorage.setItem('tinta.readerMode', next);
  const sel = $('#set-reader-mode');
  if (sel) sel.value = next;
  if (state.reader) {
    renderReader();
    if (next === 'paged') paintPaged();
    else {
      const img = document.querySelector(`#pages img[data-idx="${state.reader.idx}"]`);
      if (img) img.scrollIntoView({ block: 'start' });
    }
    updateIndicator();
  }
  toast(next === 'paged' ? 'Modo por páginas: toca los lados para avanzar, el centro para controles' : 'Modo scroll vertical');
}

$('#btn-mode').addEventListener('click', toggleReaderMode);
$('#btn-rc-mode').addEventListener('click', toggleReaderMode);
$('#btn-rc-fit').addEventListener('click', cycleFit);

$('#cbz-file').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  try { await importCbz(file); } catch (err) { toast(`CBZ no importado: ${err.message}`, true); }
});

$('#btn-settings').addEventListener('click', () => {
  const s = $('#settings');
  s.hidden = !s.hidden;
});

$('#btn-save-settings').addEventListener('click', async () => {
  const proxyBase = $('#proxy-url').value.trim();
  localStorage.setItem('tinta.proxyBase', proxyBase);
  await call({ type: 'config', config: { proxyBase } });
  toast(proxyBase ? 'Proxy guardado' : 'Modo directo (sin proxy)');
  $('#settings').hidden = true;
});

function bindPrefSelect(selId, key, { def, apply } = {}) {
  const sel = $(selId);
  if (!sel) return;
  sel.value = localStorage.getItem(key) ?? def ?? sel.value;
  sel.addEventListener('change', () => {
    localStorage.setItem(key, sel.value);
    if (apply) apply(sel.value);
    toast('Preferencia guardada');
  });
}

// --- Arranque ------------------------------------------------------------------
(async function boot() {
  const bootStatus = (t) => { const el = $('#boot-status'); if (el) el.textContent = t; };
  const verEl = $('#app-version');
  if (verEl) verEl.textContent = 'v' + APP_VERSION;
  bindPrefSelect('#set-reader-mode', 'tinta.readerMode', { def: 'scroll', apply: () => { if (state.reader) renderReader(); } });
  bindPrefSelect('#set-page-dir', 'tinta.pageDir', { def: 'ltr' });
  bindPrefSelect('#set-page-fit', 'tinta.pageFit', {
    def: 'ajustar',
    apply: () => { syncFitUi(); if (state.reader && pref.readerMode() === 'paged') paintPaged(); },
  });
  bindPrefSelect('#set-preload', 'tinta.preloadCount', { def: '1' });
  bindPrefSelect('#set-reader-bg', 'tinta.readerBg', { def: 'negro', apply: () => applyReaderBg() });
  applyReaderBg();
  // Orden de capítulos: el <select> de Ajustes y el botón de la lista comparten
  // setChapterOrder (persiste, reinicia la paginación y re-pinta si hay manga).
  const ordSel = $('#set-chapter-order');
  if (ordSel) {
    ordSel.value = pref.chapterOrder();
    ordSel.addEventListener('change', () => setChapterOrder(ordSel.value));
  }
  syncOrderUi();
  if ('serviceWorker' in navigator) {
    // Si un SW nuevo toma el control, recargar una vez para estrenar todo el
    // cascaron nuevo (evita actualizaciones "a medias" en iOS).
    const hadController = !!navigator.serviceWorker.controller;
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (hadController && !reloaded) { reloaded = true; location.reload(); }
    });
    navigator.serviceWorker.register('sw.js')
      .then((reg) => reg.update())
      .catch(() => {});
  }
  // Esperar al worker y aplicar configuración (con tope: la UI nunca se
  // queda muda esperando a un worker que no respondió)
  const start = Date.now();
  while (!workerReady && Date.now() - start < 5000) {
    await new Promise((r) => setTimeout(r, 50));
  }
  const proxyBase = localStorage.getItem('tinta.proxyBase') || '';
  $('#proxy-url').value = proxyBase;
  try {
    const cfg = await Promise.race([
      call({ type: 'config', config: { proxyBase, languages: ['en', 'es'] } }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 10000)),
    ]);
    const pill = $('#net-status');
    if (cfg.jspi) { pill.textContent = 'JSPI activo'; pill.classList.add('ok'); }
    else { pill.textContent = 'Respaldo XHR síncrono'; }
    const vi = $('#version-info');
    if (vi) {
      vi.textContent = `Tinta v${APP_VERSION} · Host v${cfg.build || '?'}` +
        (cfg.build && cfg.build !== APP_VERSION ? ' · ⚠️ actualización a medias: cierra y reabre la app' : '');
    }
  } catch { $('#net-status').textContent = 'Worker sin respuesta'; }

  bootStatus('Restaurando fuentes…');
  await restoreInstalled();
  renderInstalled();
  // Conjunto de descargas ya presentes en este dispositivo
  const existingDownloads = await idb.allDownloads().catch(() => []);
  state.downloaded = new Set(existingDownloads.map((d) => d.key));
  await renderLibrary();
  // Chequeo de novedades automático: como máximo una vez al día y solo si
  // hay biblioteca que revisar; corre en segundo plano, sin bloquear el
  // arranque, y sus fallos se tragan (cada serie ya tolera los suyos).
  const lastCheck = parseInt(localStorage.getItem('tinta.lastUpdateCheck') || '0', 10);
  if (Date.now() - lastCheck > 24 * 3600 * 1000) {
    idb.allLibrary().then((lib) => {
      if (lib.length) checkForUpdates({ manual: false }).catch(() => {});
    }).catch(() => {});
  }
  bootStatus('Cargando catálogo…');
  try {
    const res = await fetch(CATALOG_BASE + 'index.min.json');
    const idx = await res.json();
    state.catalog = idx.sources || [];
    renderCatalog();
  } catch (err) {
    $('#catalog').innerHTML = `<p class="hint">⚠️ No se pudo cargar el catálogo: ${esc(err.message)}</p>`;
  }
  window.__tintaBooted = true;
  const el = $('#boot-status');
  if (el) el.hidden = true;
})();
