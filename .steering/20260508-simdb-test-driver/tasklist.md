# タスクリスト: SimDB テストドライバー

## 🚨 タスク完全完了の原則

**このファイルの全タスクが完了するまで作業を継続すること**

### 必須ルール
- **全てのタスクを`[x]`にすること**
- 「時間の都合により別タスクとして実施予定」は禁止
- 「実装が複雑すぎるため後回し」は禁止
- 未完了タスク（`[ ]`）を残したまま作業を終了しない

---

## フェーズ 0: プロジェクト骨格作成

- [x] `test-tools/simdb-test-driver/` ディレクトリ作成
- [x] `test-tools/simdb-test-driver/postgres/` ディレクトリ作成
- [x] `test-tools/simdb-test-driver/driver/` ディレクトリ作成（Go モジュール初期化含む）
- [x] `test-tools/simdb-test-driver/data/` ディレクトリ作成（ZIP / CSV マウント先）

---

## フェーズ 1: simdb-postgres コンテナ

- [x] `postgres/Dockerfile` 作成（`FROM postgres:16-alpine`）
- [x] `postgres/init.sql` 作成
  - [x] WDH 全テーブルの DDL（`docs/wdh-schema-definition.md` の DDL を転記）
  - [x] `notify_wdh_event()` トリガー関数の定義
  - [x] `item_movement` への NOTIFY トリガー設置
  - [x] `machine_signal` への NOTIFY トリガー設置

---

## フェーズ 2: DataSource インターフェースと共通ロジック

- [x] `driver/source/source.go` 作成
  - [x] `MasterData` 型定義
  - [x] `TimedEvent` 型定義（EventTime, Table, Row）
  - [x] `DataSource` インターフェース定義（LoadMaster / LoadEvents / Name）
  - [x] CSV パース共通ロジック実装（ヘッダー行、event_time パース、数値は string 保持）

---

## フェーズ 3: DataSource 実装

- [x] `driver/source/zip.go` 作成（ZIP ファイルから CSV を読み込む）
  - [x] `archive/zip` でメモリ展開
  - [x] ファイル名からテーブル名を解決
  - [x] 存在しない CSV は無視
- [x] `driver/source/directory.go` 作成（ディレクトリの CSV を読み込む）
  - [x] ZipSource と同じロジック、`os.ReadFile` でファイル読み込み
- [x] `driver/source/builtin.go` 作成
  - [x] `//go:embed ../scenario/default.zip` でデフォルト ZIP を内蔵
  - [x] `ZipSource` に委譲
- [x] `driver/source/db.go` 作成（既存 PostgreSQL から読み込む）
  - [x] DSN で接続
  - [x] マスタテーブル全件 SELECT → `MasterData` に変換
  - [x] ログテーブルを `ORDER BY event_time ASC` で全件 SELECT → `[]TimedEvent` に変換
- [x] `driver/scenario/default.zip` 作成（Linear-3 シナリオの CSV 一式）
  - [x] `location_master.csv`（source, proc_01, proc_02, drain）
  - [x] `connection_master.csv`（3 接続）
  - [x] `machine_master.csv`（M-PROC01, M-PROC02）
  - [x] `item_master.csv`（item-001, item-002, item-003）
  - [x] `item_movement.csv`（3 ワーク × 4 ステーション × arrived/departed、全 ~24 件）
  - [x] `machine_signal.csv`（inputReady 変化 × 2 設備、全 ~16 件）

---

## フェーズ 4: Player（仮想時計 + INSERT エンジン）

- [x] `driver/player/player.go` 作成
  - [x] ステート管理（idle / loaded / running / paused / completed / error）
  - [x] マスタデータ一括 INSERT ロジック（/load 時に実行）
  - [x] 仮想時計による再生ループ実装
    - [x] `baseEventTime` = 最初のイベントの EventTime
    - [x] 各イベントの `offsetFromBase / multiplier` で sleep 量を計算
    - [x] `INSERT` 実行
  - [x] `atomic` による速度倍率管理（再生中の即時変更対応）
  - [x] TRUNCATE によるリセットロジック（ログテーブルのみ、マスタは保持）
  - [x] DB 接続リトライ（指数バックオフ、最大 10 回）

---

## フェーズ 5: HTTP API

- [x] `driver/api/handler.go` 作成
  - [x] `POST /load` 実装（builtin / zip / directory / db の分岐）
  - [x] `GET /status` 実装
  - [x] `POST /play` 実装（loaded/paused → running、他状態は 409）
  - [x] `POST /pause` 実装（running → paused）
  - [x] `POST /reset` 実装（ログ TRUNCATE → loaded 状態に戻す）
  - [x] `PATCH /speed` 実装（バリデーション: 0.1〜100.0）
  - [x] `GET /scenario` 実装（現在ロード中のシナリオ情報）
- [x] `driver/main.go` 作成（HTTP サーバー起動、グレースフルシャットダウン）

---

## フェーズ 6: Docker・設定ファイル

- [x] `driver/Dockerfile` 作成（マルチステージビルド: `golang:1.22-alpine` → `alpine`）
- [x] `.env.example.localhost` 作成（localhost 用テンプレート、リポジトリに含める）
- [x] `.gitignore` 作成（`.env` を除外）
- [x] `docker-compose.yml` 作成
  - [x] `simdb-postgres` サービス定義（`.env` 参照、ヘルスチェック付き）
  - [x] `simdb-driver` サービス定義（`.env` 参照、`./data:/data` ボリューム、`depends_on: service_healthy`）

---

## フェーズ 7: ドキュメント・動作確認

- [x] `README.md` 作成
  - [x] 起動手順（`cp .env.example.localhost .env` → `docker compose up`）
  - [x] API 使用例（curl コマンド: /load, /play, /speed, /reset）
  - [x] ZIP / ディレクトリソースの使い方（`./data/` へのファイル配置手順）
  - [x] Gateway 接続設定方法（同一 PC / 別 PC）
  - [x] PostgreSQL からの CSV エクスポート方法
- [x] `docker compose up` で正常起動することを確認
- [x] `POST /load {"type":"builtin"}` → `POST /play` で再生されることを確認
- [x] `POST /load {"type":"zip","path":"/data/..."}` で ZIP ソースが動作することを確認
- [x] `POST /load {"type":"directory","path":"/data/..."}` でディレクトリソースが動作することを確認
- [x] `PATCH /speed {"multiplier":100.0}` で全件が数秒以内に INSERT されることを確認
- [x] `POST /reset` 後に再度 `POST /play` でシナリオが最初から再生できることを確認
- [x] NOTIFY トリガーが発火していることを確認（`LISTEN wdh_event` で受信確認）

---

---

## フェーズ 8: デモシナリオ作成・Live モードテスト（2026-05-10追加）

- [x] 4-モジュラーステーション + 20プロセス直列シナリオを simulation-core API で作成
  - [x] シナリオ `Demo-4Moduler-20Process`（ID: `1c42a1b8-76f7-4964-bcec-ed75c147a1f2`）
  - [x] 各モジュラーステーションに 22 セル横長 model3DGrid を設定（entry + 20 slots + exit）
  - [x] bufferSlots=20 設定済み
- [x] シミュレーション実行（300秒、`POST /api/executions`）
  - [x] WDH データ（22,348 movements + 65,925 signals = 88,273 イベント）を factory_simulation DB に書き込み
  - [x] `data_source_id` でスコープされて書き込み済み
- [x] WDH データを CSV/ZIP としてエクスポート
  - [x] `test-tools/simdb-test-driver/data/demo-4moduler.zip` 作成
  - [x] 不要な `data_source_id` カラムを除外、タイムスタンプを UTC テキスト形式に変換
- [x] Live モード動作テスト
  - [x] central モード用 `.env` 設定（`SIMDB_DATA_SOURCE_ID=d2fef4ec-...`）
  - [x] `demo-4moduler.zip` ロード → Play → 88,273 イベントの挿入確認
- [x] バグ修正
  - [x] `truncateAll` のマスタテーブル処理: `DELETE FROM` を `DELETE WHERE data_source_id=...` から無条件 DELETE に変更（central モードでも master テーブルの全データを削除）
  - [x] gateway の RFC3339 パース: `time.RFC3339` → `RFC3339Nano` fallback 追加（`1970-01-01T00:00:00.000Z` が正しくパースされない問題を修正）
  - [x] Visualizer の Live モード性能改善: `_buildEventIndices` を毎イベントで呼ぶ代わりに `_extendDepartureMap` で差分更新
  - [x] Visualizer の Live モード初期表示: `_activateLive` に `seek(maxTime)` 追加（ライブモード有効化時に最新状態を表示）
  - [x] シナリオ linked の `scenarioId` 設定: data source に `scenarioId` を登録することで `model3DGrid` 設定が Visualizer に届く
- [x] シナリオデータ保存
  - [x] `test-tools/simdb-test-driver/data/demo-4moduler-scenario.json` に シナリオ JSON を保存
  - [x] `test-tools/simdb-test-driver/data/demo-4moduler.zip` に WDH データ CSV を保存

---

## 実装後の振り返り

### 実装完了日
2026-05-10（フェーズ 0〜7）、2026-05-11（フェーズ 8: デモシナリオ + Live モードテスト）

### 計画と実績の差分

**計画と異なった点**:
- `//go:embed` は `..` パス不可のため `scenario/` を `source/` 配下に移動（`driver/source/scenario/default.zip`）
- go.mod の Go バージョンを 1.26.1 → 1.25.0 に変更（Docker の golang:1.25-alpine イメージに合わせるため）
- `/load` 時にマスタテーブルも TRUNCATE する `truncateAll()` を追加（別ソースのロード時に duplicate key が発生したため）

**新たに必要になったタスク**:
- `truncateAll()` メソッドの追加（Load 時に全テーブルクリア）

### 学んだこと

**技術的な学び**:
- Go の `embed` パッケージはパッケージディレクトリ内のパスのみ許容（`..` 不可）
- pgx/v5 の最新版は Go 1.25+ を要求するため Docker イメージのバージョン選定に注意が必要
- `/load` と `/reset` の責務分離: load=全テーブルリセット+新マスタ投入、reset=ログのみリセット（同一シナリオ再生用）

### 次回への改善提案
- `db` ソースのエンドツーエンドテストは実際の外部 PostgreSQL が必要なため手動確認が必要
- 速度変更時に `playStartWall` を補正すると、倍率変更後の残りイベントのタイミングがより正確になる
- シナリオ複数対応は `source/scenario/` に ZIP を追加して `/load {"type":"builtin","name":"xxx"}` を拡張するだけで対応可能
- `.env.example.central` の `SIMDB_GATEWAY_URL` は port 8080 直接接続なため機能しない（nginx が 443 のみ公開）。手動で `SIMDB_DATA_SOURCE_ID` を設定する方が確実
- WDH イベント件数が大きい（88k）場合、Visualizer の初回ロード時に ~6MB の JSON を一括取得するため、将来的にはページネーションまたはカーソルベースの取得が望ましい
