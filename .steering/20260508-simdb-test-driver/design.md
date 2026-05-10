# 設計書: SimDB テストドライバー

## アーキテクチャ概要

メインプロジェクトから完全独立した Docker Compose スタック。
2 コンテナ構成（PostgreSQL + Go ドライバー）を `test-tools/simdb-test-driver/` に配置する。

```
┌──────────────────────────────────────────────────────────────────┐
│  test-tools/simdb-test-driver  （独立 Docker Compose）           │
│                                                                  │
│  ┌──────────────────────────────────┐                            │
│  │  simdb-driver  Go :8099          │                            │
│  │                                  │                            │
│  │  DataSource                      │  INSERT                    │
│  │  ├─ BuiltinSource (embed ZIP)    ├──────────────────────►    │
│  │  ├─ ZipSource                    │                       │    │
│  │  ├─ DirectorySource              │                       ▼    │
│  │  └─ DBSource                     │  ┌──────────────────────┐ │
│  │                                  │  │  simdb-postgres      │ │
│  │  Player（仮想時計 + INSERT）      │  │  PostgreSQL :5433    │ │
│  └──────────────────────────────────┘  │  WDH スキーマ        │ │
│                                        └──────────────────────┘ │
└────────────────────────────────────────────────┬─────────────────┘
                                                 │ LISTEN/NOTIFY
                                        ┌────────▼────────┐
                                        │ realtime-gateway │
                                        │（メインスタック  │
                                        │  or 別 PC）      │
                                        └─────────────────┘
```

**ポート割り当て（ホスト公開）:**

| コンテナ | ホストポート | 用途 |
|---|---|---|
| simdb-postgres | 5433 | Gateway の LISTEN/NOTIFY 接続先 |
| simdb-driver | 8099 | 再生制御 API |

## ディレクトリ構造

```
test-tools/
└── simdb-test-driver/
    ├── docker-compose.yml
    ├── .env.example.localhost        # localhost 用テンプレート（リポジトリに含める）
    ├── .gitignore                    # .env を除外
    ├── README.md
    ├── postgres/
    │   ├── Dockerfile                # FROM postgres:16-alpine
    │   └── init.sql                  # WDH DDL + NOTIFY トリガー
    └── driver/
        ├── Dockerfile                # マルチステージビルド
        ├── go.mod
        ├── go.sum
        ├── main.go                   # HTTP サーバー起動
        ├── api/
        │   └── handler.go            # HTTP ハンドラー
        ├── player/
        │   └── player.go             # 仮想時計 + INSERT エンジン
        ├── source/
        │   ├── source.go             # DataSource インターフェース + 共通型
        │   ├── builtin.go            # embed ZIP から読み込む
        │   ├── zip.go                # ZIP ファイルから読み込む
        │   ├── directory.go          # ディレクトリの CSV から読み込む
        │   └── db.go                 # PostgreSQL から直接読み込む
        └── scenario/
            └── default.zip           # デフォルト Linear-3 シナリオ（embed 対象）
```

## コンポーネント設計

### 1. simdb-postgres

**責務:** WDH スキーマの DB を保持し、INSERT 時に NOTIFY を発火する。

**init.sql の構成:**

```sql
-- WDH 全テーブル DDL（wdh-schema-definition.md の DDL をそのまま使用）

-- NOTIFY トリガー関数
CREATE OR REPLACE FUNCTION notify_wdh_event() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify('wdh_event', row_to_json(NEW)::text);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- item_movement と machine_signal に設置
CREATE TRIGGER item_movement_notify
  AFTER INSERT ON item_movement
  FOR EACH ROW EXECUTE FUNCTION notify_wdh_event();

CREATE TRIGGER machine_signal_notify
  AFTER INSERT ON machine_signal
  FOR EACH ROW EXECUTE FUNCTION notify_wdh_event();
```

**接続情報（デフォルト値、.env で変更可）:**

| 項目 | デフォルト値 |
|---|---|
| DB 名 | `simdb_test` |
| ユーザー | `simdb` |
| パスワード | `simdb` |
| ホスト公開ポート | `5433` |

### 2. DataSource インターフェース（source/source.go）

```go
// マスタデータ（起動時に一括 INSERT）
type MasterData struct {
    Locations   []map[string]any
    Connections []map[string]any
    Machines    []map[string]any
    Items       []map[string]any
}

// ログイベント（event_time 基準で順次 INSERT）
type TimedEvent struct {
    EventTime time.Time
    Table     string
    Row       map[string]any
}

type DataSource interface {
    // マスタデータをロードする
    LoadMaster() (*MasterData, error)
    // ログイベントを event_time 昇順でロードする
    LoadEvents() ([]TimedEvent, error)
    // ソースの識別名（ログ・status 表示用）
    Name() string
}
```

**CSV パース共通ロジック（source/source.go）:**
- ヘッダー行をカラム名として扱う
- `event_time` カラムは `time.Time` にパース（RFC3339 / PostgreSQL timestamp 形式）
- 数値カラムは `string` のまま保持し、INSERT 時に PostgreSQL に型変換を委ねる

### 3. DataSource 実装

**BuiltinSource（source/builtin.go）:**
```go
//go:embed ../scenario/default.zip
var defaultZip []byte

// defaultZip を ZipSource に委譲するだけ
```

**ZipSource（source/zip.go）:**
- `archive/zip` で ZIP を展開してメモリ上で CSV を読み込む
- ファイル名 = テーブル名（`item_movement.csv` → `item_movement` テーブル）
- 存在しないテーブルの CSV は無視

**DirectorySource（source/directory.go）:**
- ZipSource と同じロジック、`os.ReadFile` でファイルを読む

**DBSource（source/db.go）:**
- DSN で既存 PostgreSQL に接続
- マスタテーブルを全件 SELECT
- ログテーブルを `ORDER BY event_time ASC` で全件 SELECT → `[]TimedEvent` に変換

### 4. Player（player/player.go）

**仮想時計の仕組み:**

```
events = LoadEvents()  // event_time 昇順ソート済み
baseEventTime = events[0].EventTime
playStartWallTime = time.Now()

再生ループ:
  for each event:
    offsetFromBase = event.EventTime - baseEventTime
    targetWallOffset = offsetFromBase / multiplier
    sleepUntil = playStartWallTime + targetWallOffset
    time.Sleep(sleepUntil - time.Now())
    INSERT event into simdb-postgres
```

**ステート管理:**

```
idle      →[/load]→   loaded
loaded    →[/play]→   running
running   →[/pause]→  paused
paused    →[/play]→   running
running   →(完了)→    completed
any       →[/reset]→  loaded   ※マスタは保持、ログテーブルのみ TRUNCATE
loaded    →[/load]→   loaded   ※別ソースの再ロード（マスタ再 INSERT）
```

**速度倍率の即時変更:**
- `atomic.Int64`（× 1000 してミリ秒換算）で保持
- 次の sleep 計算時に最新値を参照するため、変更は即次イベントから反映される

**TRUNCATE 対象テーブル（/reset）:**
```sql
TRUNCATE item_movement, machine_signal, item_status,
         item_lineage, item_expiry, machine_status;
-- location_master, connection_master, machine_master, item_master は保持
```

### 5. HTTP API（api/handler.go）

**POST /load リクエストボディ:**

```jsonc
// builtin（デフォルト同梱 ZIP）
{ "type": "builtin" }

// ZIP ファイル（コンテナ内パス）
{ "type": "zip", "path": "/data/my_scenario.zip" }

// ディレクトリ（コンテナ内パス）
{ "type": "directory", "path": "/data/csv_dir" }

// 既存 PostgreSQL
{ "type": "db", "dsn": "host=192.168.1.10 port=5433 dbname=simdb_test user=simdb password=simdb" }
```

**GET /status レスポンス:**

```json
{
  "state": "running",
  "source": "builtin:Linear-3",
  "current_event_index": 12,
  "total_events": 40,
  "elapsed_scenario_sec": 13.0,
  "speed_multiplier": 1.0
}
```

**PATCH /speed バリデーション:** `0.1 ≤ multiplier ≤ 100.0`、範囲外は 400 Bad Request

**エラーハンドリング:**

| 状況 | レスポンス |
|---|---|
| 再生中に /play | 409 Conflict |
| 不正な speed 値 | 400 Bad Request |
| /load でパス不存在 | 400 Bad Request + エラーメッセージ |
| INSERT エラー | ログ出力してステートを `error` に変更 |
| DB 接続失敗（起動時） | 指数バックオフで最大 10 回リトライ |

## 設定管理（.env ファイル）

**`.env.example.localhost`（リポジトリに含めるテンプレート）:**

```dotenv
# localhost 用設定例
# 使い方: cp .env.example.localhost .env

SIMDB_PG_PORT=5433
SIMDB_DRIVER_PORT=8099

SIMDB_DB_NAME=simdb_test
SIMDB_DB_USER=simdb
SIMDB_DB_PASSWORD=simdb

SIMDB_SPEED=1.0
```

- `.env` はリポジトリに含めない（`.gitignore` 対象）
- `docker-compose.yml` は全て `${SIMDB_*}` 変数参照

## docker-compose.yml 概要

```yaml
services:
  simdb-postgres:
    build: ./postgres
    environment:
      POSTGRES_DB: ${SIMDB_DB_NAME}
      POSTGRES_USER: ${SIMDB_DB_USER}
      POSTGRES_PASSWORD: ${SIMDB_DB_PASSWORD}
    ports:
      - "${SIMDB_PG_PORT}:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${SIMDB_DB_USER} -d ${SIMDB_DB_NAME}"]
      interval: 5s
      timeout: 5s
      retries: 10

  simdb-driver:
    build: ./driver
    environment:
      DB_HOST: simdb-postgres
      DB_PORT: 5432
      DB_NAME: ${SIMDB_DB_NAME}
      DB_USER: ${SIMDB_DB_USER}
      DB_PASSWORD: ${SIMDB_DB_PASSWORD}
      DRIVER_PORT: ${SIMDB_DRIVER_PORT}
      INITIAL_SPEED: ${SIMDB_SPEED}
    ports:
      - "${SIMDB_DRIVER_PORT}:${SIMDB_DRIVER_PORT}"
    volumes:
      - ./data:/data   # ZIP / ディレクトリソースのマウント先
    depends_on:
      simdb-postgres:
        condition: service_healthy
```

ZIP やディレクトリソースを使う場合はホスト側の `./data/` に配置し、
`/load` の `path` に `/data/xxx` を指定する。

## データフロー

### 再生開始から Visualizer 表示まで

```
1. POST /load → DataSource がイベントをメモリにロード
2. POST /play → Player が仮想時計をスタート
3. 仮想時計が event_time を超えたイベントを INSERT
4. simdb-postgres の NOTIFY トリガーが `wdh_event` チャネルに NOTIFY
5. realtime-gateway が LISTEN で受信 → WebSocket fan-out
6. sim-visualizer が受信 → 3D アニメーション更新
```

## 将来の拡張性

- `source/` にファイルを追加するだけで新しい DataSource 種別を追加可能
- `scenario/` に ZIP を追加して `/load {"type":"builtin","name":"xxx"}` でシナリオ切り替え可能
- item_lineage / item_status への対応は `TimedEvent` 型を変えずに追加可能
