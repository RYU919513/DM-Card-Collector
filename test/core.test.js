import test from 'node:test';
import assert from 'node:assert/strict';
import { compareRecords, detectSource, fingerprint, imageCandidates, makeRaw, parseCapture, validate } from '../src/core.js';

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
  assert.equal('html' in raw.payload, false);
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

test('official fixture resolves paste URL and title fields', () => {
  const parsed = parseCapture({
    title: '熱き邪道 レッドゾーンZ (DM25RP3 5/77)',
    text: '熱き邪道 レッドゾーンZ\nhttps://dm.takaratomy.co.jp/card/detail/?id=dm25rp3-005'
  }, { url: 'https://ryu919513.github.io/DM-Card-Collector/', method: 'paste' });
  assert.equal(parsed.source, 'official');
  assert.equal(parsed.fields.name, '熱き邪道 レッドゾーンZ');
  assert.equal(parsed.fields.number, 'DM25RP3 5/77');
  assert.equal(parsed.fields.sourceUrl, 'https://dm.takaratomy.co.jp/card/detail/?id=dm25rp3-005');
  assert.equal(validate(parsed).valid, true);
});

test('official source detection rejects deceptive hostname', () => {
  assert.equal(detectSource('https://evil-dm.takaratomy.co.jp.example.com/card'), 'generic');
  assert.equal(detectSource('https://sub.dm.takaratomy.co.jp/card'), 'official');
});

test('number can be read from body without title', () => {
  assert.equal(parseCapture('熱き邪道 レッドゾーンZ\nDM25RP3 5/77').fields.number, 'DM25RP3 5/77');
});

test('collector visible DOM is rejected with a useful validation error', () => {
  const parsed = parseCapture({ url: 'https://ryu919513.github.io/DM-Card-Collector/', title: 'DM Card Collector', text: 'LOCAL-FIRST PWA\nDM Card Collector\nNO CLOUD WRITES' }, { method: 'visible-dom' });
  const result = validate(parsed);
  assert.equal(result.valid, false);
  assert.match(result.errors.join(' '), /Collector自身/);
});

test('DOM image fields and srcsets normalize safe URLs only', () => {
  const result = imageCandidates([{ currentSrc: '/current.webp', src: 'https://img.test/card', srcset: '/small.jpg 1x, /large.jpg 2x', dataSrc: '/lazy.png', dataLazySrc: 'data:image/png,x', dataOriginal: 'blob:x' }, 'javascript:alert(1)'], 'https://dm.takaratomy.co.jp/card/');
  assert.deepEqual(result, ['https://dm.takaratomy.co.jp/current.webp', 'https://img.test/card', 'https://dm.takaratomy.co.jp/small.jpg', 'https://dm.takaratomy.co.jp/large.jpg', 'https://dm.takaratomy.co.jp/lazy.png']);
});
