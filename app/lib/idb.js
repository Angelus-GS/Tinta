// IndexedDB de Tinta (v2): fuentes instaladas (.aix crudo), biblioteca,
// progreso de lectura, descargas offline (metadatos + blobs de páginas) y
// libros locales importados (CBZ).
const DB_NAME = 'tinta';
const DB_VERSION = 2;
const KEYPATHS = {
  sources: 'id',
  library: 'key',
  progress: 'key',
  downloads: 'key',
  pages: 'key',
  localbooks: 'id',
};

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const [name, keyPath] of Object.entries(KEYPATHS)) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(storeName, mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(storeName, mode);
    const req = fn(t.objectStore(storeName));
    let result;
    // Ojo: hay que resolver el RESULT de la petición. Si se resuelve la
    // petición misma cuando el result es undefined (clave ausente en un
    // get), el llamador recibe un IDBRequest y al re-guardarlo estalla un
    // DataCloneError (bug real cazado en la e2e de Fase 3).
    if (req && typeof req === 'object' && 'onsuccess' in req) {
      req.onsuccess = () => { result = req.result; };
    }
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Transacción abortada'));
  });
}

// Todas las claves que empiezan con `prefix`, en orden (las páginas de una
// descarga viven bajo su clave: `${dlKey}::00000`, `${dlKey}::00001`, …).
async function rangeAll(storeName, prefix) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(storeName, 'readonly');
    const range = IDBKeyRange.bound(prefix, prefix + '\uffff');
    const req = t.objectStore(storeName).getAll(range);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function rangeDelete(storeName, prefix) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(storeName, 'readwrite');
    const range = IDBKeyRange.bound(prefix, prefix + '\uffff');
    const req = t.objectStore(storeName).delete(range);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    t.oncomplete = () => resolve();
  });
}

const get = (name, key) => tx(name, 'readonly', (s) => s.get(key));
const put = (name, rec) => tx(name, 'readwrite', (s) => s.put(rec));
const all = (name) => tx(name, 'readonly', (s) => s.getAll());
const del = (name, key) => tx(name, 'readwrite', (s) => s.delete(key));

export const idb = {
  // Fuentes instaladas
  putSource: (record) => put('sources', record),
  getSource: (id) => get('sources', id),
  allSources: () => all('sources'),
  deleteSource: (id) => del('sources', id),

  // Biblioteca (key = `${sourceId}::${mangaKey}`)
  putLibrary: (rec) => put('library', rec),
  getLibrary: (key) => get('library', key),
  allLibrary: () => all('library'),
  deleteLibrary: (key) => del('library', key),

  // Progreso (key = `${sourceId}::${mangaKey}`)
  putProgress: (rec) => put('progress', rec),
  getProgress: (key) => get('progress', key),
  allProgress: () => all('progress'),
  deleteProgress: (key) => del('progress', key),

  // Descargas (key = `${sourceId}::${mangaKey}::${chapterKey}`)
  putDownload: (rec) => put('downloads', rec),
  getDownload: (key) => get('downloads', key),
  allDownloads: () => all('downloads'),
  async deleteDownloadCascade(key) {
    await del('downloads', key);
    await rangeDelete('pages', key + '::');
  },

  // Páginas descargadas / de libros locales (key = `${dlKey}::${índice}`)
  putPage: (rec) => put('pages', rec),
  getPagesOf: (dlKey) => rangeAll('pages', dlKey + '::'),
  deletePagesOf: (dlKey) => rangeDelete('pages', dlKey + '::'),

  // Libros locales (CBZ)
  putLocalBook: (rec) => put('localbooks', rec),
  getLocalBook: (id) => get('localbooks', id),
  allLocalBooks: () => all('localbooks'),
  async deleteLocalBookCascade(id) {
    await del('localbooks', id);
    await rangeDelete('pages', `local::${id}::`);
    await del('progress', `local::${id}`);
  },
};
