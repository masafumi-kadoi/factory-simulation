# デモシナリオ: Demo-2Source-7Moduler-Merge

2つのソースラインが7つのモジュラーステーション（マージあり）を通るデモシナリオと SimDB Live モードのテスト手順。

## シナリオ構成

```
source-1 → mod-1 → mod-3 ─┐
                            ├→ mod-5(merge) → mod-6 → mod-7 → drain-1
source-2 → mod-2 → mod-4 ─┘
```

| 項目 | 内容 |
|---|---|
| シナリオ名 | Demo-2Source-7Moduler-Merge |
| ソースステーション | 2個（source-1: workA、source-2: workB） |
| モジュラーステーション | 7個（mod-1〜mod-7） |
| ドレインステーション | 1個（drain-1） |
| シミュレーション時間 | 約503秒（全ワーク完走まで） |
| ワーク数 | 300個（workA 150個 + workB 150個） |

### ステーション仕様

| ステーション | 役割 | 内部構成 | サイクルタイム |
|---|---|---|---|
| mod-1, mod-2 | 第1工程（ライン別） | entry + 10 slots + exit | 2.8s/slot（搬入0.2s + 加工2.4s + 搬出0.2s） |
| mod-3, mod-4 | 第2工程（ライン別） | entry + 10 slots + exit | 2.8s/slot |
| mod-5 | マージ工程（2入口） | entry-0 + entry-1 + 5 slots + exit | 1.4s/slot（搬入0.2s + 加工1.0s + 搬出0.2s） |
| mod-6, mod-7 | 後工程 | entry + 10 slots + exit | 1.4s/slot |

### スループット設計

- source-1, source-2: 各 2.8s 間隔でワーク投入 → 合計 1/1.4 works/s
- mod-5 マージ: 2ラインから交互に搬入、1.4s サイクルでバランス
- mod-6, mod-7: 1.4s サイクル（合流後の倍スループットに対応）

### WDH データ規模

| テーブル | 件数 |
|---|---|
| location_master | 90行 |
| connection_master | 82行 |
| machine_master | 87行 |
| item_master | 300行（workA 150 + workB 150） |
| item_movement | 33,600行 |
| machine_signal | 97,342行 |

### 3D モデル設定（model3DGrid）

| ステーション | グリッド | 説明 |
|---|---|---|
| mod-1〜mod-4 | 12セル × 1行（gridSize=0.5） | 10スロット + entry + exit |
| mod-5 | 8セル × 2行（gridSize=0.5） | 5スロット + 2 entries + exit（2列構成） |
| mod-6, mod-7 | 12セル × 1行（gridSize=0.5） | 10スロット + entry + exit |

---

## 収録ファイル

| ファイル | 説明 |
|---|---|
| `scenario.json` | シミュレーションシナリオ定義（POST /api/scenarios で登録） |
| `wdh-data.zip` | SimDB 再生用 WDH CSV データ一式 |
| `data_source.json` | デモ環境で使用した DataSource の設定情報 |
| `run-live-test.sh` | テスト自動化スクリプト |
| `README.md` | このファイル |

---

## テスト手順

### 前提条件

- `factory-simulation` スタック（nginx, gateway, sim-core, postgres）が起動済みであること
- `test-tools/simdb-test-driver/` が起動済みであること（central モード）

### Step 1: シナリオの登録

```bash
SCENARIO_ID=$(curl -sk -X POST https://localhost/api/scenarios \
  -H 'Content-Type: application/json' \
  -d @test-tools/scenario/demo-2source-7moduler/scenario.json \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['scenarioId'])")

echo "Registered scenario: $SCENARIO_ID"
```

> **注意**: 登録済みのシナリオを再利用する場合はこの手順をスキップし、既存の `scenarioId` を使用します。

### Step 2: DataSource の作成

```bash
DS_ID=$(curl -sk -X POST https://localhost/api/data-sources \
  -H 'Content-Type: application/json' \
  -d "{
    \"friendlyName\": \"demo-2source-7moduler-live\",
    \"scenarioId\": \"$SCENARIO_ID\",
    \"sourceType\": \"simulation\"
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

SIMDB_DB_HOST=host.docker.internal
SIMDB_DB_PORT=5432
SIMDB_DB_NAME=factory_simulation
SIMDB_DB_USER=postgres
SIMDB_DB_PASSWORD=postgres
```

### Step 4: simdb-test-driver の起動

```bash
cd test-tools/simdb-test-driver
docker compose up -d simdb-driver
```

### Step 5: WDH データの読み込み

```bash
cp test-tools/scenario/demo-2source-7moduler/wdh-data.zip \
   test-tools/simdb-test-driver/data/demo-2source-7moduler.zip

curl -s -X POST http://localhost:8099/load \
  -H 'Content-Type: application/json' \
  -d '{"type": "zip", "path": "/data/demo-2source-7moduler.zip"}' | jq
```

期待する出力（`state: "loaded"`）：

```json
{
  "state": "loaded",
  "source": "zip:/data/demo-2source-7moduler.zip",
  "current_event_index": 0,
  "total_events": 130942
}
```

### Step 6: 再生速度の設定と再生開始

```bash
# 10倍速で再生
curl -s -X PATCH http://localhost:8099/speed \
  -H 'Content-Type: application/json' \
  -d '{"multiplier": 10.0}' | jq

curl -s -X POST http://localhost:8099/play | jq
```

### Step 7: Visualizer でリアルタイム確認

```
https://localhost/visualizer/?ds=<DS_ID>&live=1
```

- **LIVE ボタン**が赤く点灯していれば WebSocket 接続成功
- source-1（上ライン）と source-2（下ライン）からワークが流れる
- mod-5 でマージ後、mod-6 → mod-7 → drain-1 へ合流して流れる
- モジュラーをダブルクリックすると内部スロットが表示される

### Step 8: 終了処理

再生完了後、DataSource の `endedAt` を設定します。

```bash
END_TIME=$(docker exec factory-simulation-db psql -U postgres factory_simulation -t -c \
  "SELECT MAX(event_time) FROM item_movement WHERE data_source_id='$DS_ID';" | xargs | sed 's/ /T/' | sed 's/+00/Z/')

curl -sk -X PATCH https://localhost/api/data-sources/$DS_ID \
  -H 'Content-Type: application/json' \
  -d "{\"endedAt\": \"$END_TIME\"}" | jq
```

---

## 自動化スクリプト

```bash
bash test-tools/scenario/demo-2source-7moduler/run-live-test.sh [速度倍率]
# 例: bash run-live-test.sh 10.0
```

---

## テストのリセットと再実行

```bash
# ログデータのみリセット
curl -s -X POST http://localhost:8099/reset | jq
curl -sk -X PATCH https://localhost/api/data-sources/$DS_ID \
  -H 'Content-Type: application/json' \
  -d '{"endedAt": null}' | jq
curl -s -X POST http://localhost:8099/play | jq

# 完全リセット（マスタ + ログ）
curl -s -X POST http://localhost:8099/load \
  -H 'Content-Type: application/json' \
  -d '{"type": "zip", "path": "/data/demo-2source-7moduler.zip"}' | jq
```

---

## トラブルシューティング

### mod-5 の入り口が片方しか使われない

source-1 と source-2 のどちらかが停止または遅延している可能性があります。
`http://localhost:8099/status` で再生状態を確認してください。

### Visualizer に「LIVE LOST」と表示される

WebSocket 接続が切れています。以下を確認してください：
1. Gateway コンテナが起動しているか: `docker ps | grep gateway`
2. ブラウザをリロードして再接続

### events API がデータを返さない（空配列）

```bash
curl -sk "https://localhost/api/data-sources/$DS_ID/events?from=1970-01-01T00:00:00.000Z&to=2100-01-01T00:00:00.000Z" \
  | python3 -c "import json,sys; print('events:', len(json.load(sys.stdin)))"
```

---

## シナリオ詳細

### ステーション階層

```
source-1            （source）
source-2            （source）
mod-1               （moduler） entryCount=1
  mod-1.entry-0     （entry）
  mod-1.slot-0〜9   （processing × 10、2.4s加工）
  mod-1.exit-0      （exit）
mod-2               （moduler） ← 同上
mod-3               （moduler） ← 同上
mod-4               （moduler） ← 同上
mod-5               （moduler） entryCount=2
  mod-5.entry-0     （entry） ← mod-3 から
  mod-5.entry-1     （entry） ← mod-4 から
  mod-5.slot-0〜4   （processing × 5、1.0s加工）
  mod-5.exit-0      （exit）
mod-6               （moduler） entryCount=1
  mod-6.entry-0     （entry）
  mod-6.slot-0〜9   （processing × 10、1.0s加工）
  mod-6.exit-0      （exit）
mod-7               （moduler） ← 同上
drain-1             （drain）
```

### 3D レイアウト座標

| ステーション | X座標 | Y座標 |
|---|---|---|
| source-1 | 200 | 300 |
| source-2 | 200 | 700 |
| mod-1 | 800 | 300 |
| mod-2 | 800 | 700 |
| mod-3 | 1600 | 300 |
| mod-4 | 1600 | 700 |
| mod-5 | 2400 | 500 |
| mod-6 | 3200 | 500 |
| mod-7 | 4000 | 500 |
| drain-1 | 4800 | 500 |

### CSV ファイル仕様

| ファイル | ヘッダー |
|---|---|
| location_master.csv | id, name, station_type, parent_location_id, pos_x, pos_y, pos_z, max_capacity, processing_time, merge_count, split_count |
| connection_master.csv | id, from_location_id, to_location_id, condition, from_port_index, to_port_index |
| machine_master.csv | id, location_id, name |
| item_master.csv | id, item_type |
| item_movement.csv | event_time, item_id, from_location_id, to_location_id, movement_type, port_index |
| machine_signal.csv | event_time, machine_id, signal_name, value, old_value, rule_id |

タイムスタンプ形式: `YYYY-MM-DD HH:MM:SS.UUUUUU`（UTC、タイムゾーン表記なし）
