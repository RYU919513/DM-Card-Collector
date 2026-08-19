const DB_NAME = 'dm-card-collector';
const VERSION = 2;
const STORES = ['raw', 'staging', 'failed', 'mhtRaw', 'mhtImports'];

export function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, VERSION);
    request.onupgradeneeded = () => STORES.forEach(name => { if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name, { keyPath: 'id' }); });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function transact(store, mode, action) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const request = action(tx.objectStore(store));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}
export const put = (store, value) => transact(store, 'readwrite', objectStore => objectStore.put(value));
export const getAll = store => transact(store, 'readonly', objectStore => objectStore.getAll());
export const remove = (store, id) => transact(store, 'readwrite', objectStore => objectStore.delete(id));
export function saveMhtImport(raw, candidate) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(['mhtRaw', 'mhtImports'], 'readwrite');
    tx.objectStore('mhtRaw').put(raw); tx.objectStore('mhtImports').put(candidate);
    tx.oncomplete = () => { db.close(); resolve(candidate); };
    tx.onerror = tx.onabort = () => { const error = tx.error; db.close(); reject(error); };
  }));
}
