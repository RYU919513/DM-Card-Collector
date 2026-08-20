# Codex → GitHub Copilot Pro 引き継ぎ記録

このファイルは Codex が作業を完了するたびに更新します。
GitHub Copilot Pro は作業開始前に必ずこのファイルを確認してください。

---

## APPLICATION

**DM Card Collector**
Repository: `RYU919513/DM-Card-Collector`

---

## BASE BRANCH

`codex/mht/mhtml`

---

## CURRENT HEAD

`80dadc0` — feat: add safe offline MHT import foundation

---

## RELATED PR

PR #6 相当（`codex/mht/mhtml` branch）— open / do not merge / do not close / do not force-push

---

## LAST COMPLETED TASK

**Codex → GitHub Copilot Pro 引き継ぎ基盤の整備**

- `.github/copilot-instructions.md` 新規作成
- `docs/handoff/CURRENT.md` 新規作成（本ファイル）
- テスト全 18 件 pass を確認

---

## CHANGED FILES

```
.github/copilot-instructions.md   (新規)
docs/handoff/CURRENT.md           (新規)
```

---

## TEST RESULTS

```
npm test
# tests 18 / pass 18 / fail 0
```

実行コマンド:
```sh
npm test
node --check src/app.js && node --check src/core.js && node --check src/db.js && node --check sw.js
```

---

## KNOWN LIMITATIONS

- MHT パーサーは `dm.takaratomy.co.jp` の HTML 構造を前提とする正規表現ベース。サイト側の DOM 変更があれば再調整が必要。
- `humanReviewRequired: true` は常に `true` 固定であり、UI 上でのレビュー・承認フローは未実装（次フェーズ予定）。
- カード画像は URL のみ保存。実際の画像バイナリの local/offline キャッシュは未実装。
- ページ番号の自動補完・欠落ページ検知は `collectionProgress()` が提供するが、UI への統合は部分的。

---

## DO NOT TOUCH

- `src/mht.js` — MHT バイナリパーサー本体（動作確認済み）
- `src/mht-pipeline.js` — パイプライン・バリデーション・enrichCandidate（動作確認済み）
- `src/db.js` — IndexedDB ストア定義（`mhtRaw`, `mhtImports` 含む）
- `sw.js` — Service Worker（PWA offline shell）
- DUELIX CFL 本体
- DM Safe Admin
- PR #6 相当の open PR（merge / close / force-push / rebase / delete 禁止）

---

## NEXT TASK

**MHT import の UI レビューフローを実装する**

具体的には：
1. `mhtImports` ストアから `humanReviewRequired: true` のレコードを取得して一覧表示
2. ユーザーが各カード候補を確認し「承認 (APPROVED)」または「却下 (REJECTED)」を選択できる UI
3. 承認済みレコードを `staging` ストアへ移動する処理
4. `VALIDATED` と `APPROVED` は別状態として明示する

ブランチ: `codex/mht/mhtml` から新規フィーチャーブランチを切って作業すること。

---

## GITHUB STATE

| 項目 | 値 |
|------|----|
| Branch | `copilot/codexmhtmhtml` |
| HEAD | `80dadc0` |
| Tests | 18 pass / 0 fail |
| PR | open（do not merge without human review） |

---

## CODEX → GITHUB COPILOT HANDOFF

このセクションを更新するたびに以下のステータスを記録する:

```
【APPLICATION：DM Card Collector / CONFIRMED】
【BASE BRANCH：codex/mht/mhtml / ACTIVE】
【CODEX FOUNDATION：VERIFIED】
【COPILOT INSTRUCTIONS：READY】
【HANDOFF：READY】
【REAL MHT COMMITTED：NO】
【INDEXEDDB SAFETY：PRESERVED】
【HUMAN REVIEW BOUNDARY：PRESERVED】
【GIT SAFETY：PASS】
【CODEX → GITHUB COPILOT HANDOFF：READY】
```
