import test from 'node:test';
import assert from 'node:assert/strict';
import { compareRecords, createBookmarklet, detectSource, fingerprint, imageCandidates, makeRaw, parseCapture, validate } from '../src/core.js';

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

test('official pasted URL wins over Collector context and spoofed hosts are rejected', () => {
  const official = 'https://dm.takaratomy.co.jp/card/detail/?id=dm25rp3-005';
  const parsed = parseCapture({ text: `${official}\n熱き邪道 レッドゾーンZ (DM25RP3 5/77)` }, { url: 'https://collector.example/app' });
  assert.equal(parsed.source, 'official');
  assert.equal(parsed.fields.sourceUrl, official);
  assert.equal(parsed.fields.name, '熱き邪道 レッドゾーンZ');
  assert.equal(parsed.fields.number, 'DM25RP3 5/77');
  for (const fake of ['https://dm.takaratomy.co.jp.evil.example/card', 'https://evil-dm.takaratomy.co.jp.example/card']) assert.notEqual(detectSource(fake), 'official');
});

test('title and text are both parsed, including official title', () => {
  const parsed = parseCapture({ title: '熱き邪道 レッドゾーンZ (DM25RP3 5/77)', text: 'カード詳細' });
  assert.equal(parsed.fields.name, '熱き邪道 レッドゾーンZ');
  assert.equal(parsed.fields.number, 'DM25RP3 5/77');
});

test('Collector self capture and fixed UI labels fail validation', () => {
  const self = parseCapture({ title: 'DM Card Collector', text: 'LOCAL-FIRST PWA\nDM Card Collector' }, { method: 'visible-dom', url: 'https://collector.example/' });
  assert.equal(validate(self).valid, false);
  assert.equal(validate(parseCapture('LOCAL-FIRST PWA')).valid, false);
});

test('image attributes and srcsets normalize, deduplicate, and reject dangerous schemes', () => {
  const images = imageCandidates([{ currentSrc: '/card.jpg', srcset: '/card.jpg 1x, https://img.example/card@2x.webp 2x', src: 'data:image/png,x', lazy: 'javascript:alert(1)', original: 'blob:x' }], 'https://dm.takaratomy.co.jp/card/');
  assert.deepEqual(images, ['https://dm.takaratomy.co.jp/card.jpg', 'https://img.example/card@2x.webp']);
});

test('bookmarklet captures page fields and image attributes for bookmarklet route', () => {
  const script = createBookmarklet('https://collector.example/app/');
  assert.match(script, /^javascript:/);
  for (const field of ['location.href', 'document.title', 'document.body.innerText', 'currentSrc', 'srcset', 'data-lazy-src', 'data-original']) assert.match(script, new RegExp(field.replace('.', '\\.')));
  assert.match(script, /\?capture=/);
});
