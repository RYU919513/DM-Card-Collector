# DM Card Collector – Handoff

## Current Branch
`copilot/dm-card-collector-development`

## Current HEAD
`b00460c chore: strengthen Codex workflow and MHT extraction tooling`

## Changed Files (this session)
- `src/status.js` — NEW: deriveStatus, isDeleteEligible, annotateWithComparisons, filterByStatus, searchRecords, buildStats
- `src/db.js` — VERSION bump 1→2; additive `mhtImports` store (existing stores untouched)
- `src/app.js` — filter/search/history/stats wiring; imports from status.js
- `index.html` — full UI: summary stats, search, filter toolbar, card list, history, statistics, info panel
- `src/styles.css` — new status badge classes, filter buttons, history list, stats table, info panel
- `test/status.test.js` — NEW: 21 tests for status/eligibility/filter/search/stats/annotation
- `docs/handoff/CURRENT.md` — this file

## Tests
`npm test` → 30 tests, 30 pass, 0 fail
`node --check` → pass (app.js, core.js, db.js, status.js, sw.js)
`git diff --check` → pass

## Implemented Features
### A. 回収進捗サマリー
- 5-column stats: 合計 / SUCCESS / 要確認 / FAILED / 削除可能

### B. 回収済みカード一覧
- cardName, cardNumber, officialId (if present), source type, capturedAt, status badge, conflict/duplicate annotation, deleteEligible badge

### C. 検索 / フィルタ
- Search: カード名 / 番号 / officialId (partial, NFKC-normalized)
- Filter: ALL / SUCCESS / NEEDS_REVIEW / FAILED / CONFLICT / DUPLICATE / DELETE_ELIGIBLE

### D. 回収履歴
- Most recent 20 records: name, timestamp, status dot, deleteEligible badge

### E. 統計
- Table: 成功 / 要確認 / FAILED / 競合 / 重複 / 合計 / 削除可能
- No external chart library; pure HTML table

### F. DELETE_ELIGIBLE判定
- Conditions: id ✓ + provenance ✓ + confidence (number) ✓ + raw preserved (rawId or mhtRawId or localRawSaved) ✓
- VALIDATED ≠ APPROVED: no usageAllowed/productionReady set
- humanReviewRequired boundary preserved: review status visible, does not block eligibility

### G. Galaxy元ファイル削除
- Auto-delete from browser: NOT POSSIBLE (File System Access API delete requires explicit user gesture per-file; Share Target gives no path handle)
- UI: info panel explains → "Galaxyのマイファイルから削除できます"
- No false "deleted" state stored

## IndexedDB Safety
- VERSION 1→2 additive only: no store deletion, no migration, no clear
- Existing raw / staging / failed stores unchanged

## Human Approval Boundary
- usageAllowed, productionReady: never set by this code
- DELETE_ELIGIBLE is strictly a local provenance/raw-preservation check

## Real MHT/MHTML
- No real MHT committed to Git
- mht.js and mht-pipeline.js: not yet implemented (out of scope for this session)

## Known Limitations
- mhtImports store exists in DB schema but no MHT import pipeline UI yet
- Playwright runtime UI verification: not run (browser environment not available in sandbox)
- Real Galaxy device testing: not performed

## NEXT TASK
Implement MHT/MHTML import pipeline (src/mht.js + src/mht-pipeline.js):
- MIME parsing, SEARCH_RESULT / CARD_DETAIL classification
- mhtRaw store preservation
- humanReviewRequired boundary assignment
- Connect to mhtImports store and status.js DELETE_ELIGIBLE flow

## Codex / Next Agent Notes
- status.js is the canonical status/eligibility module — extend here, do not duplicate
- db.js VERSION is now 2; next additive store → VERSION 3
- Filter buttons use data-filter attribute matching deriveStatus() return values
- isDeleteEligible does NOT depend on confidence or humanReviewRequired — only on raw provenance preservation
- All tests in test/ must remain green; add tests for new behavior
