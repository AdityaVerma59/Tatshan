// Print-shop history, stored on the shop's own device (IndexedDB).
// Files are pulled here the moment a customer sends them, then deleted from the cloud.
const NAME = 'tatshan';

let dbPromise;
function db() {
  dbPromise ||= new Promise((resolve, reject) => {
    const req = indexedDB.open(NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('history', { keyPath: 'id' }).createIndex('createdAt', 'createdAt');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function tx(mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction('history', mode);
    const req = fn(t.objectStore('history'));
    t.oncomplete = () => resolve(req && req.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export const history = {
  // Newest first.
  all: async () => ((await tx('readonly', (s) => s.getAll())) || []).sort((a, b) => b.createdAt - a.createdAt),
  get: (id) => tx('readonly', (s) => s.get(id)),
  put: (rec) => tx('readwrite', (s) => s.put(rec)),
  remove: (id) => tx('readwrite', (s) => s.delete(id)),
  clear: () => tx('readwrite', (s) => s.clear()),
  async markSeen(id) {
    const r = await history.get(id);
    if (r && !r.seen) { r.seen = true; await history.put(r); }
    return r;
  },
  async purgeOlderThan(ms) {
    const cutoff = Date.now() - ms;
    for (const r of await history.all()) if (r.createdAt < cutoff) await history.remove(r.id);
  },
};
