# SimDB Test Driver

WDH スキーマの外部 SimDB を模倣するテスト用スタンドアロンサービス。

## 構成

| コンテナ | 役割 | デフォルトポート |
|---|---|---|
| simdb-postgres | WDH スキーマの PostgreSQL | 5433 |
| simdb-driver | シナリオ再生制御 API | 8099 |

## 動作モード

| モード | 説明 | 接続先 DB |
|---|---|---|
| `standalone` | simdb-postgres を自前で起動 | simdb-postgres（WDH スキーマ） |
| `central` | factory-simulation の中央 DB に直接 INSERT | factory_simulation DB |

central モードでは NOTIFY トリガーが中央 DB で発火するため、Gateway → Visualizer の **エンドツーエンド連動テスト**が可能です。

## 起動手順

### スタンドアロンモード（デフォルト）

```bash
cd test-tools/simdb-test-driver

# 1. 設定ファイルを用意（初回のみ）
cp .env.example.localhost .env

# 2. 起動（COMPOSE_PROFILES=standalone が自動で simdb-postgres を起動）
docker compose up --build
```

### 中央 DB 統合モード（エンドツーエンドテスト用）

factory-simulation が起動済みの状態で実行します。

```bash
cd test-tools/simdb-test-driver

# 1. 設定ファイルを用意
cp .env.example.central .env
# 必要に応じて DB 接続情報や GATEWAY_URL を編集

# 2. 起動（simdb-postgres は起動しない）
docker compose up --build
```

起動すると simdb-driver がビルトインシナリオ（Linear-3）を自動ロードした状態で待機します。

## シナリオ再生

```bash
# 再生開始
curl -s -X POST http://localhost:8099/play | jq

# 再生状態確認
curl -s http://localhost:8099/status | jq

# 一時停止
curl -s -X POST http://localhost:8099/pause | jq

# 速度を10倍に変更（再生中でも即時反映）
curl -s -X PATCH http://localhost:8099/speed \
  -H "Content-Type: application/json" \
  -d '{"multiplier": 10.0}' | jq

# リセット（ログテーブルをクリアして先頭に戻る）
curl -s -X POST http://localhost:8099/reset | jq
```

## データソースの切り替え

### ビルトイン（デフォルト）

```bash
curl -s -X POST http://localhost:8099/load \
  -H "Content-Type: application/json" \
  -d '{"type": "builtin"}' | jq
```

### ZIP ファイルから読み込む

```bash
# CSV ファイルを ZIP にまとめて ./data/ に配置
cp my_scenario.zip test-tools/simdb-test-driver/data/

# ロード（コンテナ内パスは /data/）
curl -s -X POST http://localhost:8099/load \
  -H "Content-Type: application/json" \
  -d '{"type": "zip", "path": "/data/my_scenario.zip"}' | jq
```

### ディレクトリから読み込む

```bash
# CSV ファイルをディレクトリに配置
mkdir -p test-tools/simdb-test-driver/data/my_scenario
cp *.csv test-tools/simdb-test-driver/data/my_scenario/

# ロード
curl -s -X POST http://localhost:8099/load \
  -H "Content-Type: application/json" \
  -d '{"type": "directory", "path": "/data/my_scenario"}' | jq
```

### 既存 PostgreSQL から読み込む

```bash
curl -s -X POST http://localhost:8099/load \
  -H "Content-Type: application/json" \
  -d '{"type": "db", "dsn": "host=192.168.1.10 port=5432 dbname=simdb_test user=simdb password=simdb sslmode=disable"}' | jq
```

## CSV ファイル形式

テーブルごとに 1 ファイル（ファイル名 = テーブル名）。PostgreSQL の COPY 形式と互換。

```bash
# PostgreSQL からエクスポートする方法
psql -U simdb -d simdb_test -c "\COPY item_movement TO 'item_movement.csv' WITH CSV HEADER"
psql -U simdb -d simdb_test -c "\COPY machine_signal TO 'machine_signal.csv' WITH CSV HEADER"
psql -U simdb -d simdb_test -c "\COPY location_master TO 'location_master.csv' WITH CSV HEADER"
psql -U simdb -d simdb_test -c "\COPY connection_master TO 'connection_master.csv' WITH CSV HEADER"
psql -U simdb -d simdb_test -c "\COPY machine_master TO 'machine_master.csv' WITH CSV HEADER"
psql -U simdb -d simdb_test -c "\COPY item_master TO 'item_master.csv' WITH CSV HEADER"

# ZIP にまとめる
zip scenario.zip *.csv
```

対応テーブル:

| テーブル | 種別 | 備考 |
|---|---|---|
| location_master | マスタ | 起動時に一括 INSERT |
| connection_master | マスタ | |
| machine_master | マスタ | |
| item_master | マスタ | |
| item_movement | ログ | event_time 基準で順次 INSERT |
| machine_signal | ログ | |
| item_status | ログ | |
| item_lineage | ログ | |
| item_expiry | ログ | |
| machine_status | ログ | |

存在しないテーブルの CSV はスキップされます（エラーにならない）。

## Realtime Gateway との接続

### 同一 PC の場合

Gateway 側の Factory 設定で以下の接続情報を指定:

```
host=localhost port=5433 dbname=simdb_test user=simdb password=simdb sslmode=disable
```

### 別 PC の場合

テストドライバーを動かす PC の IP アドレスを指定:

```
host=192.168.x.x port=5433 dbname=simdb_test user=simdb password=simdb sslmode=disable
```

ポート番号は `.env` の `SIMDB_PG_PORT` で変更できます。

### NOTIFY トリガー動作確認

Gateway 接続前に NOTIFY が正しく発火するか確認する方法:

```bash
# 別ターミナルで LISTEN
psql -p 5433 -U simdb simdb_test -c "LISTEN wdh_event;"

# 再生開始後に NOTIFY メッセージが届けば OK
```

## 設定変更

`.env` ファイルを編集して `docker compose up` し直すと反映されます。

### スタンドアロンモード用設定

```dotenv
COMPOSE_PROFILES=standalone  # simdb-postgres を起動する
SIMDB_PG_PORT=5434           # 5433 が使用中の場合
SIMDB_DRIVER_PORT=9099       # 8099 が使用中の場合
SIMDB_SPEED=5.0              # 起動時の速度倍率
SIMDB_TARGET_MODE=standalone
```

### 中央 DB 統合モード用設定

```dotenv
SIMDB_DRIVER_PORT=8099
SIMDB_TARGET_MODE=central

# 中央 DB 接続先
SIMDB_DB_HOST=host.docker.internal  # Mac/Windows
SIMDB_DB_PORT=5432
SIMDB_DB_NAME=factory_simulation
SIMDB_DB_USER=postgres
SIMDB_DB_PASSWORD=postgres

# data_source_id の自動発行（Gateway が起動済みの場合）
SIMDB_GATEWAY_URL=http://host.docker.internal:8080

# data_source_id を手動指定する場合（GATEWAY_URL の代わり）
# SIMDB_DATA_SOURCE_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx

# タイムスタンプ正規化（central モードのデフォルト: true）
# false にすると CSV のタイムスタンプをそのまま INSERT する
# SIMDB_NORMALIZE_TIMESTAMPS=false
```
