// IndexedDB mínima: fuentes instaladas (bytes del .aix ya extraídos no,
// el paquete crudo sí) y su metadata.
const DB_NAME = 'tinta';
const DB_VERSION = 1;

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('sources')) db.createObjectStore('sources', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(storeName, mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(storeName, mode);
    const store = t.objectStore(storeName);
    const out = fn(store);
    t.oncomplete = () => resolve(out?.result ?? out);
    t.onerror = () => reject(t.error);
  });
}

export const idb = {
  putSource: (record) => tx('sources', 'readwrite', (s) => s.put(record)),
  getSource: (id) => tx('sources', 'readonly', (s) => s.get(id)),
  allSources: () => tx('sources', 'readonly', (s) => s.getAll()),
  deleteSource: (id) => tx('sources', 'readwrite', (s) => s.delete(id)),
};
