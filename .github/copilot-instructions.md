# DM Card Collector — GitHub Copilot Pro Instructions

- Application: **DM Card Collector**.
- Always read and prioritize `AGENTS.md` first.
- Confirm `README.md` scope and constraints before making changes.
- Continue from existing Codex foundation; do not reimplement equivalent features from scratch.
- Do not modify other repositories or unrelated applications.

## Data and safety guardrails
- Never commit real MHT/MHTML source archives to Git.
- Never commit bulk extracted card image datasets to Git.
- Never commit secrets, tokens, or passwords.
- Preserve existing IndexedDB user data; destructive resets are prohibited.
- `deleteDatabase` is prohibited.
- Do not write to Firebase/Firestore/production systems unless explicitly authorized.
- `VALIDATED` is **not** `APPROVED`; keep that separation.
- Preserve the `humanReviewRequired` boundary.

## Git and PR safety
- Do not push directly to `main`.
- Force push is prohibited.
- Auto-merge is prohibited.
- Do not merge without explicit human confirmation.

## Reporting requirements
- Report test/check results honestly.
- Report git branch/HEAD/status honestly.
- State any unverified or unresolved items explicitly.
