# Simulation Core 動作確認手順

## 前提条件

- Docker がインストールされている
- Docker Compose がインストールされている
- ターミナルが使用できる

## ステップ1: システムの起動

### 1-1. プロジェクトディレクトリに移動

```bash
cd factory-simulation
```

### 1-2. Docker Composeでシステムを起動

```bash
docker compose up -d
```

**期待される出力:**
```
✔ Container factory-simulation-db    Started
✔ Container factory-simulation-core  Started
```

### 1-3. システムの起動確認

```bash
# PostgreSQLの確認
docker compose ps postgres

# Simulation Coreの確認
docker compose ps simulation-core
```

**期待される出力:**
両方のコンテナが `running` (healthy) 状態であること。

### 1-4. ログの確認

```bash
# Simulation Coreのログを確認
docker compose logs simulation-core

# 以下のようなログが表示されればOK
# Connecting to database...
# Database connection established
# Server started successfully
# Starting server on port 8080...
```

---

## ステップ2: シナリオの登録

### 2-1. 基本テストシナリオを登録

```bash
curl -X POST http://localhost:8080/api/scenarios \
  -H "Content-Type: application/json" \
  -d '{
    "name": "基本テストシナリオ",
    "stations": [
      {
        "id": "source-1",
        "type": "source",
        "parentId": null,
        "config": {
          "workCount": 1,
          "departureTime": 1.0
        }
      },
      {
        "id": "process-1",
        "type": "processing",
        "parentId": null,
        "config": {
          "processingTime": 5.0,
          "arrivalTime": 2.0,
          "departureTime": 1.0
        }
      },
      {
        "id": "drain-1",
        "type": "drain",
        "parentId": null,
        "config": {
          "arrivalTime": 2.0
        }
      }
    ],
    "connections": [
      {"from": "source-1", "to": "process-1"},
      {"from": "process-1", "to": "drain-1"}
    ]
  }'
```

**期待される出力:**
```json
{"scenarioId":"scenario-1"}
```

**シナリオの説明:**
- `source-1`: ワークを1個生成するSource Station
- `process-1`: 処理時間5秒のProcessing Station
- `drain-1`: ワークを消滅させるDrain Station
- 流れ: source-1 → process-1 → drain-1

---

## ステップ3: シミュレーションの実行

### 3-1. シミュレーションを実行

```bash
curl -X POST http://localhost:8080/api/simulations \
  -H "Content-Type: application/json" \
  -d '{
    "scenarioId": "scenario-1",
    "simulationTime": 100.0,
    "initialConditions": {}
  }'
```

**期待される出力:**
```json
{
  "simulationId": "sim-1",
  "status": "completed",
  "endTime": 11,
  "endReason": "event_exhausted"
}
```

**確認ポイント:**
- ✅ `status` が `"completed"` であること
- ✅ `endTime` が `11` であること（予想通りの終了時刻）
- ✅ `endReason` が `"event_exhausted"` であること（イベント枯渇で終了）

---

## ステップ4: シミュレーション結果の取得

### 4-1. 結果サマリーを取得

```bash
curl http://localhost:8080/api/simulations/sim-1
```

**期待される出力:**
```json
{
  "simulationId": "sim-1",
  "scenarioId": "scenario-1",
  "status": "completed",
  "startTime": 0,
  "endTime": 11,
  "endReason": "event_exhausted",
  "summary": {
    "totalWorksCreated": 0,
    "totalWorksDestroyed": 0,
    "totalEvents": 0
  }
}
```

### 4-2. 結果を見やすく表示（Pythonを使用）

```bash
curl -s http://localhost:8080/api/simulations/sim-1 | python3 -m json.tool
```

---

## ステップ5: 詳細ログの確認

### 5-1. ワークイベントログを取得

```bash
curl -s http://localhost:8080/api/simulations/sim-1/logs | \
  python3 -c "import sys, json; data=json.load(sys.stdin); print(json.dumps(data['workEvents'], indent=2, ensure_ascii=False))"
```

**期待される出力:**
```json
[
  {
    "WorkID": "work-001",
    "StationID": "source-1",
    "Timestamp": 0,
    "EventType": "WorkCreated"
  },
  {
    "WorkID": "work-001",
    "StationID": "source-1",
    "Timestamp": 1,
    "EventType": "WorkDeparted"
  },
  {
    "WorkID": "work-001",
    "StationID": "process-1",
    "Timestamp": 3,
    "EventType": "WorkArrived"
  },
  {
    "WorkID": "work-001",
    "StationID": "process-1",
    "Timestamp": 3,
    "EventType": "ProcessingStarted"
  },
  {
    "WorkID": "work-001",
    "StationID": "process-1",
    "Timestamp": 8,
    "EventType": "ProcessingCompleted"
  },
  {
    "WorkID": "work-001",
    "StationID": "process-1",
    "Timestamp": 9,
    "EventType": "WorkDeparted"
  },
  {
    "WorkID": "work-001",
    "StationID": "drain-1",
    "Timestamp": 11,
    "EventType": "WorkArrived"
  },
  {
    "WorkID": "work-001",
    "StationID": "drain-1",
    "Timestamp": 11,
    "EventType": "WorkDestroyed"
  }
]
```

**確認ポイント（期待値との照合）:**
- ✅ t=0: Source Stationがwork-001を生成
- ✅ t=1: ワークがProcessing Stationに向けて出発
- ✅ t=3: ワークがProcessing Stationに到着、処理開始
- ✅ t=8: 処理完了（処理時間5秒）
- ✅ t=9: ワークがDrain Stationに向けて出発
- ✅ t=11: ワークがDrain Stationに到着、消滅

### 5-2. ステーションステータスログを取得

```bash
curl -s http://localhost:8080/api/simulations/sim-1/logs | \
  python3 -c "import sys, json; data=json.load(sys.stdin); print(json.dumps(data['stationStatusLogs'], indent=2, ensure_ascii=False))"
```

**期待される内容:**
- 搬入可ON/OFF
- 搬出可ON/OFF
- 処理条件成立
- 処理開始
- 処理完了

などのステータス変更が時系列で記録されている。

---

## ステップ6: PostgreSQLのデータ確認（オプション）

### 6-1. PostgreSQLコンテナに接続

```bash
docker compose exec postgres psql -U postgres -d factory_simulation
```

### 6-2. テーブルの確認

```sql
-- シミュレーション実行一覧
SELECT * FROM simulation_runs;

-- ステーションステータスログ（最初の10件）
SELECT * FROM station_status_logs ORDER BY timestamp LIMIT 10;

-- ワークイベントログ
SELECT * FROM work_events ORDER BY timestamp;

-- PostgreSQLから抜ける
\q
```

---

## ステップ7: システムの停止

### 7-1. コンテナを停止

```bash
docker compose down
```

### 7-2. データベースも含めて完全に削除（次回クリーンスタート）

```bash
docker compose down -v
```

**注意:** `-v` オプションを付けるとデータベースのボリュームも削除されます。

---

## トラブルシューティング

### エラー: "connection refused"

**症状:**
```
curl: (7) Failed to connect to localhost port 8080
```

**対処法:**
```bash
# コンテナの状態を確認
docker compose ps

# simulation-coreのログを確認
docker compose logs simulation-core

# 必要に応じて再起動
docker compose restart simulation-core
```

### エラー: "relation does not exist"

**症状:**
```json
{"code":500,"message":"relation \"simulation_runs\" does not exist"}
```

**対処法:**
データベースを再初期化します。

```bash
# ボリュームごと削除して再作成
docker compose down -v
docker compose up -d

# テーブルが作成されたか確認
docker compose logs postgres | grep "CREATE TABLE"
```

### ポートが既に使用されている

**症状:**
```
Error: port is already allocated
```

**対処法:**
```bash
# 8080ポートを使用しているプロセスを確認
lsof -i :8080

# 5432ポートを使用しているプロセスを確認
lsof -i :5432

# 他のプロセスを停止するか、docker-compose.ymlのポート番号を変更
```

### コンテナが起動しない

**対処法:**
```bash
# ログを詳しく確認
docker compose logs

# 特定のサービスのログを確認
docker compose logs postgres
docker compose logs simulation-core

# イメージを再ビルド
docker compose build --no-cache
docker compose up -d
```

---

## 追加テスト: 複数ワークのシミュレーション

より複雑なシナリオをテストしたい場合、ワーク数を増やすことができます。

```bash
# ワーク3個のシナリオを登録
curl -X POST http://localhost:8080/api/scenarios \
  -H "Content-Type: application/json" \
  -d '{
    "name": "複数ワークシナリオ",
    "stations": [
      {
        "id": "source-2",
        "type": "source",
        "parentId": null,
        "config": {
          "workCount": 3,
          "departureTime": 1.0
        }
      },
      {
        "id": "process-2",
        "type": "processing",
        "parentId": null,
        "config": {
          "processingTime": 5.0,
          "arrivalTime": 2.0,
          "departureTime": 1.0
        }
      },
      {
        "id": "drain-2",
        "type": "drain",
        "parentId": null,
        "config": {
          "arrivalTime": 2.0
        }
      }
    ],
    "connections": [
      {"from": "source-2", "to": "process-2"},
      {"from": "process-2", "to": "drain-2"}
    ]
  }'

# シミュレーション実行
curl -X POST http://localhost:8080/api/simulations \
  -H "Content-Type: application/json" \
  -d '{
    "scenarioId": "scenario-2",
    "simulationTime": 100.0,
    "initialConditions": {}
  }'
```

**期待される動作:**
- work-001, work-002, work-003 が順次処理される
- 各ワークが処理されるごとに時間が経過
- すべてのワークがDrain Stationで消滅したらシミュレーション終了

---

## チェックリスト

動作確認が完了したら、以下をチェックしてください：

- [ ] Docker Composeでシステムが起動できた
- [ ] シナリオ登録APIが正常に動作した
- [ ] シミュレーション実行APIが正常に動作した
- [ ] シミュレーション結果取得APIが正常に動作した
- [ ] ログ取得APIが正常に動作した
- [ ] ワークイベントが期待通りの時刻で発生した（t=0, 1, 3, 8, 9, 11）
- [ ] PostgreSQLにデータが正しく保存された
- [ ] システムを停止できた

すべてチェックが付いたら、Simulation Coreの初期実装が正常に動作していることが確認できました！ 🎉
