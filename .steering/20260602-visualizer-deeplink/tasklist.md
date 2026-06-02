# タスクリスト

## フェーズ1: manager側 URL 情報付与

- [x] factory.js:83 View(行) に factoryId/kind を付与
- [x] factory.js:99 Open Viewer(live) に factoryId を付与

## フェーズ2: visualizer ローダのオプション引数化

- [x] selectFactory(factoryId, opts={}) に変更し preferredDsId 伝播・preferredKind で promise 返却
- [x] loadRealtimeData に preferredDsId 追加・527行 選択ロジック変更
- [x] loadSimulationResults に preferredDsId 追加・581行 選択ロジック変更（chosen 化）

## フェーズ3: visualizer 起動ディープリンク

- [x] resolveDataSource(dsId) helper 追加
- [x] DOMContentLoaded にクエリ読取・解決・オーケストレーション追加（try/catchフォールバック含む）
- [x] JS構文チェック（node --check）OK

## フェーズ4: 検証

- [x] docker compose build factory-visualizer sim-factory-manager + up
- [x] /api/data-sources で R(realtime d6be9e93)/S(sim 5c631f0e) id 採取
- [x] Playwright headless で realtime / sim / 逆引き(?ds=のみ) / 不正ds / 無指定 を確認 → 全5ケースPASS（pageerrorゼロ）
- [x] 成果物に __BASE_PREFIX__ 残存なし（空ビルド, grep 0件）
- [x] 検証用一時スクリプトを削除

## フェーズ5: コミット・プッシュ

- [ ] コミット・両リモートへプッシュ

---

## 実装後の振り返り

### 実装完了日
2026-06-02

### 計画と実績の差分

- プラン通り実装。selectFactory/loadRealtimeData/loadSimulationResults へのオプション引数追加と起動オーケストレーションで完了。
- 検証は Playwright headless で window._fvState を直接検査し、5ケース全PASS を機械的に確認（手動ブラウザより確実）。

### 学んだこと

- DataSource は sourceType/factoryId を持つため、ds から逆引きでき API 追加不要だった。
- selectFactory が loadRealtimeData/loadSimulationResults を投げっぱなしにする設計のため、sim モード切替は呼び出し側で promise を await してから適用する必要があった（preferredKind で promise を返す方式で解決）。

### 次回への改善提案

- realtime DS が1件しかない環境だった。複数realtimeがある場合の preferredDsId 選択も今回ロジックでカバー済み。
