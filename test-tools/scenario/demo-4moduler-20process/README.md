# デモシナリオ: Demo-4Moduler-20Process

4つのモジュラーステーション（各20プロセス直列）を持つデモ用シナリオと、SimDB Live モードのテスト手順。

## シナリオ構成

```
source-1 → mod-1 → mod-2 → mod-3 → mod-4 → drain-1
```

| 項目 | 内容 |
|---|---|
| シナリオ名 | Demo-4Moduler-20Process |
| ソースステーション | 1個（source-1） |
| モジュラーステーション | 4個（mod-1〜mod-4） |
| 各モジュラー内プロセス | 20個直列（slot-0〜slot-19）+ entry/exit |
| ドレインステーション | 1個（drain-1） |
| シミュレーション時間 | 300秒 |
| ワーク数 | 151個 |

### WDH データ規模

| テーブル | 件数 |
|---|---|
| location_master | 94行（ステーション定義） |
| connection_master | 89行（接続定義） |
| machine_master | 92行（設備定義） |
| item_master | 151行（ワーク定義） |
| item_movement | 22,348行 |
| machine_signal | 65,925行 |

### 3D モデル設定（model3DGrid）

各モジュラーは横長グリッド（22セル × 1行、gridSize=0.5）として定義されており、
Visualizer で横長の箱として正しく表示されます。

---

## 収録ファイル

| ファイル | 説明 |
|---|---|
| `scenario.json` | シミュレーションシナリオ定義（POST /api/scenarios で登録） |
| `wdh-data.zip` | SimDB 再生用 WDH CSV データ一式 |
| `data_source.json` | デモ環境で使用した DataSource の設定情報 |
| `README.md` | このファイル |

---

## テスト手順

### 前提条件

- `factory-simulation` スタック（nginx, gateway, sim-core, postgres）が起動済みであること
- `test-tools/simdb-test-driver/` が起動済みであること（central モード）

### Step 1: シナリオの登録

`scenario.json` を simulation-core API に登録します。

```bash
SCENARIO_ID=$(curl -sk -X POST https://localhost/api/scenarios \
  -H 'Content-Type: application/json' \
  -d @test-tools/scenario/demo-4moduler-20process/scenario.json \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['id'])")

echo "Registered scenario: $SCENARIO_ID"
```

> **注意**: 登録済みのシナリオを再利用する場合はこの手順をスキップし、既存の `scenarioId` を使用します。

### Step 2: DataSource の作成

Gateway API で DataSource を作成し、Step 1 で取得した `scenarioId` を設定します。

```bash
DS_ID=$(curl -sk -X POST https://localhost/api/data-sources \
  -H 'Content-Type: application/json' \
  -d "{
    \"friendlyName\": \"demo-4moduler-live\",
    \"scenarioId\": \"$SCENARIO_ID\"
  }" \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['id'])")

echo "Created data source: $DS_ID"
```

### Step 3: simdb-test-driver の設定

`test-tools/simdb-test-driver/.env` を central モード用に設定します。

```bash
cd test-tools/simdb-test-driver
cp .env.example.central .env
```

`.env` を編集して `SIMDB_DATA_SOURCE_ID` に Step 2 で取得した ID を設定します。

```dotenv
SIMDB_TARGET_MODE=central
SIMDB_DATA_SOURCE_ID=<Step 2 で取得した DS_ID>

# データベース接続先（Mac/Windows の場合）
SIMDB_DB_HOST=host.docker.internal
SIMDB_DB_PORT=5432
SIMDB_DB_NAME=factory_simulation
SIMDB_DB_USER=postgres
SIMDB_DB_PASSWORD=postgres

# タイムスタンプ正規化（Live モードでは必須）
# SIMDB_NORMALIZE_TIMESTAMPS=true  ← central モードのデフォルトで true
```

### Step 4: simdb-test-driver の起動

```bash
cd test-tools/simdb-test-driver
docker compose up -d simdb-driver
```

### Step 5: WDH データの読み込み

`wdh-data.zip` をドライバーにロードします。

コンテナの `/data/` にアクセスできるよう、ZIP を `data/` ディレクトリに配置します（ドライバー起動時に `./data:/data` でマウント済み）。

```bash
# ZIP を data/ にコピー
cp test-tools/scenario/demo-4moduler-20process/wdh-data.zip \
   test-tools/simdb-test-driver/data/demo-4moduler-20process.zip

# ドライバーにロード
curl -s -X POST http://localhost:8099/load \
  -H 'Content-Type: application/json' \
  -d '{"type": "zip", "path": "/data/demo-4moduler-20process.zip"}' | jq
```

ロード結果確認：

```bash
curl -s http://localhost:8099/status | jq
```

期待する出力（`state: "loaded"`）：

```json
{
  "state": "loaded",
  "source": "zip:/data/demo-4moduler-20process.zip",
  "current_event_index": 0,
  "total_events": 88273
}
```

### Step 6: 再生速度の設定

```bash
# 10倍速で再生（300秒のデータを30秒で再生）
curl -s -X PATCH http://localhost:8099/speed \
  -H 'Content-Type: application/json' \
  -d '{"multiplier": 10.0}' | jq
```

### Step 7: 再生開始

```bash
curl -s -X POST http://localhost:8099/play | jq
```

### Step 8: Visualizer でリアルタイム確認

ブラウザで以下の URL を開きます。

```
https://localhost/visualizer/?ds=<DS_ID>&live=1
```

- **LIVE ボタン**が赤く点灯し「● LIVE」と表示されれば WebSocket 接続成功
- ステーションにワーク（球体）が表示され、mod-1 → mod-2 → mod-3 → mod-4 と順に流れる
- モジュラーステーションをダブルクリックすると内部の20プロセスが表示される

### Step 9: 再生状態の確認

```bash
# 再生中の状態確認
curl -s http://localhost:8099/status | jq

# DB への挿入確認
docker exec factory-simulation-db psql -U postgres factory_simulation -t -c \
  "SELECT COUNT(*) FROM item_movement WHERE data_source_id='$DS_ID';"
```

### Step 10: 終了処理

再生完了後、DataSource の `endedAt` を設定します（Visualizer が再生モードに切り替わります）。

```bash
END_TIME=$(docker exec factory-simulation-db psql -U postgres factory_simulation -t -c \
  "SELECT MAX(event_time) FROM item_movement WHERE data_source_id='$DS_ID';" | xargs | sed 's/ /T/' | sed 's/+00/Z/')

curl -sk -X PATCH https://localhost/api/data-sources/$DS_ID \
  -H 'Content-Type: application/json' \
  -d "{\"endedAt\": \"$END_TIME\"}" | jq
```

---

## テストのリセットと再実行

### ログデータのみリセット（シナリオ保持）

```bash
# ドライバーをリセット（ログテーブルのみクリア）
curl -s -X POST http://localhost:8099/reset | jq

# DataSource の endedAt をクリア（Live モードに戻す）
curl -sk -X PATCH https://localhost/api/data-sources/$DS_ID \
  -H 'Content-Type: application/json' \
  -d '{"endedAt": null}' | jq

# 再生開始
curl -s -X POST http://localhost:8099/play | jq
```

### 完全リセット（マスタ + ログ）

```bash
# ZIP を再ロード（マスタも含めて全クリア + 再投入）
curl -s -X POST http://localhost:8099/load \
  -H 'Content-Type: application/json' \
  -d '{"type": "zip", "path": "/data/demo-4moduler-20process.zip"}' | jq
```

---

## トラブルシューティング

### ドライバーが standalone モードで起動する

`.env` の `SIMDB_TARGET_MODE=central` を確認してください。変更後はコンテナを再起動します。

```bash
docker compose down simdb-driver && docker compose up -d simdb-driver
```

### load 時に「duplicate key value」エラー

前回のテストで location_master 等のマスタデータが残っている可能性があります。
ドライバーの `/load` エンドポイントはマスタテーブルを全件 DELETE してから INSERT するため、
同じ操作をもう一度実行すると解消します。

### Visualizer に「LIVE LOST」と表示される

WebSocket 接続が切れています。以下を確認してください：

1. Gateway コンテナが起動しているか: `docker ps | grep gateway`
2. ブラウザをリロードして再接続

### events API がデータを返さない（空配列）

`from` / `to` パラメータのタイムゾーン形式を確認してください。
`1970-01-01T00:00:00.000Z`（ミリ秒付き RFC3339）形式に対応しています。

```bash
curl -sk "https://localhost/api/data-sources/$DS_ID/events?from=1970-01-01T00:00:00.000Z&to=2100-01-01T00:00:00.000Z" | python3 -c "import json,sys; print('events:', len(json.load(sys.stdin)))"
```

---

## Visualizer URL パラメータ

| パラメータ | 値 | 説明 |
|---|---|---|
| `ds` | DataSource UUID | 表示するデータソースを指定 |
| `live` | `1` | Live モードで起動（WebSocket 接続・自動追従） |

例:
```
# 再生モード（endedAt が設定済みの場合、自動再生）
https://localhost/visualizer/?ds=d2fef4ec-6055-4f98-84b2-cf7e34d164e3

# Live モード（endedAt が未設定の場合に使用）
https://localhost/visualizer/?ds=d2fef4ec-6055-4f98-84b2-cf7e34d164e3&live=1
```

---

## シナリオ詳細

### ステーション階層

```
source-1          （source）
mod-1             （moduler）
  mod-1.entry-0   （entry）
  mod-1.slot-0    （processing）
  mod-1.slot-1    （processing）
  ...
  mod-1.slot-19   （processing）
  mod-1.exit-0    （exit）
mod-2             （moduler）  ← 同上の構成
mod-3             （moduler）  ← 同上の構成
mod-4             （moduler）  ← 同上の構成
drain-1           （drain）
```

### 3D レイアウト座標

| ステーション | X座標 | Y座標 |
|---|---|---|
| source-1 | 200 | 500 |
| mod-1 | 800 | 500 |
| mod-2 | 2000 | 500 |
| mod-3 | 3200 | 500 |
| mod-4 | 4400 | 500 |
| drain-1 | 5600 | 500 |

### CSV ファイル仕様

`wdh-data.zip` に含まれる CSV の形式：

| ファイル | ヘッダー |
|---|---|
| location_master.csv | id, name, station_type, parent_location_id, pos_x, pos_y, pos_z, max_capacity, processing_time, merge_count, split_count |
| connection_master.csv | id, from_location_id, to_location_id, condition, from_port_index, to_port_index |
| machine_master.csv | id, location_id, name |
| item_master.csv | id, name, item_type, friendly_name |
| item_movement.csv | event_time, item_id, from_location_id, to_location_id, movement_type, port_index |
| machine_signal.csv | event_time, machine_id, signal_name, value, old_value, rule_id |

タイムスタンプ形式: `YYYY-MM-DD HH:MM:SS.UUUUUU`（UTC、タイムゾーン表記なし）
