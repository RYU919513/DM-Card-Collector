# DM Card Collector — Codex Instructions

## Mission
Build a reliable, local-first collector for Duel Masters card data. Prefer correctness, provenance, reproducibility, and recoverability over speed.

## Before changing anything
1. Confirm this repository is `RYU919513/DM-Card-Collector` and state the current branch/HEAD.
2. Inspect `git status`, relevant files, tests, and package metadata before editing.
3. Establish a recovery point before broad changes (record the starting commit; use a dedicated branch when possible).
4. Never assume files, folders, scripts, or dependencies exist. Check first; create missing project support files when they are genuinely needed.

## Work modes
### Normal implementation
Make the smallest coherent change that fully solves the requested task. Add or update tests for behavior changes.

### Enhanced / autonomous mode ("狂")
When the user invokes the enhanced mode, you may add/delete files, folders, configs, tests, tools, and dependencies when justified. You may choose a better implementation than the initial suggestion. Continue through ordinary implementation obstacles without repeatedly asking for confirmation. However:
- do not leave the app broken;
- do not destroy or silently migrate user IndexedDB data;
- do not write to Firebase/Firestore/production services unless the task explicitly requires and authorizes it;
- keep unrelated applications untouched unless a minimal cross-repo change is absolutely necessary;
- verify the result and preserve a recovery path;
- ephemeral edits are not completion: commit/push/open a PR when the environment permits, and report the real Git state truthfully.

### Investigation-only mode
When the user asks for investigation/research only, do not modify files/config, do not commit, do not push, and do not open a PR. Read, run non-destructive checks/tests, identify evidence and likely cause, and propose a fix.

## Card-data rules
- Official source data is the reference. Never invent card names, numbers, text, rulings, images, or missing fields.
- Preserve provenance: source URL/file, parser/method, timestamps when relevant, and validation state.
- Do not use OCR or generative image reconstruction when original card data or embedded image bytes are available.
- For MHT/MHTML imports, preserve embedded image bytes exactly. Detect image format from MIME/content, not filename suffix alone.
- Card IDs and official detail URLs are preferred stable join keys when available.
- Treat duplicates, conflicts, missing images, malformed archives, and unexpected card counts as explicit validation outcomes rather than silently guessing.

## Safety boundaries
- Never clear IndexedDB/localStorage as a cleanup shortcut.
- Never delete user data to make tests pass.
- Keep capture/import work local-first unless the task explicitly requests a network write.
- Do not add secrets, tokens, credentials, downloaded private data, or generated bulk card-image archives to Git.
- Avoid committing large MHT files or extracted image collections; keep tools/manifests/tests in Git, bulk source/output data outside Git unless explicitly requested.

## Verification
For JavaScript changes, run `npm test` and appropriate `node --check` commands. For MHT tooling, run `python3 -m unittest discover -s test -p 'test_*.py'` and a representative dry/fixture extraction. Inspect `git diff --check` and `git status` before finishing.

## Use project helpers
- `.agents/skills/safe-autonomous-development/SKILL.md` for broad autonomous implementation.
- `.agents/skills/investigation-only/SKILL.md` for strict no-write investigation.
- `.agents/skills/verified-finish/SKILL.md` before declaring completion.
- `.agents/skills/mht-card-extraction/SKILL.md` for MHT/MHTML card extraction.
- Delegate read-heavy investigation/review to project subagents when useful. Keep overlapping write-heavy work serialized to avoid merge conflicts.

## Completion report
State: what changed, tests/checks actually run and their results, any unresolved risks, exact branch/commit/PR state, and anything that could not be pushed or verified. Never claim a push, PR, deployment, or passing test that did not actually occur.
