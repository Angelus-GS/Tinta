// Service worker de Tinta: cachea solo el cascaron de la app (mismo origen).
// Las llamadas a fuentes (MangaDex, catalogo, imagenes) siempre van a la red.
const CACHE = 'tinta-shell-v9';
const SHELL = [
  './',
  './index.html',
  './styles.css',
  './main.js',
  './host-worker.js',
  './lib/postcard.js',
  './lib/types.js',
  './lib/unzip.js',
  './lib/idb.js',
  './manifest.webmanifest',
  './icons/icon.svg',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(
    caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy));
      return res;
    })),
  );
});
