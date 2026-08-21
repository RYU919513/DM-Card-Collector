# DM Card Collector – Handoff

## Current Branch
`copilot/dm-integration`

## Current HEAD
Integration merge of PR#6 (`codex/mht/mhtml`) + PR#9 (`copilot/dm-card-collector-development`)

## Base Mismatch Investigation
- **PR#6** (`codex/mht/mhtml`, head `80dadc0`): MHT/MHTML foundation
- **PR#9** (`copilot/dm-card-collector-development`, head `679d8b3`): Collection progress UI
- Both branched from `b00460c` — **siblings, not parent-child**
- **BASE MISMATCH: VERIFIED** — PR#9 did not contain PR#6 MHT foundation

## Root Cause
New Copilot agent session was initialized from `main` / `b00460c` rather than from the existing `codex/mht/mhtml` branch. Each Copilot task agent session defaulted to `main` as base.

## Repair
Created `copilot/dm-integration` from PR#6 head (`80dadc0`), then merged PR#9 into it.
Three conflicts resolved:
- `src/db.js`: VERSION→3, STORES includes both `mhtRaw` + `mhtImports`, `saveMhtImport` preserved
- `src/styles.css`: PR#9 expanded styles + PR#6 `.drop-zone` / `.import-result`
- `src/app.js`: combined imports; both MHT pipeline and filter/search/stats wiring

## Changed Files (integration branch)
- `src/db.js` — VERSION 3; all stores: raw, staging, failed, mhtRaw, mhtImports; saveMhtImport preserved
- `src/app.js` — full integration: MHT import pipeline + filter/search/stats/history UI + both import paths in render()
- `src/status.js` — deriveStatus/isDeleteEligible updated for MHT schema (state field, provenance.sourceFileHash, validation object)
- `src/styles.css` — PR#9 styles + PR#6 drop-zone classes
- `index.html` — auto-merged: MHT drop zone + capture panel + filter/search + card list + history + stats + info panel
- `test/status.test.js` — 21 tests (status, eligibility, filter, search, stats)
- `docs/handoff/CURRENT.md` — this file

## DB Schema (VERSION 3)
| Store | Added in | Purpose |
|-------|----------|---------|
| raw | v1 | pending capture payloads |
| staging | v1 | validated captures |
| failed | v1 | failed captures |
| mhtRaw | v2 (PR#6) | raw MHT bytes + metadata |
| mhtImports | v2 (both PRs) | parsed MHT candidates |

Upgrade path: fully additive. No existing store deleted or migrated.

## DELETE_ELIGIBLE Integration
- Capture path: rawId → raw store proof
- MHT path: provenance.sourceFileHash → mhtRaw store proof; validation object as validation proof
- `VALIDATED ≠ APPROVED` — no usageAllowed/productionReady set
- `humanReviewRequired` boundary: always true for MHT; preserved in status display

## Related PRs
- PR#6: `codex/mht/mhtml` — MHT foundation (open, base=main)
- PR#9: `copilot/dm-card-collector-development` — collection progress UI (open, base=main)
- PR#10 (this): `copilot/dm-integration` — integrated both (base=main or codex/mht/mhtml)

## Tests
`npm test` → 39 tests, 39 pass, 0 fail
`python3 -m unittest discover -s test -p 'test_*.py'` → 4 tests OK
`node --check` → pass (app.js, core.js, db.js, mht.js, mht-pipeline.js, status.js, sw.js)
`git diff --check` → pass

## Known Limitations
- Playwright UI runtime verification: not run (browser not available in sandbox)
- Real Galaxy device testing: not performed
- PR#6 and PR#9 remain open — user should close/supersede with this integration PR when ready
- MHT cards in `mhtImports` store now included in render() progress summary

## NEXT TASK
Verify this integration branch on a real Galaxy device:
1. Import a real MHT search page → confirm SEARCH_RESULT parsing and card links
2. Import a real MHT card detail page → confirm CARD_DETAIL fields extracted
3. Confirm DELETE_ELIGIBLE status appears after successful import
4. Confirm `humanReviewRequired` is always true and never auto-approved
5. After real-device verification, merge this PR and close PR#6 and PR#9

## Codex / Next Agent Notes
- `status.js` handles both capture-schema (rawId, confidence) and MHT-schema (provenance.sourceFileHash, validation object)
- `db.js` VERSION is now 3; next additive store → VERSION 4
- All MHT imports stored in `mhtImports` with `humanReviewRequired: true`; never auto-approved
- `saveMhtImport` atomically writes to both `mhtRaw` and `mhtImports` in a single transaction
- PR#6 and PR#9 ancestor: both from `b00460c`; this integration branch merges both
