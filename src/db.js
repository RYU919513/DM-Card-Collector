const DB_NAME = 'dm-card-collector';
const VERSION = 2;
// Version 2 adds 'mhtImports' store (additive — existing stores unchanged).
const STORES = ['raw', 'staging', 'failed', 'mhtImports'];

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
