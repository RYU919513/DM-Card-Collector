---
name: safe-autonomous-development
description: Use for broad implementation work or when the user invokes the enhanced autonomous (狂) mode.
---

# Safe Autonomous Development

1. Confirm the target repository/app and inspect branch, HEAD, status, project files, tests, and runtime prerequisites.
2. Record the starting commit as the recovery baseline. Work on a dedicated branch when possible.
3. Build an evidence-based plan. Use the `investigator` subagent for read-heavy uncertainty and the `reviewer` before finalizing substantial changes.
4. Implement autonomously. You may create/remove files, folders, configs, tests, tools, or dependencies when justified. Missing support files are not a reason to stop.
5. Keep scope coherent. Do not touch another application unless the current task truly requires a minimal cross-repo compatibility change.
6. Protect data: no destructive IndexedDB/localStorage cleanup, no production/Firebase/Firestore writes unless explicitly authorized, no secrets in Git.
7. Prefer deterministic, reversible migrations/imports. Preserve provenance and make failures visible rather than guessing.
8. Run the strongest relevant tests/checks available. Add tests for changed behavior. Run `git diff --check` and inspect final status/diff.
9. Do not stop at code that exists only in an ephemeral workspace. Commit, push, and open/update a PR when credentials/environment allow it. If not possible, preserve the branch/commit if possible and report exactly what remains local.
10. Finish with factual status: files changed, verification run/results, known risks, branch/commit/PR/deployment state. Never report actions that did not happen.
