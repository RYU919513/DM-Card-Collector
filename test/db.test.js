import test from 'node:test';
import assert from 'node:assert/strict';
import { get, getAll, openDB, saveMhtImport } from '../src/db.js';

class FakeDB{
  constructor(){this.version=0;this.stores=new Map;this.objectStoreNames={contains:name=>this.stores.has(name)}}
  createObjectStore(name){if(!this.stores.has(name))this.stores.set(name,new Map);return this.stores.get(name)}
  transaction(storeNames){return new FakeTransaction(this,Array.isArray(storeNames)?storeNames:[storeNames])}
  close(){}
}
class FakeTransaction{
  constructor(db,storeNames){this.db=db;this.storeNames=storeNames;this.pending=0;this.timer=null}
  objectStore(name){if(!this.db.stores.has(name))this.db.stores.set(name,new Map);return new FakeObjectStore(this,this.db.stores.get(name))}
  touch(){this.pending+=1;clearTimeout(this.timer)}
  settle(){this.pending-=1;if(this.pending===0){clearTimeout(this.timer);this.timer=setTimeout(()=>this.oncomplete?.(),5)}}
  abort(){clearTimeout(this.timer);this.onabort?.()}
}
class FakeObjectStore{
  constructor(tx,store){this.tx=tx;this.store=store}
  request(run){const request={};this.tx.touch();setTimeout(()=>{try{request.result=run();request.onsuccess?.({target:request})}catch(error){request.error=error;request.onerror?.({target:request})}finally{this.tx.settle()}},0);return request}
  put(value){return this.request(()=>{this.store.set(value.id,structuredClone(value));return value.id})}
  get(id){return this.request(()=>structuredClone(this.store.get(id)))}
  getAll(){return this.request(()=>[...this.store.values()].map(value=>structuredClone(value)))}
  delete(id){return this.request(()=>this.store.delete(id))}
}
function installIndexedDb(){const databases=new Map;globalThis.indexedDB={open(name,version){const request={};setTimeout(()=>{let db=databases.get(name);if(!db){db=new FakeDB;databases.set(name,db)}request.result=db;if(version>db.version){db.version=version;request.onupgradeneeded?.({target:request})}request.onsuccess?.({target:request})},0);return request}}}

test.beforeEach(()=>installIndexedDb());

test('openDB preserves existing stores and adds mhtImages additively', async () => {
  const db=await openDB();
  for(const name of ['raw','staging','failed','mhtRaw','mhtImports','mhtImages']) assert.equal(db.objectStoreNames.contains(name),true);
});

test('saveMhtImport persists raw/import/image blobs and deduplicates by hash', async () => {
  const raw={id:'raw-1',sourceFileHash:'raw-1',bytes:new Blob(['mht'])};
  const candidate={id:'import-1',officialId:'dm-001',provenance:{sourceFileHash:'raw-1'}};
  const image={id:'hash-1',hash:'hash-1',blob:new Blob(['image-a']),mimeType:'image/jpeg',contentLocations:['https://dm.takaratomy.co.jp/a.jpg'],contentIds:['cid-a'],provenance:[{sourceFileHash:'raw-1',mhtImportId:'import-1'}]};
  await saveMhtImport(raw,candidate,[image]);
  await saveMhtImport({...raw,id:'raw-2',sourceFileHash:'raw-2'},{...candidate,id:'import-2',provenance:{sourceFileHash:'raw-2'}},[{...image,sourceFileHash:'raw-2',mhtImportId:'import-2',contentLocations:['https://dm.takaratomy.co.jp/b.jpg'],provenance:[{sourceFileHash:'raw-2',mhtImportId:'import-2'}]}]);
  assert.equal((await getAll('mhtRaw')).length,2);
  assert.equal((await getAll('mhtImports')).length,2);
  const stored=await get('mhtImages','hash-1');
  assert.equal(await stored.blob.text(),'image-a');
  assert.deepEqual(stored.contentLocations.sort(),['https://dm.takaratomy.co.jp/a.jpg','https://dm.takaratomy.co.jp/b.jpg']);
  assert.equal(stored.provenance.length,2);
});
