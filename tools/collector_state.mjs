import { createHash } from 'node:crypto';

export const COLLECTION_STATES = Object.freeze(['FRESH', 'STALE', 'CHANGED', 'UNKNOWN', 'FAILED', 'HUMAN_REVIEW']);
export const PIPELINE_STATES = Object.freeze(['COLLECTED', 'VALIDATED', 'APPROVED', 'PUBLISHED']);

export function sha256(value) {
  return createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
}

export function classifyCollection({ failed = false, reviewed = false, contentHash, previousHash, retrievedAt, maxAgeMs = 86400000, now = Date.now() } = {}) {
  if (failed) return 'FAILED';
  if (reviewed) return 'HUMAN_REVIEW';
  if (!contentHash || !retrievedAt) return 'UNKNOWN';
  if (previousHash && previousHash !== contentHash) return 'CHANGED';
  const age = now - Date.parse(retrievedAt);
  return Number.isFinite(age) && age <= maxAgeMs ? 'FRESH' : 'STALE';
}

export function shouldCollect(state) {
  return state !== 'FRESH';
}

export function validateCandidate(candidate) {
  const errors = [];
  const provenance = candidate?.provenance || {};
  if (!candidate?.id) errors.push('missing id');
  if (!candidate?.fields?.name && !candidate?.fields?.number) errors.push('missing name and number');
  for (const field of ['sourceIdentifier', 'retrievedAt', 'parserVersion', 'schemaVersion', 'contentHash', 'normalizationVersion']) {
    if (provenance[field] === undefined || provenance[field] === null || provenance[field] === '') errors.push(`missing provenance.${field}`);
  }
  if (candidate?.pipelineState && !PIPELINE_STATES.includes(candidate.pipelineState)) errors.push('invalid pipelineState');
  return { valid: errors.length === 0, errors, requiresHumanReview: errors.length > 0 || candidate?.pipelineState !== 'APPROVED' };
}

export function detectConflicts(records) {
  const byId = new Map();
  const byName = new Map();
  const conflicts = [];
  for (const record of records) {
    const id = record.fields?.number || record.id;
    const name = record.fields?.name?.normalize('NFKC').toLowerCase();
    if (id && byId.has(id) && sha256(byId.get(id).fields) !== sha256(record.fields)) conflicts.push({ type: 'same-id-different-content', key: id });
    if (name && byName.has(name) && (byName.get(name).fields?.number || byName.get(name).id) !== id) conflicts.push({ type: 'same-name-different-id', key: name });
    if (id) byId.set(id, record);
    if (name) byName.set(name, record);
  }
  return conflicts;
}
