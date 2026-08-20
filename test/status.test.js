import test from 'node:test';
import assert from 'node:assert/strict';
import { annotateWithComparisons, buildStats, deriveStatus, filterByStatus, isDeleteEligible, searchRecords } from '../src/status.js';

const successRecord = {
  id: 'dm-aabbccdd',
  rawId: 'raw-001',
  capturedAt: '2024-01-01T00:00:00Z',
  status: 'pending',
  confidence: 0.85,
  source: 'dmwiki',
  provenance: { method: 'paste', capturedAt: '2024-01-01T00:00:00Z' },
  duplicateCount: 0,
  fields: { name: 'ボルシャック・ドラゴン', number: 'DM01 1/110', imageUrls: [] }
};

const failedRecord = {
  id: 'dm-fail0001',
  status: 'failed',
  capturedAt: '2024-01-02T00:00:00Z',
  confidence: 0,
  fields: { name: null, number: null, imageUrls: [] }
};

const reviewRecord = {
  ...successRecord,
  id: 'dm-review01',
  rawId: 'raw-002',
  confidence: 0.3,
  humanReviewRequired: true,
  fields: { name: 'Unknown Card', number: null, imageUrls: [] }
};

const mhtSearchRecord = {
  id: 'mht-1',
  pageType: 'SEARCH_RESULT',
  state: 'HUMAN_REVIEW_REQUIRED',
  humanReviewRequired: true,
  provenance: { sourceFileHash: 'hash-1', rawSourceReference: 'hash-1' },
  validation: { valid: true },
  cards: [{ officialId: 'dm-001', detailUrl: 'https://dm.takaratomy.co.jp/card/detail/?id=dm-001' }]
};

test('deriveStatus returns SUCCESS for high-confidence record with name+number', () => {
  assert.equal(deriveStatus(successRecord), 'SUCCESS');
});

test('deriveStatus returns FAILED for status=failed record', () => {
  assert.equal(deriveStatus(failedRecord), 'FAILED');
  assert.equal(deriveStatus(null), 'FAILED');
});

test('deriveStatus returns NEEDS_REVIEW when humanReviewRequired=true', () => {
  assert.equal(deriveStatus(reviewRecord), 'NEEDS_REVIEW');
  assert.equal(deriveStatus(mhtSearchRecord), 'NEEDS_REVIEW');
});

test('deriveStatus returns NEEDS_REVIEW for low confidence', () => {
  assert.equal(deriveStatus({ ...successRecord, confidence: 0.4, id: 'dm-low' }), 'NEEDS_REVIEW');
});

test('deriveStatus returns CONFLICT when _hasConflict is set', () => {
  assert.equal(deriveStatus({ ...successRecord, _hasConflict: true, id: 'dm-conf' }), 'CONFLICT');
});

test('deriveStatus returns DUPLICATE when duplicateCount > 0', () => {
  assert.equal(deriveStatus({ ...successRecord, duplicateCount: 1, id: 'dm-dup' }), 'DUPLICATE');
});

test('isDeleteEligible returns true for a fully-preserved record', () => {
  assert.equal(isDeleteEligible(successRecord), true);
  assert.equal(isDeleteEligible(mhtSearchRecord), true);
});

test('isDeleteEligible returns false for failed record', () => {
  assert.equal(isDeleteEligible(failedRecord), false);
  assert.equal(isDeleteEligible(null), false);
});

test('isDeleteEligible returns false when raw preservation proof is absent', () => {
  const { rawId: _r, ...noRaw } = successRecord;
  assert.equal(isDeleteEligible({ ...noRaw, id: 'dm-noraw' }), false);
});

test('isDeleteEligible returns false when provenance is missing', () => {
  const { provenance: _p, ...noProv } = successRecord;
  assert.equal(isDeleteEligible({ ...noProv, rawId: 'raw-x', id: 'dm-noprov' }), false);
});

test('isDeleteEligible accepts mhtRawId as raw preservation proof', () => {
  const record = { ...successRecord, id: 'dm-mhtraw', rawId: undefined, mhtRawId: 'mht-001' };
  assert.equal(isDeleteEligible(record), true);
});

test('isDeleteEligible accepts localRawSaved flag', () => {
  const record = { ...successRecord, id: 'dm-lrs', rawId: undefined, localRawSaved: true };
  assert.equal(isDeleteEligible(record), true);
});

test('name/number missing and confidence 0 does not become delete-eligible without extracted card payload', () => {
  const record = {
    id: 'mht-empty',
    pageType: 'UNKNOWN',
    confidence: 0,
    provenance: { sourceFileHash: 'hash-empty' },
    validation: { valid: false },
    humanReviewRequired: true
  };
  assert.equal(isDeleteEligible(record), false);
});

test('humanReviewRequired boundary is preserved (never auto-success)', () => {
  const record = { ...mhtSearchRecord, confidence: 0.9 };
  assert.equal(deriveStatus(record), 'NEEDS_REVIEW');
  assert.equal(record.humanReviewRequired, true);
});

test('filterByStatus ALL returns all records', () => {
  const records = [successRecord, { ...reviewRecord }, { ...failedRecord }];
  assert.equal(filterByStatus(records, 'ALL').length, 3);
});

test('filterByStatus SUCCESS returns only success records', () => {
  const records = [successRecord, reviewRecord, failedRecord];
  const result = filterByStatus(records, 'SUCCESS');
  assert.ok(result.every(r => deriveStatus(r) === 'SUCCESS'));
});

test('searchRecords finds by partial card name', () => {
  const records = [successRecord];
  assert.equal(searchRecords(records, 'ボルシャック').length, 1);
  assert.equal(searchRecords(records, 'ピカチュウ').length, 0);
});

test('searchRecords finds by card number', () => {
  assert.equal(searchRecords([successRecord], 'DM01').length, 1);
  assert.equal(searchRecords([successRecord], 'DM99').length, 0);
});

test('searchRecords returns all records for empty query', () => {
  assert.equal(searchRecords([successRecord, failedRecord], '').length, 2);
});

test('buildStats counts all status categories', () => {
  const records = [successRecord, { ...reviewRecord, id: 'r1' }, { ...failedRecord, id: 'r2' }, mhtSearchRecord];
  const stats = buildStats(records);
  assert.equal(stats.total, 4);
  assert.equal(stats.SUCCESS, 1);
  assert.equal(stats.NEEDS_REVIEW, 2);
  assert.equal(stats.FAILED, 1);
  assert.equal(stats.DELETE_ELIGIBLE, 3);
});

test('annotateWithComparisons flags records with conflict', () => {
  const records = [
    { ...successRecord, id: 'a', fields: { name: 'Card A', number: '1/100', imageUrls: [] } },
    { ...successRecord, id: 'b', source: 'official', fields: { name: 'Card B', number: '1/100', imageUrls: [] } }
  ];
  const comparisons = [{ key: '1/100', conflicts: ['name'], sources: ['dmwiki', 'official'], canonicalId: 'b' }];
  const result = annotateWithComparisons(records, comparisons);
  assert.ok(result.find(r => r.id === 'a')?._hasConflict);
  assert.ok(result.find(r => r.id === 'b')?._hasConflict);
});

test('annotateWithComparisons does not mutate original records', () => {
  annotateWithComparisons([successRecord], []);
  assert.equal(successRecord._hasConflict, undefined);
});
