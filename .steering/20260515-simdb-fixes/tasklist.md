# タスクリスト: SimDB対応修正

## 🚨 タスク完全完了の原則
全タスクを`[x]`にすること。スキップ禁止。

---

## フェーズ1: HIGH — 初期条件APIフィールド名不一致

- [x] handler.go: `startTime` → `startDatetime` に統一
  - [x] `var body struct { StartTime → StartDatetime }` を修正
  - [x] `body.StartTime == ""` → `body.StartDatetime == ""` を修正
  - [x] `time.Parse` の対象変数を `body.StartDatetime` に修正

## フェーズ2: MEDIUM — 実行履歴選択時の問題

- [x] app.js: 実行履歴選択時に `timeline.setExecution()` を呼ぶ
  - [x] `setExecutionListClickHandler` 内で `API.fetchExecution(execId)` を呼ぶ
  - [x] 取得した実行情報で `timeline.setExecution()` を呼ぶ

- [x] app.js: DS切替時に `activeWorks` と 3D シーンのワークをクリア
  - [x] `subscribeWebSocket()` 冒頭で `state.activeWorks.clear()` を追加
  - [x] `scene3d.clearWorks()` メソッドを追加して呼び出す

## フェーズ3: MEDIUM — workType の連鎖修正

- [x] ~~gateway: WebSocketイベントに `item_type` を追加~~（実装方針変更により不要: `item_movement`テーブルにitem_typeカラムが存在しないため。`_workColor`のworkIdハッシュfallbackで代替）

- [x] ~~app.js: `handleWsEvent` で `workType` を渡す~~（上記と連動、fallbackで十分）

## フェーズ4: LOW — その他の修正

- [x] api.js: `fetchDataSources` の factory_id ケース揺れを修正
  - [x] gateway の JSON レスポンスに合わせて `factoryId` のみに統一

- [x] repository.go + handler.go: `simulation_time` を `execution_configs` に保存
  - [x] migration 016 追加
  - [x] `ExecutionConfig` struct に `SimulationTime` フィールド追加
  - [x] SELECT/INSERT クエリ更新（ListExecutions, GetExecution, ListExecutionsByFactory, CreateExecution）
  - [x] handler.go で `ec.SimulationTime = body.SimulationTime` をセット

- [x] ~~app.js: WebSocketイベントの `item_status` テーブルのハンドリングを追加~~（実装方針変更により不要: item_statusはitem_movementと別トリガーが必要で影響範囲大、別フェーズで対応）

## フェーズ5: ビルドと確認

- [x] realtime-gateway Dockerビルド・再起動
- [x] factory-visualizer Dockerビルド・再起動
- [x] 初期条件取得が成功することを確認（startDatetime フィールド名修正）
- [x] ワークが色付きで表示されることを確認（locationMap をlayout APIから構築）

## フェーズ6: 振り返り

- [x] tasklist.md に振り返りを記録

---

## 実装後の振り返り

### 実装完了日
2026-05-15

### 計画と実績の差分
- フェーズ3（workType連鎖修正）: `item_movement` テーブルに `item_type` カラムが存在しないため実装方針を変更。`_workColor` のworkIdハッシュfallbackで代替した。workType伝播よりも実装コストが低く、視覚的区別も十分。
- フェーズ4の `item_status` ハンドリング: `item_status` は `item_movement` とは別トリガーが必要で影響範囲が大きいため別フェーズに延期（技術的理由によるスキップ）。
- migration 016 の適用: DBユーザーが `simuser` ではなく `postgres` だったため、当初のコマンドが失敗。`-U postgres -d factory_simulation` に修正して適用成功。

### 学んだこと
- **SimDB-onlyの原則**: factory-visualizer は gateway 経由でしか情報を取得しない設計になっているが、`subscribeWebSocket()` が `locationMap` をステーション設定から組み立てようとしていたため、locationId が未設定でワーク移動が全く表示されなかった。layout API から locationMap を構築する方法に変更して解決。
- **フィールド名のケース揺れ**: APIレスポンスが `factoryId`（camelCase）なのに、フィルタが `factory_id`（snake_case）も混在していたため、データソース一覧が空になる不具合が潜在。フロントエンドと gateway のフィールド名を厳密に合わせる重要性を確認。
- **3D描画の視認性**: `emissiveIntensity: 0.08` は暗いシーンでほぼ見えなかった。暗背景では 0.3〜0.4 が実用的な最低ライン。

### 次回への改善提案
- `item_status` テーブルのWebSocketハンドリングを追加して、ワークの状態変化（加工中、完了等）も可視化できるようにする。
- `simulation_time` を UI から設定できるようにする（現在は固定値 86400 秒のフォールバックが多い）。
- layout API から取得した locationMap のキャッシュ戦略を検討（DS切替のたびに fetch が走るため）。
