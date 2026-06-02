# タスクリスト

## フェーズ1: シナリオ残骸の撤去

- [x] factory.html: Scenarios カード（60-84行付近）を削除
- [x] factory.js: `newScenarioBtn` 取得・href 設定ブロックを削除
- [x] factory.js: `Promise.all` から `loadScenarios()` を除去
- [x] factory.js: `loadScenarios()` 関数定義を削除
- [x] api.js: `listScenarios()` メソッドを削除

## フェーズ2: /visualizer リンク修正

- [x] factory.js:102 `viewerBase = '/visualizer/'` → `'__BASE_PREFIX__/factory-visualizer/'`
- [x] factory.js:128 `viewerBtn.href = '/visualizer/?...'` → `'__BASE_PREFIX__/factory-visualizer/?...'`

## フェーズ3: 検証

- [x] `docker compose build sim-factory-manager` 成功
- [x] 成果物に `/editor`・`scenarios`・単独 `/visualizer/` が残らない（grep 0件）
- [x] 空プレフィックス成果物で `/factory-visualizer/` になる
- [x] index.js の削除確認ダイアログ文言から "scenarios" を除去（実態整合）

## フェーズ4: コミット・プッシュ

- [ ] コミット・両リモートへプッシュ

---

## 実装後の振り返り

### 実装完了日
2026-06-02

### 計画と実績の差分

- 計画通りシナリオ残骸（factory.html カード / factory.js loadScenarios・editorリンク / api.js listScenarios）を撤去。
- `/visualizer/` を `__BASE_PREFIX__/factory-visualizer/` に修正。
- 追加: index.js の削除確認ダイアログ文言「and scenarios」も実態に合わせて除去（計画外の小修正）。

### 学んだこと

- migration 020 のコメントが「廃止＝置換」を明示しており、実体作成ではなく残骸撤去が正解と判断できた。
- `/api/scenarios` ルートはバックエンドに存在せず、フロントのシナリオ機能は完全なデッドコードだった。

### 次回への改善提案

- 機能廃止時はフロント側の参照も同時に撤去すると、こうした残骸リンク切れを防げる。
