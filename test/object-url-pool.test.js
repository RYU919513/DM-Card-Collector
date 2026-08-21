import test from 'node:test';
import assert from 'node:assert/strict';
import { createObjectUrlPool } from '../src/object-url-pool.js';

test('object URL pool revokes generated URLs', () => {
  const revoked=[],urlApi={createObjectURL:blob=>`blob:${blob.size}:${revoked.length}`,revokeObjectURL:url=>revoked.push(url)},pool=createObjectUrlPool(urlApi);
  const first=pool.create(new Blob(['a'])),second=pool.create(new Blob(['bc']));
  assert.equal(pool.size(),2);
  pool.revoke(first);
  assert.deepEqual(revoked,[first]);
  pool.revokeAll();
  assert.deepEqual(revoked,[first,second]);
  assert.equal(pool.size(),0);
});
