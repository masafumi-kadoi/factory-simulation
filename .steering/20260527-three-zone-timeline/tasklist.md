# タスクリスト

## 🚨 タスク完全完了の原則

**このファイルの全タスクが完了するまで作業を継続すること**

### 必須ルール
- **全てのタスクを`[x]`にすること**
- 「時間の都合により別タスクとして実施予定」は禁止
- 「実装が複雑すぎるため後回し」は禁止
- 未完了タスク（`[ ]`）を残したまま作業を終了しない

---

## フェーズ1: source_type バグ修正

- [ ] `realtime-gateway/internal/api/handler.go` の `handleFactoryExecutions` を修正
  - [ ] line ~916 の `CreateRealtimeDataSource` 呼び出しを `CreateDataSource("simulation", ...)` に変更
  - [ ] `body.ScenarioID` が空の場合の扱いを確認・対処する
- [ ] 修正後に `docker cp` でコンテナに反映し、ビルド・動作確認
  - [ ] シミュレーション実行後に `data_sources.source_type = 'simulation'` で保存されることをDB確認

## フェーズ2: factory-poller サービス構築

- [ ] `factory-poller/` ディレクトリとプロジェクト初期化
  - [ ] `go mod init factory-poller`
  - [ ] `main.go` 作成（HTTPサーバー起動）
- [ ] `internal/database/db.go` 作成
  - [ ] 内部PostgreSQLへの接続・INSERT関数 (`InsertItemMovements`)
  - [ ] ポーリング開始時に外部DBの `location_master` を取得して内部DBに登録する関数
- [ ] `internal/poller/poller.go` 作成
  - [ ] 外部DBへの接続・`item_movement` ポーリングクエリ
  - [ ] 1秒ティックループ（`time.NewTicker`）
  - [ ] 前回取得時刻管理（`lastPollTime`）
  - [ ] goroutine の開始・停止管理（`context.WithCancel`）
  - [ ] 外部DBロケーションID → 内部DBロケーションID のマッピング変換
- [ ] `internal/api/handler.go` 作成
  - [ ] `POST /poller/start` — Body: `{ factoryId, dbHost, dbPort, dbName, dbUser, dbPass, dataSourceId }`
  - [ ] `POST /poller/stop` — Body: `{ factoryId }`
  - [ ] `GET /poller/status` — Response: `{ running, factoryId, dataSourceId }`
- [ ] `Dockerfile` 作成（マルチステージビルド）

## フェーズ3: realtime-gateway API 拡張

- [ ] poller 制御 API を `handler.go` に追加
  - [ ] `POST /api/factories/{id}/poller/start` — factory-poller に HTTP forward
  - [ ] `POST /api/factories/{id}/poller/stop` — factory-poller に HTTP forward
  - [ ] `GET /api/factories/{id}/poller/status` — factory-poller にプロキシ
  - [ ] `FACTORY_POLLER_URL` 環境変数の読み込み
- [ ] factory 別データソースフィルタリング API 追加
  - [ ] `GET /api/factories/{id}/datasources` を新規実装（`?type=realtime|simulation` クエリパラメータ対応）
  - [ ] `repository.go` に `ListDataSourcesByFactory(factoryID, sourceType string)` を追加

## フェーズ4: docker-compose 更新

- [ ] `docker-compose.yml` に `factory-poller` サービスを追加
  - [ ] `build: context: ./factory-poller`
  - [ ] `environment: PORT=8091, INTERNAL_DB_DSN=...`
  - [ ] `depends_on: [postgres]`
  - [ ] `networks: [factory-net]`（既存ネットワーク名に合わせる）
- [ ] `realtime-gateway` サービスに `FACTORY_POLLER_URL: http://factory-poller:8091` を追加
- [ ] nginx-proxy のルーティングに `factory-poller` の追加が必要か確認（不要なら省略）

## フェーズ5: api.js 拡張

- [ ] `factory-visualizer/html/js/api.js` に以下を追加
  - [ ] `startPoller(factoryId)` → `POST /api/factories/{id}/poller/start`
  - [ ] `stopPoller(factoryId)` → `POST /api/factories/{id}/poller/stop`
  - [ ] `fetchPollerStatus(factoryId)` → `GET /api/factories/{id}/poller/status`
  - [ ] `fetchFactoryDataSources(factoryId, type)` → `GET /api/factories/{id}/datasources?type=...`

## フェーズ6: timeline.js 3ゾーン再設計

- [ ] 既存 `Timeline` クラスを3ゾーン対応に改修
  - [ ] `setNow(nowMs)` メソッド追加（ウィンドウ = nowMs ±24h）
  - [ ] `setRealtimeData(events, range)` メソッド追加
  - [ ] `addSimulationData(events, range, dsId)` メソッド追加
  - [ ] `clearSimulationData()` メソッド追加
  - [ ] 既存の `setExecution()` は後方互換のため残すか廃止するか判断
- [ ] `_draw()` メソッド改修
  - [ ] 左ゾーン背景（青系 `rgba(30,60,120,0.2)`）を描画
  - [ ] 右ゾーン背景（橙系 `rgba(120,60,30,0.2)`）を描画
  - [ ] 中央 NOW 縦線（緑 `#4caf50`）と "NOW" ラベルを描画
  - [ ] 左ゾーンのイベントドット（青）を描画
  - [ ] 右ゾーンのイベントドット（橙）を描画
  - [ ] 現在位置インジケーター（白抜き丸）を描画
  - [ ] 左端・右端の時刻ラベルを描画（"MM/DD HH:mm" 形式）
- [ ] クリック/ドラッグによるシーク処理を 48h ウィンドウに対応させる

## フェーズ7: app.js ポーリング統合・シーク切り替え

- [ ] 工場選択時のポーリング開始処理
  - [ ] `onFactorySelected(factoryId)` でポーリング開始 API 呼び出し
  - [ ] リアルタイムデータソース（`source_type='realtime'`）を取得
  - [ ] 過去 24h のイベントを取得して `timeline.setRealtimeData()` に設定
  - [ ] WebSocket を realtime data_source に購読
- [ ] シーク時のデータソース切り替えロジック
  - [ ] `onSeek(ms)` で `ms <= Date.now()` なら realtimeEvents を使う
  - [ ] `ms > Date.now()` なら simEvents を使う
  - [ ] それぞれ別の `layout`（location_master）を参照する
- [ ] `state` オブジェクトに以下を追加
  - [ ] `state.realtimeDataSourceId`
  - [ ] `state.realtimeEvents` / `state.realtimeLayout`
  - [ ] `state.simDataSourceId`
  - [ ] `state.simEvents` / `state.simLayout`
- [ ] 工場選択解除時のクリーンアップ（ポーリング停止・データリセット）

## フェーズ8: シミュレーションスケジューリングUI

- [ ] HTML パネルの追加 (`factory-visualizer/html/index.html` または `app.js` で動的生成)
  - [ ] 開始日時ピッカー（`<input type="datetime-local">`）
  - [ ] 実行時間フィールド（時間単位）
  - [ ] 「今すぐ実行」ボタン
  - [ ] 「スケジュール登録」ボタン（UIのみ、実際のcronなし）
- [ ] 実行履歴パネル
  - [ ] `fetchFactoryExecutions(factoryId)` で履歴一覧取得
  - [ ] 一覧をリスト表示（実行日時・時間・ステータス）
  - [ ] クリックで右ゾーンにシミュレーション結果を反映
- [ ] 実行完了後に右ゾーンへの自動反映
  - [ ] `loadSimulationResult()` 実行後に `timeline.addSimulationData()` を呼ぶ
- [ ] 既存の「実行する」ボタンとの統合（または廃止・置き換え）

## フェーズ9: コンテナビルド・デプロイ・動作確認

- [ ] `docker compose build --no-cache factory-poller` でビルド確認
- [ ] `docker compose build --no-cache realtime-gateway` でビルド確認
- [ ] `docker compose up -d` で起動
- [ ] `docker cp` で factory-visualizer の JS ファイルをコンテナへコピー
- [ ] 動作確認
  - [ ] Test Factory を選択 → ポーラーが起動し左ゾーンにイベントが表示される
  - [ ] タイムラインを左ゾーンでシーク → ワーク位置が変化する
  - [ ] シミュレーションを任意の日時で実行 → 右ゾーンに結果が表示される
  - [ ] 右ゾーンをシーク → シミュレーション結果のワーク位置が変化する
  - [ ] 実行の `data_sources.source_type = 'simulation'` を DB 確認

---

## 実装後の振り返り

### 実装完了日
{YYYY-MM-DD}

### 計画と実績の差分

**計画と異なった点**:
- {計画時には想定していなかった技術的な変更点}

**新たに必要になったタスク**:
- {実装中に追加したタスク}

**技術的理由でスキップしたタスク**（該当する場合のみ）:
- {タスク名}
  - スキップ理由: {具体的な技術的理由}
  - 代替実装: {何に置き換わったか}

### 学んだこと

**技術的な学び**:
- {実装を通じて学んだ技術的な知見}

**プロセス上の改善点**:
- {タスク管理で良かった点}

### 次回への改善提案
- {次回の機能追加で気をつけること}
