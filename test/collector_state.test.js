import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyCollection, detectConflicts, shouldCollect, validateCandidate } from '../tools/collector_state.mjs';

test('incremental states distinguish reusable, changed, stale, and failed work', () => {
  const now = Date.parse('2026-08-19T00:00:00Z');
  assert.equal(classifyCollection({ contentHash: 'a', previousHash: 'a', retrievedAt: '2026-08-18T23:00:00Z', now }), 'FRESH');
  assert.equal(classifyCollection({ contentHash: 'b', previousHash: 'a', retrievedAt: '2026-08-18T23:00:00Z', now }), 'CHANGED');
  assert.equal(classifyCollection({ contentHash: 'a', retrievedAt: '2026-08-01T00:00:00Z', now }), 'STALE');
  assert.equal(classifyCollection({ failed: true }), 'FAILED');
  assert.equal(shouldCollect('FRESH'), false); assert.equal(shouldCollect('HUMAN_REVIEW'), true);
});

test('candidate validation requires provenance and never implies approval', () => {
  const candidate = { id: '1', fields: { name: 'A' }, pipelineState: 'COLLECTED', provenance: {
    sourceIdentifier: 'official', retrievedAt: '2026-08-19T00:00:00Z', parserVersion: 'v1', schemaVersion: 1,
    contentHash: 'abc', normalizationVersion: 'v1'
  } };
  assert.deepEqual(validateCandidate(candidate), { valid: true, errors: [], requiresHumanReview: true });
  assert.equal(validateCandidate({}).valid, false);
});

test('conflicts expose same ID changes and name collisions', () => {
  const conflicts = detectConflicts([
    { id: 'a', fields: { number: '1/1', name: 'Alpha', text: 'old' } },
    { id: 'b', fields: { number: '1/1', name: 'Alpha', text: 'new' } },
    { id: 'c', fields: { number: '2/2', name: 'Alpha', text: 'new' } }
  ]);
  assert.deepEqual(conflicts.map(item => item.type), ['same-id-different-content', 'same-name-different-id']);
});
