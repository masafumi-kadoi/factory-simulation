# factory-visualizer タスクリスト

## ステータス凡例
- [ ] 未着手
- [~] 検討中・壁打ち中
- [x] 完了

---

## Phase 0: 壁打ち・仕様確定

### 完了済み

- [x] UIレイアウト大枠の確定（イメージ画像ベース）
- [x] URL決定: `/factory-visualizer/`
- [x] テーマ決定: ダークネイビー
- [x] グローバル表示部 / ローカル表示部 の概念定義
- [x] DB統合方針決定: パターンC（factory_stations = scenario_stations）
- [x] 3D表示の詳細仕様（確定: モデル優先順位・スライダー・テーマ切替）

### 残り壁打ち（依存順に実施）

未決定事項は以下の依存関係があるため、上から順番に壁打ちで決める。
下流は上流が確定しないと決められない。

```
DB スキーマ（Phase 1）
    └─ API エンドポイント（Phase 2）
         ├─ リアルタイム更新 WebSocket ペイロード
         ├─ ローカル表示部 保存 API
         └─ シミュレーション実行フロー
              └─ フロントエンド実装（Phase 4）
                   ├─ ツールリボン ボタン詳細
                   ├─ ライトテーマ色
                   ├─ ワーク一覧パネル詳細
                   └─ カメラ吹き出し 3D表現
```

- [x] ステップ1: DB スキーマ最終確認（全バックエンドの基盤）
- [x] ステップ2: API エンドポイント一覧確認（api.js 設計に直結）
- [x] ステップ3: WebSocket ペイロード形式確認（サーバー変更なし、クライアントのlocationMap構築元のみ変更）
- [x] ステップ4: ローカル表示部の保存/API仕様（バッチ保存 PUT /machines/{sid}/logic で確定）
- [x] ステップ5: シミュレーション実行フロー（sim-executor廃止・realtime-gateway統合・simulation-core factory対応で確定）
- [ ] 後回し: ライトテーマ色・カメラ吹き出し等（画面を見ながら調整）

---

## 実装方針

- **Phase 1→2→3→4 の順番で、各 Phase ごとに動作確認してから次へ進む**
- 各 Phase の末尾に API テスト・ブラウザテストを実施
- ブラウザテスト: Chrome リモートデバッグ + Playwright を使用
- 時間をかけても着実に進める（夜間バッチ実行を想定）

---

## Phase 1: DB統合マイグレーション

### 実装
- [x] `015_unified_factory_schema.sql` 作成
  - `factory_stations` に `parent_id` TEXT, `position_z` DOUBLE PRECISION 追加
  - `factory_stations.position_x/y` を REAL → DOUBLE PRECISION に変更
  - `factory_stations.seq_number` DROP
  - `factory_stations` に複合FK `(factory_id, parent_id)` 追加
  - `factory_connections.from/to_port_index` DEFAULT を 0 → -1 に変更
  - `station_type = 'moduler'` の既存データを `'machine'` に UPDATE
  - `scenarios` / `scenario_stations` / `scenario_connections` DROP（既存データは破棄）
  - `execution_configs` に `factory_id UUID REFERENCES factories(id)` 追加、`scenario_id` NOT NULL 解除
- [x] docker-compose.yml に 014 / 015 マイグレーションのマウントを追加

### テスト
- [x] docker compose up でマイグレーション正常完了を確認
- [x] `factory_stations` の新カラム（parent_id, position_z）が存在することを確認
- [x] `scenarios` テーブルが削除されていることを確認
- [x] 既存の factory_stations データが `station_type = 'machine'` になっていることを確認（UPDATE文を確認）

---

## Phase 2: realtime-gateway リファクタリング

### 実装
- [ ] `FactoryStation` 構造体に `ParentID`, `PositionZ` 追加
- [ ] `GET /api/factories/{id}/stations` レスポンスに parent_id, position_z, locationId 追加
- [ ] `POST /api/factories/{id}/stations` に parent_id, position_z 受付追加
- [ ] `station_id` バリデーションパターン緩和（`^[^.]+\..+$`）
- [ ] `PUT /api/factories/{id}/stations/{sid}` 新規実装（ステーション更新）
- [ ] `GET /api/factories/{id}/connections` 新規実装
- [ ] `POST /api/factories/{id}/connections` 新規実装
- [ ] `DELETE /api/factories/{id}/connections/{cid}` 新規実装
- [ ] `PUT /api/factories/{id}/machines/{sid}/logic` 新規実装（バッチ保存）
- [ ] `GET /api/factories/{id}/simdb/locations` 新規実装（sim-executor-backend から移植）
- [ ] `POST /api/factories/{id}/simdb/initial-conditions` 新規実装（同上）
- [ ] `POST /api/factories/{id}/simdb/test-connection` 新規実装（同上）
- [ ] `POST /api/executions` に factoryId 対応追加
- [ ] `/api/scenarios` エンドポイント削除
- [ ] `/api/executor/` 互換レイヤー削除

### テスト
- [ ] `GET /api/factories/{id}/stations` で parent_id, position_z が返ることを確認（curl）
- [ ] `POST /api/factories/{id}/connections` で接続が作成できることを確認
- [ ] `PUT /api/factories/{id}/machines/{sid}/logic` でバッチ保存が動作することを確認
- [ ] `POST /api/factories/{id}/simdb/test-connection` で SimDB 接続テストが動作することを確認
- [ ] Playwright: API エンドポイントの E2E テスト

---

## Phase 3: simulation-core 対応 + sim-executor 廃止

### 実装
- [ ] simulation-core: `/run` に `factoryId` パラメータ追加
- [ ] simulation-core: `factory_stations` + `factory_connections` からシナリオ読み込みに変更
- [ ] simulation-core: Entry/Exit をエイリアス（飾り）として扱う
- [ ] docker-compose.yml から `sim-executor` サービス削除
- [ ] docker-compose.yml から `sim-executor-backend` サービス削除
- [ ] nginx-proxy から sim-executor 関連ルート削除
- [ ] sim-portal から sim-executor リンク削除・factory-visualizer リンク追加

### テスト
- [ ] factoryId を指定してシミュレーション実行が完了することを確認
- [ ] WDH テーブル（item_movement）にデータが書き込まれることを確認
- [ ] WebSocket でリアルタイムイベントが受信できることを確認（Playwright）
- [ ] sim-executor サービスが docker ps に存在しないことを確認

---

## Phase 4: factory-visualizer フロントエンド

### インフラ
- [ ] `factory-visualizer/Dockerfile`（nginx:alpine）
- [ ] `factory-visualizer/nginx.conf`（SPA フォールバック + キャッシュ無効化）
- [ ] docker-compose.yml にサービス追加
- [ ] nginx-proxy に `/factory-visualizer/` ルート追加

### グローバル表示部
- [ ] `index.html` 骨格（メニューバー・ツールリボン・左パネル・3Dビュー・タイムライン）
- [ ] `style.css`（ダークネイビーテーマ、カラーパレット、シーンテーマ切替）
- [ ] `api.js`（全エンドポイント対応）
- [ ] `scene3d.js`（Three.js: machine 3Dモデル表示、テーマ切替、スライダー対応）
- [ ] `ui.js`（左パネル: オブジェクト一覧・表示設定セクション・フローティング情報パネル）
- [ ] `timeline.js`（タイムライン: 過去●現在●未来○、再生コントロール）
- [ ] `panels.js`（AIエージェントパネル: ドラッグ移動・クイックアクション）
- [ ] `app.js`（オーケストレーター: WebSocket購読・状態管理）
- [ ] カメラパネル（UIプレースホルダーのみ）

### ローカル表示部
- [ ] `local-window.js`（別ウィンドウ制御・3タブ切替）
- [ ] モデル情報編集タブ（name・metadata フォーム）
- [ ] 3Dモデル編集タブ（ボクセルグリッドエディタ + GLTF/GLBインポート）
- [ ] ロジック編集タブ（上面視 2D エディタ: ステーション配置・接続線）
- [ ] 「保存して閉じる」ボタン → バッチ保存 API 呼び出し

### テスト
- [ ] Chrome リモートデバッグで `/factory-visualizer/` にアクセスできることを確認
- [ ] 工場一覧が左パネルに表示されることを確認
- [ ] 3D シーンに machine が表示されることを確認
- [ ] WebSocket でリアルタイム更新が 3D シーンに反映されることを確認
- [ ] Machine ダブルクリックでローカル表示部が開くことを確認
- [ ] 「保存して閉じる」でグローバルビューに反映されることを確認
- [ ] シミュレーション実行→WebSocket受信→3D更新の E2E フロー確認（Playwright）
- [ ] ライトテーマ・ダークテーマ・auto 切替が機能することを確認

---

## 後回し事項（Phase 4 完了後に調整）

- ライトテーマの具体的な色調整（画面を見ながら決める）
- ツールリボンのボタン詳細
- ワーク一覧パネルの表示内容詳細
- カメラ吹き出しオブジェクトの 3D 表現詳細
