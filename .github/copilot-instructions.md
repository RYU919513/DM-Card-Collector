# GitHub Copilot Pro — DM Card Collector 開発ガイドライン

## Application

**DM Card Collector** (`RYU919513/DM-Card-Collector`)

---

## 最優先ルール

1. **AGENTS.md を最優先で尊重する。** 変更前に必ず読むこと。
2. **README.md を確認してから変更する。** アーキテクチャ・設計意図を理解してから手を動かす。
3. **Codex 成果を引き継ぐ。** このリポジトリには Codex が実装した基盤が存在する。
   - PWA / Service Worker / Web Share Target / bookmarklet capture
   - capture/import flow
   - MHT/MHTML Reader (MIME parsing, binary-safe)
   - SEARCH_RESULT / CARD_DETAIL classification
   - raw preservation / provenance / validation
   - duplicate/conflict detection
   - IndexedDB stores: `raw`, `staging`, `failed`, `mhtRaw`, `mhtImports`
   - `humanReviewRequired` 境界
4. **既存機能を重複実装しない。** `src/mht.js`, `src/mht-pipeline.js`, `src/db.js` に既にある処理は再実装しない。

---

## データ・コミット禁止事項

| 禁止 | 理由 |
|------|------|
| MHT / MHTML 原本を Git にコミット | 大容量・個人情報・著作権リスク |
| 大量の画像ファイルを Git にコミット | リポジトリ肥大化 |
| secret / token / password / API key をコミット | セキュリティ |
| IndexedDB の既存データを削除・破壊 | ユーザーデータ保護 |
| `indexedDB.deleteDatabase()` の使用 | ユーザーデータ保護 |
| Firebase / Firestore / production サービスへの無断書き込み | データ安全 |

---

## 論理的安全境界

- **`VALIDATED` ≠ `APPROVED`**: バリデーション通過はヒューマンレビュー承認を意味しない。
- **`humanReviewRequired: true` を常に維持する。** バリデーション結果に関わらず、import 候補は必ず人間確認が必要。
- **`state` の遷移は `mht-pipeline.js` の定義に従う。** 勝手に `APPROVED` に変更しない。

---

## Git 安全ルール

- **`main` への直接 push 禁止**
- **force push 禁止** (`git push --force` / `--force-with-lease` 含む)
- **auto merge 禁止**
- **人間確認なしの merge 禁止**
- すべての変更は PR を通じてレビューを受けること

---

## 他リポジトリ禁止

- **このリポジトリ以外を変更しない。**
- DUELIX CFL 本体・DM Safe Admin には手を触れない。

---

## 報告義務

作業完了時に必ず以下を正直に報告すること:

1. 実際に変更したファイル一覧
2. 実行したテストコマンドとその結果 (pass/fail 数)
3. `git status` / `git diff --check` の出力
4. push / PR の実際の状態 (成功・失敗・未実施)
5. 解決できなかった問題・既知の制限

**発生していないテスト合格・push・PR 作成を報告してはならない。**

---

## 参照ドキュメント

- `AGENTS.md` — エージェント向け詳細ガイドライン
- `README.md` — アプリケーション概要
- `docs/handoff/CURRENT.md` — Codex→Copilot 引き継ぎ記録
- `.agents/skills/` — 専用スキル定義
