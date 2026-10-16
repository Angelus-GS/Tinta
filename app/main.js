// Tinta — UI mínima de Fase 1 (flujo: instalar → buscar → detalle → leer).
import { idb } from './lib/idb.js';
import { MangaStatus, ContentRating } from './lib/types.js';

window.__tintaBooted = false;

// Versión visible de la app: súbela (y la cache del SW) en cada publicación.
// El host reporta la suya (HOST_BUILD en worker-src.js); si difieren, la
// actualización llegó a medias a este dispositivo.
const APP_VERSION = '1.4.1';

const CATALOG_BASE = 'https://aidoku-community.github.io/sources/';
const ANCHORS = ['multi.mangadex', 'en.weebcentral'];
const $ = (sel) => document.querySelector(sel);

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

const state = {
  catalog: [],
  installed: new Map(), // id -> { id, name, version, iconUrl }
  currentSource: null,
  mode: 'search',        // 'search' | 'listing'
  listingId: null,
  page: 1,
  lastQuery: '',
  currentManga: null,
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
  if (d.type === 'partial') return; // Fase 1: los parciales no se pintan aún
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

// --- Detalle y lector --------------------------------------------------------
async function openManga(mangaStub) {
  show('view-manga');
  $('#manga-detail').innerHTML = '<p class="hint">Cargando detalle y capítulos…</p>';
  $('#chapters').innerHTML = '';
  try {
    const m = await call({ type: 'update', sourceId: state.currentSource, manga: mangaStub });
    state.currentManga = m;
    const status = MangaStatus[m.status] || 'Unknown';
    const rating = ContentRating[m.content_rating] || '';
    $('#manga-detail').innerHTML = `
      <div class="detail">
        ${m.cover ? `<img src="${esc(imgUrl(m.cover))}" data-direct="${esc(m.cover)}" alt="">` : ''}
        <div class="info">
          <h2>${esc(m.title)}</h2>
          <p class="tags">${esc((m.authors || []).join(', '))} · ${esc(status)} · ${esc(rating)}</p>
          <p class="tags">${esc((m.tags || []).join(' · '))}</p>
          <p class="desc">${esc(m.description || '')}</p>
        </div>
      </div>`;
    wireImgFallbacks($('#manga-detail'));
    const box = $('#chapters');
    box.innerHTML = '';
    for (const ch of m.chapters || []) {
      const label = [
        ch.chapter_number != null ? `Cap. ${ch.chapter_number}` : '',
        ch.volume_number != null ? `Vol. ${ch.volume_number}` : '',
        ch.title || '',
      ].filter(Boolean).join(' — ') || ch.key;
      const when = ch.date_uploaded ? new Date(ch.date_uploaded * 1000).toLocaleDateString('es-MX') : '';
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'chapter' + (ch.locked ? ' locked' : '');
      row.innerHTML = `<span>${esc(label)}${ch.locked ? ' · no disponible en la fuente' : ''}</span><small>${esc(ch.language || '')} ${esc(when)}</small>`;
      if (!ch.locked) row.onclick = () => openChapter(m, ch, label);
      box.appendChild(row);
    }
    if (!(m.chapters || []).length) box.innerHTML = '<p class="hint">La fuente no devolvió capítulos.</p>';
  } catch (err) {
    $('#manga-detail').innerHTML = `<p class="hint">⚠️ ${esc(err.message)}</p>`;
  }
}

async function openChapter(manga, chapter, label) {
  show('view-reader');
  $('#reader-title').textContent = `${manga.title} — ${label}`;
  const box = $('#pages');
  box.innerHTML = '<p class="hint">Cargando páginas…</p>';
  try {
    const pages = await call({ type: 'pages', sourceId: state.currentSource, manga, chapter });
    box.innerHTML = '';
    let shown = 0;
    for (const p of pages) {
      if (p.content.type === 'url') {
        const img = document.createElement('img');
        img.src = imgUrl(p.content.url);
        armImgFallback(img, p.content.url);
        img.alt = `Página ${shown + 1}`;
        img.loading = 'lazy';
        box.appendChild(img);
        shown++;
      }
    }
    if (!shown) box.innerHTML = '<p class="hint">Este capítulo no trae páginas mostrables en Fase 1.</p>';
  } catch (err) {
    box.innerHTML = `<p class="hint">⚠️ ${esc(err.message)}</p>`;
  }
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
  if (e.target.closest('[data-back]')) show('view-sources');
  if (e.target.closest('[data-back-browse]')) show('view-browse');
  if (e.target.closest('[data-back-manga]')) show('view-manga');
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

// --- Arranque ------------------------------------------------------------------
(async function boot() {
  const bootStatus = (t) => { const el = $('#boot-status'); if (el) el.textContent = t; };
  const verEl = $('#app-version');
  if (verEl) verEl.textContent = 'v' + APP_VERSION;
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
