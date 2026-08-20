import test from 'node:test';
import assert from 'node:assert/strict';
import { annotateWithComparisons, buildStats, deriveStatus, filterByStatus, isDeleteEligible, searchRecords } from '../src/status.js';

// Shared fixtures
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

// ---- deriveStatus ----

test('deriveStatus returns SUCCESS for high-confidence record with name+number', () => {
  assert.equal(deriveStatus(successRecord), 'SUCCESS');
});

test('deriveStatus returns FAILED for status=failed record', () => {
  assert.equal(deriveStatus(failedRecord), 'FAILED');
  assert.equal(deriveStatus(null), 'FAILED');
});

test('deriveStatus returns NEEDS_REVIEW when humanReviewRequired=true', () => {
  assert.equal(deriveStatus(reviewRecord), 'NEEDS_REVIEW');
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

// ---- isDeleteEligible ----

test('isDeleteEligible returns true for a fully-preserved record', () => {
  assert.equal(isDeleteEligible(successRecord), true);
});

test('isDeleteEligible returns false for failed record', () => {
  assert.equal(isDeleteEligible(failedRecord), false);
  assert.equal(isDeleteEligible(null), false);
});

test('isDeleteEligible returns false when rawId and mhtRawId and localRawSaved are absent', () => {
  const { rawId: _r, ...noRaw } = successRecord;
  assert.equal(isDeleteEligible({ ...noRaw, id: 'dm-noraw' }), false);
});

test('isDeleteEligible returns false when provenance is missing', () => {
  const { provenance: _p, ...noProv } = successRecord;
  assert.equal(isDeleteEligible({ ...noProv, rawId: 'raw-x', id: 'dm-noprov' }), false);
});

test('isDeleteEligible accepts mhtRawId as raw preservation proof', () => {
  const r = { ...successRecord, id: 'dm-mhtraw', rawId: undefined, mhtRawId: 'mht-001' };
  assert.equal(isDeleteEligible(r), true);
});

test('isDeleteEligible accepts localRawSaved flag', () => {
  const r = { ...successRecord, id: 'dm-lrs', rawId: undefined, localRawSaved: true };
  assert.equal(isDeleteEligible(r), true);
});

// ---- humanReviewRequired boundary ----

test('isDeleteEligible does not block DELETE_ELIGIBLE when humanReviewRequired=true', () => {
  // humanReviewRequired means pending review, NOT that raw is unsafe to delete.
  // reviewRecord has rawId + provenance + confidence, so it IS eligible.
  assert.equal(isDeleteEligible(reviewRecord), true);
  const fullReview = { ...successRecord, id: 'dm-hr', humanReviewRequired: true };
  assert.equal(isDeleteEligible(fullReview), true);
});

// ---- filterByStatus ----

test('filterByStatus ALL returns all records', () => {
  const records = [successRecord, { ...reviewRecord }, { ...failedRecord }];
  assert.equal(filterByStatus(records, 'ALL').length, 3);
});

test('filterByStatus SUCCESS returns only success records', () => {
  const records = [successRecord, reviewRecord, failedRecord];
  const result = filterByStatus(records, 'SUCCESS');
  assert.ok(result.every(r => deriveStatus(r) === 'SUCCESS'));
});

// ---- searchRecords ----

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

// ---- buildStats ----

test('buildStats counts all status categories', () => {
  const records = [
    successRecord,
    { ...reviewRecord, id: 'r1' },
    { ...failedRecord, id: 'r2' }
  ];
  const stats = buildStats(records);
  assert.equal(stats.total, 3);
  assert.equal(stats.SUCCESS, 1);
  assert.equal(stats.NEEDS_REVIEW, 1);
  assert.equal(stats.FAILED, 1);
  assert.equal(stats.DELETE_ELIGIBLE, 2); // successRecord and reviewRecord both qualify (rawId + provenance)
});

// ---- annotateWithComparisons ----

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
  const orig = { ...successRecord };
  annotateWithComparisons([successRecord], []);
  assert.equal(successRecord._hasConflict, undefined);
});
