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

- [ ] `test-tools/simdb-test-driver/` ディレクトリ作成
- [ ] `test-tools/simdb-test-driver/postgres/` ディレクトリ作成
- [ ] `test-tools/simdb-test-driver/driver/` ディレクトリ作成（Go モジュール初期化含む）
- [ ] `test-tools/simdb-test-driver/data/` ディレクトリ作成（ZIP / CSV マウント先）

---

## フェーズ 1: simdb-postgres コンテナ

- [ ] `postgres/Dockerfile` 作成（`FROM postgres:16-alpine`）
- [ ] `postgres/init.sql` 作成
  - [ ] WDH 全テーブルの DDL（`docs/wdh-schema-definition.md` の DDL を転記）
  - [ ] `notify_wdh_event()` トリガー関数の定義
  - [ ] `item_movement` への NOTIFY トリガー設置
  - [ ] `machine_signal` への NOTIFY トリガー設置

---

## フェーズ 2: DataSource インターフェースと共通ロジック

- [ ] `driver/source/source.go` 作成
  - [ ] `MasterData` 型定義
  - [ ] `TimedEvent` 型定義（EventTime, Table, Row）
  - [ ] `DataSource` インターフェース定義（LoadMaster / LoadEvents / Name）
  - [ ] CSV パース共通ロジック実装（ヘッダー行、event_time パース、数値は string 保持）

---

## フェーズ 3: DataSource 実装

- [ ] `driver/source/zip.go` 作成（ZIP ファイルから CSV を読み込む）
  - [ ] `archive/zip` でメモリ展開
  - [ ] ファイル名からテーブル名を解決
  - [ ] 存在しない CSV は無視
- [ ] `driver/source/directory.go` 作成（ディレクトリの CSV を読み込む）
  - [ ] ZipSource と同じロジック、`os.ReadFile` でファイル読み込み
- [ ] `driver/source/builtin.go` 作成
  - [ ] `//go:embed ../scenario/default.zip` でデフォルト ZIP を内蔵
  - [ ] `ZipSource` に委譲
- [ ] `driver/source/db.go` 作成（既存 PostgreSQL から読み込む）
  - [ ] DSN で接続
  - [ ] マスタテーブル全件 SELECT → `MasterData` に変換
  - [ ] ログテーブルを `ORDER BY event_time ASC` で全件 SELECT → `[]TimedEvent` に変換
- [ ] `driver/scenario/default.zip` 作成（Linear-3 シナリオの CSV 一式）
  - [ ] `location_master.csv`（source, proc_01, proc_02, drain）
  - [ ] `connection_master.csv`（3 接続）
  - [ ] `machine_master.csv`（M-PROC01, M-PROC02）
  - [ ] `item_master.csv`（item-001, item-002, item-003）
  - [ ] `item_movement.csv`（3 ワーク × 4 ステーション × arrived/departed、全 ~24 件）
  - [ ] `machine_signal.csv`（inputReady 変化 × 2 設備、全 ~16 件）

---

## フェーズ 4: Player（仮想時計 + INSERT エンジン）

- [ ] `driver/player/player.go` 作成
  - [ ] ステート管理（idle / loaded / running / paused / completed / error）
  - [ ] マスタデータ一括 INSERT ロジック（/load 時に実行）
  - [ ] 仮想時計による再生ループ実装
    - [ ] `baseEventTime` = 最初のイベントの EventTime
    - [ ] 各イベントの `offsetFromBase / multiplier` で sleep 量を計算
    - [ ] `INSERT` 実行
  - [ ] `atomic` による速度倍率管理（再生中の即時変更対応）
  - [ ] TRUNCATE によるリセットロジック（ログテーブルのみ、マスタは保持）
  - [ ] DB 接続リトライ（指数バックオフ、最大 10 回）

---

## フェーズ 5: HTTP API

- [ ] `driver/api/handler.go` 作成
  - [ ] `POST /load` 実装（builtin / zip / directory / db の分岐）
  - [ ] `GET /status` 実装
  - [ ] `POST /play` 実装（loaded/paused → running、他状態は 409）
  - [ ] `POST /pause` 実装（running → paused）
  - [ ] `POST /reset` 実装（ログ TRUNCATE → loaded 状態に戻す）
  - [ ] `PATCH /speed` 実装（バリデーション: 0.1〜100.0）
  - [ ] `GET /scenario` 実装（現在ロード中のシナリオ情報）
- [ ] `driver/main.go` 作成（HTTP サーバー起動、グレースフルシャットダウン）

---

## フェーズ 6: Docker・設定ファイル

- [ ] `driver/Dockerfile` 作成（マルチステージビルド: `golang:1.22-alpine` → `alpine`）
- [ ] `.env.example.localhost` 作成（localhost 用テンプレート、リポジトリに含める）
- [ ] `.gitignore` 作成（`.env` を除外）
- [ ] `docker-compose.yml` 作成
  - [ ] `simdb-postgres` サービス定義（`.env` 参照、ヘルスチェック付き）
  - [ ] `simdb-driver` サービス定義（`.env` 参照、`./data:/data` ボリューム、`depends_on: service_healthy`）

---

## フェーズ 7: ドキュメント・動作確認

- [ ] `README.md` 作成
  - [ ] 起動手順（`cp .env.example.localhost .env` → `docker compose up`）
  - [ ] API 使用例（curl コマンド: /load, /play, /speed, /reset）
  - [ ] ZIP / ディレクトリソースの使い方（`./data/` へのファイル配置手順）
  - [ ] Gateway 接続設定方法（同一 PC / 別 PC）
  - [ ] PostgreSQL からの CSV エクスポート方法
- [ ] `docker compose up` で正常起動することを確認
- [ ] `POST /load {"type":"builtin"}` → `POST /play` で再生されることを確認
- [ ] `POST /load {"type":"zip","path":"/data/..."}` で ZIP ソースが動作することを確認
- [ ] `POST /load {"type":"directory","path":"/data/..."}` でディレクトリソースが動作することを確認
- [ ] `PATCH /speed {"multiplier":100.0}` で全件が数秒以内に INSERT されることを確認
- [ ] `POST /reset` 後に再度 `POST /play` でシナリオが最初から再生できることを確認
- [ ] NOTIFY トリガーが発火していることを確認（`LISTEN wdh_event` で受信確認）

---

## 実装後の振り返り

### 実装完了日
{YYYY-MM-DD}

### 計画と実績の差分

**計画と異なった点**:
- {記録}

**新たに必要になったタスク**:
- {記録}

### 学んだこと

**技術的な学び**:
- {記録}

### 次回への改善提案
- {記録}
