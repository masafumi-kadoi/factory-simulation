# タスクリスト: Visualizerリアルタイム機能拡張

## ステータス凡例
- [ ] 未着手
- [~] 進行中
- [x] 完了

---

## Phase 0: 仕様確定

- [x] 要求定義（requirements.md）
- [x] 設計（design.md）
- [x] 未解決事項の確認・決定
  - [x] sim-executor-backendの扱い → Gatewayに統合、サービス廃止
  - [x] CSVインポート/バリデーション詳細 → 全件ロールバック + SimDB突合
  - [x] バッファコンベアテンプレートUI → PUSH/PULL選択、パラメータ入力→自動生成
  - [x] simulation-coreスケーリング → ステートレス設計、将来Queue化対応

---

## Phase 1: データベース再構築（破壊的変更）

### 1.1 既存テーブル廃止
- [x] simulation_runsテーブル削除
- [x] work_eventsテーブル削除
- [x] station_status_logsテーブル削除
- [x] work_lineageテーブル削除

### 1.2 管理テーブル作成
- [x] factoriesテーブル作成
- [x] factory_stationsテーブル作成
- [x] factory_connectionsテーブル作成
- [x] data_sourcesテーブル作成
- [x] scenariosにfactory_id / scenario_type カラム追加
- [x] scenario_stationsにoverride_typeカラム追加
- [x] execution_configsのsimulation_id → data_source_id変更

### 1.3 WDHテーブル作成（data_source_id付き統合版）
- [x] location_master作成
- [x] connection_master作成
- [x] machine_master作成
- [x] item_master作成
- [x] item_movement作成（パーティション対応）
- [x] item_lineage作成（パーティション対応）
- [x] item_status作成（パーティション対応）
- [x] item_expiry作成
- [x] machine_signal作成（パーティション対応）
- [x] machine_status作成（パーティション対応）
- [x] system_error作成

### 1.4 パーティショニング・インデックス・トリガー
- [x] 月次パーティション初期作成（item_movement, machine_signal等）
- [x] 複合インデックス設定（data_source_id + event_time）
- [x] NOTIFYトリガー設置（item_movement, machine_signal）

---

## Phase 2: nginx-proxy新規追加（HTTPS対応）

- [x] nginx-proxyディレクトリ・Dockerfile作成
- [x] 自己署名証明書の自動生成スクリプト（SAN: localhost, 127.0.0.1, factory-sim.local）
- [x] Nginx設定: TLS (443 ssl, 80→443リダイレクト)
- [x] Nginx設定: パスルーティング（/portal/, /visualizer/, /editor/, /executor/, /factory/, /api/, /ws）
- [x] Nginx設定: WebSocketプロキシ（Upgrade/Connection/proxy_read_timeout）
- [x] sim-portalからプロキシ機能を削除（静的HTML配信専用化）
- [x] 各フロントエンドサービスのNginxからAPIプロキシ設定を削除
- [x] docker-compose.yml更新（nginx-proxy追加、外部ポートは443/80のみ）
- [x] 各フロントエンドのAPIベースURLを `/api/` 相対パスに統一

---

## Phase 3: Realtime Gateway 新規開発

### 3.1 基盤
- [x] プロジェクト構成作成（Go, Docker対応）
- [x] PostgreSQL接続プール実装
- [x] LISTEN/NOTIFY受信実装
- [x] WebSocket fan-out実装（goroutine + sync.Map）
- [x] docker-compose.ymlへの追加

### 3.2 REST API: Factory管理
- [x] GET/POST /api/factories
- [x] GET/PUT /api/factories/{id}
- [x] GET/POST /api/factories/{id}/stations
- [x] POST /api/factories/{id}/stations/import-csv（バリデーション含む）
- [x] POST /api/factories/{id}/validate（SimDB突合）

### 3.3 REST API: シナリオ管理
- [x] GET/POST /api/scenarios
- [x] GET/PUT /api/scenarios/{id}

### 3.4 REST API: データソース管理
- [x] GET/POST /api/data-sources
- [x] GET/PATCH /api/data-sources/{id}
- [x] GET /api/data-sources/{id}/events（from/to クエリ）
- [x] GET /api/data-sources/{id}/layout（location_master/connection_master）

### 3.5 REST API: シミュレーション実行（旧sim-executor-backend統合）
- [x] POST /api/executions（simulation-coreへ転送）
- [x] GET /api/executions
- [x] GET /api/executions/{id}
- [x] DELETE /api/executions/{id}

### 3.6 WebSocket
- [x] WS /ws/live エンドポイント実装
- [x] subscribe/unsubscribe メッセージ処理
- [x] heartbeat送信（時刻同期用）
- [x] NOTIFY→WebSocketブロードキャスト

### 3.7 サービス廃止
- [x] sim-executor-backendサービス削除
- [x] docker-compose.ymlからsim-executor-backend除去

---

## Phase 4: Visualizer 機能拡張

### 4.1 データ供給レイヤー
- [~] Event Buffer実装（容量上限200MB、スライディングウィンドウ）※簡易実装
- [x] REST クライアント（バルク取得、fetchEvents API）
- [x] WebSocket クライアント（subscribe/unsubscribe/heartbeat）
- [ ] バッファ範囲外シーク時のローディング表示

### 4.2 表示モード
- [x] Replay/Live/LiveLost モード状態管理
- [x] Liveモード: 最新時刻への追従ロジック
- [x] LiveLost: exponential backoff自動リトライ
- [ ] 再接続時gap埋め（REST取得）
- [ ] シークバー操作でLive解除

### 4.3 UIコントロール
- [x] LIVEボタン
- [x] データソース一覧表示
- [ ] 2レイヤー切替UI
- [ ] シークバー拡張（バッファ範囲表示）

### 4.4 描画エンジン拡張
- [x] State Builder: WDH item_movement形式対応（wdhEventToInternal）
- [x] レイアウト取得: /api/data-sources/{id}/layout から location_master読込

---

## Phase 5: バッファコンベア対応

### 5.1 シミュレーションエンジン
- [~] bufferCapacity属性（既存Modulerで代替可能）

### 5.2 シナリオエディタ
- [x] バッファコンベア追加ダイアログ実装
- [x] PUSH/PULL搬送方式選択UI
- [x] テンプレート自動生成ロジック（Moduler + N個のスロット + 接続）
- [~] 生成後のスロット数変更UI（Moduler properties経由で可能）

### 5.3 Visualizer
- [x] 色グラデーション（空=緑→満=赤）
- [ ] コンベア外観表示: ゲージバー + 数値 + ドットアニメーション（次フェーズ）
- [ ] LOD切替（ズームレベルに応じた表示簡略化）

---

## Phase 6: Factory管理画面 新規開発

- [x] プロジェクト構成作成（HTML/JS, Nginx, Docker対応）
- [x] Factory一覧画面
- [x] Factory詳細画面（ステーション一覧表示）
- [x] ステーション定義GUI（追加/編集/削除）
- [x] CSVインポート画面（プレビュー + エラー表示）
- [x] SimDBバリデーション画面（結果表示）
- [x] 監視セッション開始/停止UI
- [~] シナリオ一覧・新規作成UI（sim-editorへの遷移リンク）
- [x] Viewerへの遷移（Liveモード自動起動）
- [x] docker-compose.ymlへの追加
- [x] sim-portalへのリンク追加

---

## Phase 7: simulation-core リファクタリング

- [x] 内部HTTP API整理（Gatewayからの実行リクエスト受付のみ /run）
- [x] シミュレーション実行時のbaseTime（start_datetime）パラメータ追加
- [x] 結果をWDHテーブル（item_movement等）にTIMESTAMPTZ形式でINSERT（DirectWriter）
- [x] data_source_id付きでINSERTする対応
- [x] シナリオ解決 → location_master/connection_master/machine_masterスナップショット生成
- [x] ステートレス設計（データソースIDで論理分離）

---

## 依存関係・実行順序

```
Phase 1 (DB) → Phase 2 (nginx-proxy) → Phase 3 (Gateway) → Phase 4〜7 (並行可能)

Phase 4 (Visualizer)    ← Phase 3完了後
Phase 5 (バッファ)      ← Phase 3, 7完了後
Phase 6 (Factory管理)   ← Phase 3完了後
Phase 7 (sim-core)      ← Phase 3完了後
```
