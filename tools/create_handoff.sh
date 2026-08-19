#!/usr/bin/env bash
set -euo pipefail
ROOT=$(git rev-parse --show-toplevel)
HEAD=$(git -C "$ROOT" rev-parse HEAD)
OUT=${1:-"$ROOT/../DM-Card-Collector-handoff-$HEAD"}
ARCHIVE="$OUT.tar.gz"
case "$(realpath -m "$OUT")" in "$ROOT"|"$ROOT"/*) echo "handoff output must be outside the repository" >&2; exit 2;; esac
if [[ -e "$OUT" || -e "$ARCHIVE" ]]; then echo "refusing to overwrite existing handoff output: $OUT" >&2; exit 2; fi
mkdir -p "$OUT"
git -C "$ROOT" bundle create "$OUT/source.bundle" HEAD
cat >"$OUT/manifest.json" <<EOF
{"application":"DM Card Collector","artifactType":"source-code-handoff","commit":"$HEAD","branch":"$(git -C "$ROOT" branch --show-current)","schemaVersion":1,"cardDataIncluded":false,"productionWrites":false}
EOF
cat >"$OUT/RESTORE.md" <<EOF
# Restore
1. \`sha256sum -c SHA256SUMS.txt\`
2. \`git bundle verify source.bundle\`
3. \`git clone source.bundle restored\`
4. \`cd restored && npm test && git fsck --full\`
5. Confirm restored HEAD matches the commit in \`manifest.json\`.
6. Card-data exports are separate artifacts and are intentionally not included.
EOF
(cd "$ROOT" && npm test >"$OUT/TEST_REPORT.md" 2>&1)
git -C "$ROOT" bundle verify "$OUT/source.bundle" >"$OUT/BUNDLE_VERIFY.txt" 2>&1
RESTORE=$(mktemp -d)
trap 'rm -rf "$RESTORE"' EXIT
git clone -q "$OUT/source.bundle" "$RESTORE/repo"
test "$(git -C "$RESTORE/repo" rev-parse HEAD)" = "$HEAD"
(cd "$RESTORE/repo" && npm test >"$OUT/RESTORED_TEST_REPORT.md" 2>&1 && git fsck --full >"$OUT/GIT_FSCK.txt" 2>&1)
(cd "$OUT" && sha256sum source.bundle manifest.json TEST_REPORT.md RESTORE.md BUNDLE_VERIFY.txt RESTORED_TEST_REPORT.md GIT_FSCK.txt >SHA256SUMS.txt)
(cd "$OUT" && sha256sum -c SHA256SUMS.txt >CHECKSUM_VERIFY.txt)
tar -C "$(dirname "$OUT")" -czf "$ARCHIVE" "$(basename "$OUT")"
test -s "$ARCHIVE"
printf '%s\n' "$ARCHIVE"
