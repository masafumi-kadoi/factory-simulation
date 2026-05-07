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
- [ ] simulation_runsテーブル削除
- [ ] work_eventsテーブル削除
- [ ] station_status_logsテーブル削除
- [ ] work_lineageテーブル削除

### 1.2 管理テーブル作成
- [ ] factoriesテーブル作成
- [ ] factory_stationsテーブル作成
- [ ] factory_connectionsテーブル作成
- [ ] data_sourcesテーブル作成
- [ ] scenariosにfactory_id / scenario_type カラム追加
- [ ] scenario_stationsにoverride_typeカラム追加
- [ ] execution_configsのsimulation_id → data_source_id変更

### 1.3 WDHテーブル作成（data_source_id付き統合版）
- [ ] location_master作成
- [ ] connection_master作成
- [ ] machine_master作成
- [ ] item_master作成
- [ ] item_movement作成（パーティション対応）
- [ ] item_lineage作成（パーティション対応）
- [ ] item_status作成（パーティション対応）
- [ ] item_expiry作成
- [ ] machine_signal作成（パーティション対応）
- [ ] machine_status作成（パーティション対応）
- [ ] system_error作成

### 1.4 パーティショニング・インデックス・トリガー
- [ ] 月次パーティション初期作成（item_movement, machine_signal等）
- [ ] 複合インデックス設定（data_source_id + event_time）
- [ ] NOTIFYトリガー設置（item_movement, machine_signal）

---

## Phase 2: nginx-proxy新規追加（HTTPS対応）

- [ ] nginx-proxyディレクトリ・Dockerfile作成
- [ ] 自己署名証明書の自動生成スクリプト（SAN: localhost, 127.0.0.1, factory-sim.local）
- [ ] Nginx設定: TLS (443 ssl, 80→443リダイレクト)
- [ ] Nginx設定: パスルーティング（/portal/, /visualizer/, /editor/, /executor/, /factory/, /api/, /ws）
- [ ] Nginx設定: WebSocketプロキシ（Upgrade/Connection/proxy_read_timeout）
- [ ] sim-portalからプロキシ機能を削除（静的HTML配信専用化）
- [ ] 各フロントエンドサービスのNginxからAPIプロキシ設定を削除
- [ ] docker-compose.yml更新（nginx-proxy追加、外部ポートは443/80のみ）
- [ ] 各フロントエンドのAPIベースURLを `/api/` 相対パスに統一

---

## Phase 3: Realtime Gateway 新規開発

### 3.1 基盤
- [ ] プロジェクト構成作成（Go, Docker対応）
- [ ] PostgreSQL接続プール実装
- [ ] LISTEN/NOTIFY受信実装
- [ ] WebSocket fan-out実装（goroutine + sync.Map）
- [ ] docker-compose.ymlへの追加

### 3.2 REST API: Factory管理
- [ ] GET/POST /api/factories
- [ ] GET/PUT /api/factories/{id}
- [ ] GET /api/factories/{id}/stations
- [ ] POST /api/factories/{id}/stations/import-csv（バリデーション含む）
- [ ] POST /api/factories/{id}/validate（SimDB突合）

### 3.3 REST API: シナリオ管理
- [ ] GET/POST /api/scenarios
- [ ] GET/PUT /api/scenarios/{id}（Factory継承解決ロジック含む）

### 3.4 REST API: データソース管理
- [ ] GET/POST /api/data-sources
- [ ] GET/PATCH /api/data-sources/{id}
- [ ] GET /api/data-sources/{id}/events（from/to クエリ）
- [ ] GET /api/data-sources/{id}/layout（location_master/connection_master）

### 3.5 REST API: シミュレーション実行（旧sim-executor-backend統合）
- [ ] POST /api/executions（simulation-coreへ転送）
- [ ] GET /api/executions
- [ ] GET /api/executions/{id}
- [ ] DELETE /api/executions/{id}

### 3.6 WebSocket
- [ ] WS /ws/live エンドポイント実装
- [ ] subscribe/unsubscribe メッセージ処理
- [ ] heartbeat送信（時刻同期用）
- [ ] NOTIFY→WebSocketブロードキャスト

### 3.7 サービス廃止
- [ ] sim-executor-backendサービス削除
- [ ] docker-compose.ymlからsim-executor-backend除去

---

## Phase 4: Visualizer 機能拡張

### 4.1 データ供給レイヤー
- [ ] Event Buffer実装（容量上限200MB、スライディングウィンドウ）
- [ ] REST クライアント（バルク取得、シーク時のローディング）
- [ ] WebSocket クライアント（subscribe/unsubscribe/heartbeat）
- [ ] バッファ範囲外シーク時のローディング表示

### 4.2 表示モード
- [ ] Replay/Live/LiveLost モード状態管理
- [ ] Liveモード: 最新時刻への追従ロジック
- [ ] LiveLost: グレーアウト表示 + 自動リトライ（exponential backoff）
- [ ] 再接続時gap埋め（REST取得）
- [ ] シークバー操作でLive解除

### 4.3 UIコントロール
- [ ] 2レイヤー切替UI（実工場チェックボックス + シミュレーション プルダウン）
- [ ] LIVEボタン
- [ ] シークバー拡張（2レイヤー対応、バッファ範囲表示）
- [ ] Liveモード時のシークバー中央固定
- [ ] 色・透明度設定UI（各レイヤー）

### 4.4 描画エンジン拡張
- [ ] State Builder: event_time → 状態変換ロジック（WDH item_movement形式対応）
- [ ] 2レイヤー同時描画（色+透明度で区別）
- [ ] レイアウト取得: /api/data-sources/{id}/layout から location_master読込

---

## Phase 5: バッファコンベア対応

### 5.1 シミュレーションエンジン
- [ ] bufferCapacity属性の廃止
- [ ] PUSH/PULLインターロック条件の設定対応確認

### 5.2 シナリオエディタ
- [ ] バッファコンベア追加ダイアログ実装
- [ ] PUSH/PULL搬送方式選択UI
- [ ] テンプレート自動生成ロジック（Moduler + N個のスロット + 接続）
- [ ] 生成後のスロット数変更UI

### 5.3 Visualizer
- [ ] コンベア外観表示: ゲージバー + 数値 + ドットアニメーション
- [ ] 色グラデーション（空=緑→満=赤）
- [ ] LOD切替（ズームレベルに応じた表示簡略化）
- [ ] Moduler展開: 内部スロットの流れアニメーション

---

## Phase 6: Factory管理画面 新規開発

- [ ] プロジェクト構成作成（HTML/JS, Nginx, Docker対応）
- [ ] Factory一覧画面
- [ ] Factory詳細画面（ステーション一覧表示）
- [ ] ステーション定義GUI（追加/編集/削除）
- [ ] CSVインポート画面（プレビュー + エラー表示）
- [ ] SimDBバリデーション画面（結果表示）
- [ ] 監視セッション開始/停止UI
- [ ] シナリオ一覧・新規作成UI（sim-editorへの遷移リンク）
- [ ] Viewerへの遷移（Liveモード自動起動）
- [ ] docker-compose.ymlへの追加
- [ ] sim-portalへのリンク追加

---

## Phase 7: simulation-core リファクタリング

- [ ] 外部向けREST API削除（全てGateway経由に移管済み）
- [ ] 内部HTTP API整理（Gatewayからの実行リクエスト受付のみ）
- [ ] シミュレーション実行時のbaseTime（start_datetime）パラメータ追加
- [ ] 結果をWDHテーブル（item_movement等）にTIMESTAMPTZ形式でINSERT
- [ ] data_source_id付きでINSERTする対応
- [ ] シナリオ解決 → location_master/connection_master/machine_masterスナップショット生成
- [ ] ステートレス設計の確認（将来のQueue化対応）

---

## 依存関係・実行順序

```
Phase 1 (DB) → Phase 2 (nginx-proxy) → Phase 3 (Gateway) → Phase 4〜7 (並行可能)

Phase 4 (Visualizer)    ← Phase 3完了後
Phase 5 (バッファ)      ← Phase 3, 7完了後
Phase 6 (Factory管理)   ← Phase 3完了後
Phase 7 (sim-core)      ← Phase 3完了後
```
