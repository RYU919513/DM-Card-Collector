---
name: verified-finish
description: Use before declaring implementation complete, especially after autonomous or multi-file work.
---

# Verified Finish

Before saying the task is done:

1. Re-read the user request and `AGENTS.md`; confirm all acceptance criteria are covered.
2. Inspect `git diff`, `git status`, and unexpected generated/untracked files.
3. Run relevant tests and syntax/static checks. For this repo normally run `npm test`, JS syntax checks, and Python MHT-tool tests when applicable.
4. Run `git diff --check`.
5. Check for accidental secrets, bulk source archives/images, production endpoints/writes, destructive storage operations, debug code, and unrelated changes.
6. For data tooling, verify deterministic output, provenance, duplicate/missing/error reporting, and preservation of original bytes.
7. If a reviewer subagent is available, use it for substantial changes and address blocking findings.
8. Confirm the real Git state: branch, commit, pushed/not pushed, PR number/status, and CI if available.
9. Report failures and residual risks explicitly. Never convert 'not run' into 'passed'.
