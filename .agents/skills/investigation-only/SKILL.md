---
name: investigation-only
description: Use when the user asks Codex to investigate, diagnose, research, or verify without making changes.
---

# Investigation Only

This mode is strictly read-only.

- Do not edit/create/delete files or configuration.
- Do not commit, push, open/update PRs, or change branches/refs.
- Do not mutate IndexedDB, localStorage, Firebase, Firestore, production data, or external services.
- You may inspect files/history/logs and run non-destructive tests, linters, syntax checks, parsers, and reproducibility commands.
- Separate observed evidence from hypotheses.
- Report: reproduction/result, likely root cause, affected scope, confidence/unknowns, and the smallest safe fix plus verification plan.
- If evidence is insufficient, say what additional artifact/test would resolve it; do not fill gaps by guessing.
