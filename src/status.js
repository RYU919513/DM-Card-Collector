/**
 * Status and delete-eligibility helpers for DM Card Collector.
 * Additive — never mutates existing IndexedDB stores.
 */

/**
 * Derive a display status from a staging/failed/mhtImport record.
 * Maps onto the existing schema values without inventing new state.
 *
 * Possible return values:
 *   SUCCESS        – parsed, validated, raw preserved, provenance intact
 *   NEEDS_REVIEW   – humanReviewRequired, low confidence, or missing key fields
 *   FAILED         – validation/parse failure
 *   CONFLICT       – cross-source field conflicts detected
 *   DUPLICATE      – same card seen from multiple sources
 */
export function deriveStatus(record) {
  if (!record) return 'FAILED';
  // Explicit failure (staging/failed store)
  if (record.status === 'failed') return 'FAILED';
  // MHT import explicit failure state (state field from PR#6 schema)
  if (record.state === 'FAILED' || record.state === 'VALIDATION_FAILED') return 'FAILED';
  // MHT CONFLICT
  if (record.state === 'CONFLICT') return 'CONFLICT';
  // MHT or capture DUPLICATE
  if (record.state === 'DUPLICATE' || record.duplicate?.kind === 'DUPLICATE' || record.duplicate?.kind === 'DUPLICATE_RAW') return 'DUPLICATE';
  // Conflict detected by compareRecords
  if (record._hasConflict) return 'CONFLICT';
  // Duplicate from same or other source (capture path)
  if (record.duplicateCount > 0) return 'DUPLICATE';
  // humanReviewRequired (both MHT and capture paths)
  if (record.humanReviewRequired || record.state === 'HUMAN_REVIEW_REQUIRED') return 'NEEDS_REVIEW';
  // Low confidence → needs review
  if (typeof record.confidence === 'number' && record.confidence < 0.5) return 'NEEDS_REVIEW';
  // Missing both name and number → needs review
  const f = record.fields || {};
  if (!f.name && !f.number && !record.cardName && !record.cardNumber) return 'NEEDS_REVIEW';
  return 'SUCCESS';
}

/**
 * Determine whether the original source file (MHT/share) is safe to delete.
 *
 * DELETE_ELIGIBLE conditions (ALL must be true):
 *   1. parse succeeded (no status==='failed')
 *   2. local raw preserved in IndexedDB (rawId present or mhtRaw saved)
 *   3. candidate/import metadata saved (id present)
 *   4. provenance recorded
 *   5. validation result recorded
 *   6. humanReviewRequired boundary preserved (not suppressed)
 *
 * IMPORTANT: DELETE_ELIGIBLE !== APPROVED.
 * This is NOT usageAllowed, NOT productionReady.
 */
export function isDeleteEligible(record) {
  if (!record) return false;
  // Explicit failures are not eligible
  if (record.status === 'failed') return false;
  if (record.state === 'FAILED' || record.state === 'VALIDATION_FAILED') return false;
  // id must exist (metadata saved)
  if (!record.id) return false;
  // provenance must be recorded (capture path or MHT path)
  if (!record.provenance && !record.provenanceHistory) return false;
  // validation result must be present:
  //   - capture path: confidence is a number
  //   - MHT path: validation object from validateMhtCandidate
  const hasValidation = typeof record.confidence === 'number' || (record.validation && typeof record.validation.valid === 'boolean');
  if (!hasValidation) return false;
  // raw must be preserved:
  //   - capture path: rawId links to raw store
  //   - MHT path: provenance.sourceFileHash links to mhtRaw store
  const hasRawProof = record.rawId || record.mhtRawId || record.localRawSaved
    || (record.provenance?.sourceFileHash) || (record.provenance?.rawSourceReference);
  if (!hasRawProof) return false;
  // Require minimum parsed payload so "raw only" placeholders are not marked safe.
  if (record.pageType === 'SEARCH_RESULT' && (!Array.isArray(record.cards) || record.cards.length === 0)) return false;
  if (record.pageType === 'CARD_DETAIL' && !(record.officialId || record.cardName || record.cardNumber)) return false;
  if (!record.pageType) {
    const f = record.fields || {};
    if (!f.name && !f.number && !record.cardName && !record.cardNumber && !record.officialId) return false;
  }
  return true;
}

/**
 * Annotate a list of records with conflict/duplicate info from compareRecords output.
 * Returns new record objects (no mutation).
 */
export function annotateWithComparisons(records, comparisons = []) {
  const conflictIds = new Set();
  const duplicateIds = new Set();
  for (const comp of comparisons) {
    if (comp.conflicts.length > 0) {
      // all records in this group have a conflict
      for (const record of records) {
        const key = (record.fields?.number || record.fields?.name || '').normalize('NFKC').toLowerCase();
        if (key === comp.key) conflictIds.add(record.id);
      }
    }
  }
  return records.map(record => {
    const annotated = { ...record };
    if (conflictIds.has(record.id)) annotated._hasConflict = true;
    if ((record.duplicateCount || 0) > 0) annotated._isDuplicate = true;
    return annotated;
  });
}

/**
 * Filter records by status string or 'ALL'.
 */
export function filterByStatus(records, filter = 'ALL') {
  if (filter === 'ALL') return records;
  return records.filter(record => deriveStatus(record) === filter);
}

/**
 * Search records by name, number, or officialId (case-insensitive, partial match).
 */
export function searchRecords(records, query = '') {
  const q = query.normalize('NFKC').toLowerCase().trim();
  if (!q) return records;
  return records.filter(record => {
    const f = record.fields || {};
    const name = String(f.name || record.cardName || '').normalize('NFKC').toLowerCase();
    const number = String(f.number || record.cardNumber || '').normalize('NFKC').toLowerCase();
    const officialId = String(f.officialId || record.officialId || '').normalize('NFKC').toLowerCase();
    return name.includes(q) || number.includes(q) || officialId.includes(q);
  });
}

/**
 * Build a statistics summary from an array of annotated records.
 */
export function buildStats(records) {
  const stats = { total: records.length, SUCCESS: 0, NEEDS_REVIEW: 0, FAILED: 0, CONFLICT: 0, DUPLICATE: 0, DELETE_ELIGIBLE: 0 };
  for (const record of records) {
    const s = deriveStatus(record);
    stats[s] = (stats[s] || 0) + 1;
    if (isDeleteEligible(record)) stats.DELETE_ELIGIBLE += 1;
  }
  return stats;
}
