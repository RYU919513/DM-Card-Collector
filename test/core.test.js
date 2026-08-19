import test from 'node:test';
import assert from 'node:assert/strict';
import { compareRecords, contentHash, detectSource, fingerprint, imageCandidates, makeRaw, parseCapture, validate } from '../src/core.js';

test('detects supported sources and generic fallback', () => {
  assert.equal(detectSource('https://dm.takaratomy.co.jp/card/'), 'official');
  assert.equal(detectSource('https://dmwiki.net/x'), 'dmwiki');
  assert.equal(detectSource('https://tcg-portal.example/x'), 'tcg_portal');
  assert.equal(detectSource('https://picodoromeda.example/x'), 'picodoromeda');
  assert.equal(detectSource('https://example.com/x'), 'generic');
});

test('generic parser extracts fields, image URLs, provenance-ready confidence', () => {
  const parsed = parseCapture({ url: 'https://dmwiki.net/Test', text: 'カード名: ボルシャック・ドラゴン\nDM01 1/110\nhttps://img.example/card.webp?x=1' });
  assert.equal(parsed.fields.name, 'ボルシャック・ドラゴン');
  assert.equal(parsed.fields.number, 'DM01 1/110');
  assert.deepEqual(parsed.fields.imageUrls, ['https://img.example/card.webp?x=1']);
  assert.ok(parsed.confidence > 0.5);
  assert.equal(validate(parsed).valid, true);
});

test('raw is capped, retryable, compact, and contains provenance', () => {
  const raw = makeRaw({ text: 'x'.repeat(60000), images: ['https://x.test/a.jpg'] }, { method: 'visible-dom', url: 'https://x.test' });
  assert.equal(raw.payload.text.length, 50000);
  assert.equal(raw.status, 'pending'); assert.equal(raw.attempts, 0);
  assert.equal(raw.provenance.method, 'visible-dom');
  assert.equal(raw.provenance.sourceIdentifier, 'generic');
  assert.ok(raw.provenance.retrievedAt);
  assert.equal('html' in raw.payload, false);
});

test('content hashes are deterministic and change with candidate content', () => {
  assert.equal(contentHash({ name: 'A', number: '1' }), contentHash({ number: '1', name: 'A' }));
  assert.notEqual(contentHash({ name: 'A' }), contentHash({ name: 'B' }));
});

test('validation rejects unusable captures and fingerprints duplicates', () => {
  assert.equal(validate(parseCapture('')).valid, false);
  const a = parseCapture('カード名: Test Card\n1/100');
  const b = parseCapture('カード名:  Test Card\n1/100');
  assert.equal(fingerprint(a), fingerprint(b));
});

test('cross-source comparison reports conflicts and canonical candidate', () => {
  const records = [
    { id: 'wiki', source: 'dmwiki', confidence: .7, fields: { name: 'Card A', number: '1/100', text: 'A' } },
    { id: 'official', source: 'official', confidence: .9, fields: { name: 'Card B', number: '1/100', text: 'B' } }
  ];
  const result = compareRecords(records)[0];
  assert.deepEqual(result.conflicts, ['name', 'text']);
  assert.equal(result.canonicalId, 'official');
  assert.deepEqual(result.sources, ['dmwiki', 'official']);
});

test('image candidates deduplicate URLs without retaining binaries', () => {
  assert.deepEqual(imageCandidates(['https://x.test/a.png', 'https://x.test/a.png']), ['https://x.test/a.png']);
  assert.deepEqual(imageCandidates(['data:image/png;base64,AAAA']), []);
});
