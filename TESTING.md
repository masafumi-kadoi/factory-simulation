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

## 新しいステーション種別のテスト

### テスト1: Merge Station（合流ステーション）

**シナリオ概要:**
2つのSource Stationからワークを生成し、Merge Stationで1つにまとめてDrain Stationで消滅させる。

```
[Source-A] ──┐
             ├─→ [Merge] → [Drain]
[Source-B] ──┘
```

**シナリオ登録:**
```bash
curl -X POST http://localhost:8080/api/scenarios \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Merge Station テスト",
    "stations": [
      {
        "id": "source-a",
        "type": "source",
        "parentId": null,
        "config": {
          "workCount": 1,
          "departureTime": 1.0
        }
      },
      {
        "id": "source-b",
        "type": "source",
        "parentId": null,
        "config": {
          "workCount": 1,
          "departureTime": 1.0
        }
      },
      {
        "id": "merge-1",
        "type": "merge",
        "parentId": null,
        "config": {
          "requiredWorkCount": 2,
          "processingTime": 3.0,
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
      {"from": "source-a", "to": "merge-1"},
      {"from": "source-b", "to": "merge-1"},
      {"from": "merge-1", "to": "drain-1"}
    ]
  }'
```

**シミュレーション実行:**
```bash
curl -X POST http://localhost:8080/api/simulations \
  -H "Content-Type: application/json" \
  -d '{
    "scenarioId": "scenario-3",
    "simulationTime": 100.0,
    "initialConditions": {}
  }'
```

**期待される結果:**
- 2つのワークが生成される（work-001, work-002）
- Merge Stationで2つのワークが1つにまとまる（work-003）
- 新しいワークがDrain Stationで消滅する

**期待されるワークイベント:**
- t=0: WorkCreated (source-a, work-001)
- t=0: WorkCreated (source-b, work-002)
- t=1: WorkDeparted (source-a, work-001)
- t=1: WorkDeparted (source-b, work-002)
- t=3: WorkArrived (merge-1, work-001)
- t=3: WorkArrived (merge-1, work-002)
- t=3: ProcessingStarted (merge-1)
- t=6: ProcessingCompleted (merge-1)
- t=6: WorkMerged (merge-1, work-003)
- t=7: WorkDeparted (merge-1, work-003)
- t=9: WorkArrived (drain-1, work-003)
- t=9: WorkDestroyed (drain-1, work-003)

---

### テスト2: Split Station（分割ステーション）

**シナリオ概要:**
1つのワークを2つに分割する。

```
[Source] → [Split] ──┬─→ [Drain-A]
                     └─→ [Drain-B]
```

**シナリオ登録:**
```bash
curl -X POST http://localhost:8080/api/scenarios \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Split Station テスト",
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
        "id": "split-1",
        "type": "split",
        "parentId": null,
        "config": {
          "outputWorkCount": 2,
          "processingTime": 3.0,
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
      {"from": "source-1", "to": "split-1"},
      {"from": "split-1", "to": "drain-1"}
    ]
  }'
```

**シミュレーション実行:**
```bash
curl -X POST http://localhost:8080/api/simulations \
  -H "Content-Type: application/json" \
  -d '{
    "scenarioId": "scenario-4",
    "simulationTime": 100.0,
    "initialConditions": {}
  }'
```

**期待される結果:**
- 1つのワークが生成される（work-001）
- Split Stationで2つのワークに分割される（work-002, work-003）
- 2つのワークが順次Drain Stationで消滅する

**期待されるワークイベント:**
- t=0: WorkCreated (source-1, work-001)
- t=1: WorkDeparted (source-1, work-001)
- t=3: WorkArrived (split-1, work-001)
- t=3: ProcessingStarted (split-1, work-001)
- t=6: ProcessingCompleted (split-1)
- t=6: WorkSplit (split-1, work-001)
- t=7: WorkDeparted (split-1, work-002)
- t=9: WorkArrived (drain-1, work-002)
- t=9: WorkDestroyed (drain-1, work-002)
- t=8: WorkDeparted (split-1, work-003)
- t=10: WorkArrived (drain-1, work-003)
- t=10: WorkDestroyed (drain-1, work-003)

---

### テスト3: Inspection Station（検査ステーション）

**シナリオ概要:**
ワークを検査してOK/NGを判定する（確率90%でOK）。

```
[Source] → [Inspection] → [Drain]
```

**シナリオ登録:**
```bash
curl -X POST http://localhost:8080/api/scenarios \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Inspection Station テスト",
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
        "id": "inspection-1",
        "type": "inspection",
        "parentId": null,
        "config": {
          "processingTime": 3.0,
          "arrivalTime": 2.0,
          "departureTime": 1.0,
          "okProbability": 0.9
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
      {"from": "source-1", "to": "inspection-1"},
      {"from": "inspection-1", "to": "drain-1"}
    ]
  }'
```

**シミュレーション実行:**
```bash
curl -X POST http://localhost:8080/api/simulations \
  -H "Content-Type: application/json" \
  -d '{
    "scenarioId": "scenario-5",
    "simulationTime": 100.0,
    "initialConditions": {}
  }'
```

**期待される結果:**
- 1つのワークが生成される（work-001）
- Inspection Stationで品質ステータスが設定される（90%の確率でOK、10%の確率でNG）
- ワークがDrain Stationで消滅する

**期待されるワークイベント:**
- t=0: WorkCreated (source-1, work-001)
- t=1: WorkDeparted (source-1, work-001)
- t=3: WorkArrived (inspection-1, work-001)
- t=3: ProcessingStarted (inspection-1, work-001)
- t=6: ProcessingCompleted (inspection-1)
- t=6: WorkInspected (inspection-1, work-001) ← 品質ステータスが設定される
- t=7: WorkDeparted (inspection-1, work-001)
- t=9: WorkArrived (drain-1, work-001)
- t=9: WorkDestroyed (drain-1, work-001)

---

### テスト4: Discharge Station（振り分けステーション）

**シナリオ概要:**
品質ステータスに応じてOKとNGを別のDrain Stationに振り分ける。

```
                ┌─→ [Drain-OK]
[Source] → [Inspection] → [Discharge]
                           └─→ [Drain-NG]
```

**シナリオ登録:**
```bash
curl -X POST http://localhost:8080/api/scenarios \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Discharge Station テスト",
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
        "id": "inspection-1",
        "type": "inspection",
        "parentId": null,
        "config": {
          "processingTime": 3.0,
          "arrivalTime": 2.0,
          "departureTime": 1.0,
          "okProbability": 0.5
        }
      },
      {
        "id": "discharge-1",
        "type": "discharge",
        "parentId": null,
        "config": {
          "arrivalTime": 2.0,
          "departureTime": 1.0
        }
      },
      {
        "id": "drain-ok",
        "type": "drain",
        "parentId": null,
        "config": {
          "arrivalTime": 2.0
        }
      },
      {
        "id": "drain-ng",
        "type": "drain",
        "parentId": null,
        "config": {
          "arrivalTime": 2.0
        }
      }
    ],
    "connections": [
      {"from": "source-1", "to": "inspection-1"},
      {"from": "inspection-1", "to": "discharge-1"},
      {"from": "discharge-1", "to": "drain-ok"},
      {"from": "discharge-1", "to": "drain-ng"}
    ]
  }'
```

**シミュレーション実行:**
```bash
curl -X POST http://localhost:8080/api/simulations \
  -H "Content-Type: application/json" \
  -d '{
    "scenarioId": "scenario-6",
    "simulationTime": 100.0,
    "initialConditions": {}
  }'
```

**期待される結果:**
- 1つのワークが生成される（work-001）
- Inspection Stationで品質ステータスが設定される（50%の確率でOK、50%の確率でNG）
- Discharge StationでOKなら drain-ok へ、NGなら drain-ng へ振り分けられる

**期待されるワークイベント（OKの場合）:**
- t=0: WorkCreated (source-1, work-001)
- t=1: WorkDeparted (source-1, work-001)
- t=3: WorkArrived (inspection-1, work-001)
- t=3: ProcessingStarted (inspection-1, work-001)
- t=6: ProcessingCompleted (inspection-1)
- t=6: WorkInspected (inspection-1, work-001) ← qualityStatus=OK
- t=7: WorkDeparted (inspection-1, work-001)
- t=9: WorkArrived (discharge-1, work-001)
- t=9: WorkRouted (discharge-1, work-001)
- t=10: WorkDeparted (discharge-1, work-001)
- t=12: WorkArrived (drain-ok, work-001)
- t=12: WorkDestroyed (drain-ok, work-001)

---

### テスト5: 複合シナリオ（全ステーション種別を組み合わせ）

**シナリオ概要:**
全てのステーション種別を使った複雑なシミュレーション。

```
[Source-A] ──┐
             ├─→ [Merge] → [Split] ──┬─→ [Inspection-A] ──┐
[Source-B] ──┘                       │                      ├─→ [Discharge] ─┬─→ [Drain-OK]
                                     └─→ [Inspection-B] ──┘                  └─→ [Drain-NG]
```

**シナリオ登録:**
```bash
curl -X POST http://localhost:8080/api/scenarios \
  -H "Content-Type: application/json" \
  -d '{
    "name": "複合シナリオ",
    "stations": [
      {
        "id": "source-a",
        "type": "source",
        "parentId": null,
        "config": {
          "workCount": 1,
          "departureTime": 1.0
        }
      },
      {
        "id": "source-b",
        "type": "source",
        "parentId": null,
        "config": {
          "workCount": 1,
          "departureTime": 1.0
        }
      },
      {
        "id": "merge-1",
        "type": "merge",
        "parentId": null,
        "config": {
          "requiredWorkCount": 2,
          "processingTime": 3.0,
          "arrivalTime": 2.0,
          "departureTime": 1.0
        }
      },
      {
        "id": "split-1",
        "type": "split",
        "parentId": null,
        "config": {
          "outputWorkCount": 2,
          "processingTime": 3.0,
          "arrivalTime": 2.0,
          "departureTime": 1.0
        }
      },
      {
        "id": "inspection-a",
        "type": "inspection",
        "parentId": null,
        "config": {
          "processingTime": 2.0,
          "arrivalTime": 2.0,
          "departureTime": 1.0,
          "okProbability": 0.7
        }
      },
      {
        "id": "inspection-b",
        "type": "inspection",
        "parentId": null,
        "config": {
          "processingTime": 2.0,
          "arrivalTime": 2.0,
          "departureTime": 1.0,
          "okProbability": 0.7
        }
      },
      {
        "id": "discharge-1",
        "type": "discharge",
        "parentId": null,
        "config": {
          "arrivalTime": 2.0,
          "departureTime": 1.0
        }
      },
      {
        "id": "drain-ok",
        "type": "drain",
        "parentId": null,
        "config": {
          "arrivalTime": 2.0
        }
      },
      {
        "id": "drain-ng",
        "type": "drain",
        "parentId": null,
        "config": {
          "arrivalTime": 2.0
        }
      }
    ],
    "connections": [
      {"from": "source-a", "to": "merge-1"},
      {"from": "source-b", "to": "merge-1"},
      {"from": "merge-1", "to": "split-1"},
      {"from": "split-1", "to": "inspection-a"},
      {"from": "split-1", "to": "inspection-b"},
      {"from": "inspection-a", "to": "discharge-1"},
      {"from": "inspection-b", "to": "discharge-1"},
      {"from": "discharge-1", "to": "drain-ok"},
      {"from": "discharge-1", "to": "drain-ng"}
    ]
  }'
```

**注意:** Splitステーションからの接続が正しく動作するように、上記のconnectionsは両方のワークがinspection-aに向かうように設定しています。実際の実装では、Splitステーションは最初の接続先にすべてのワークを送ります。

**シミュレーション実行:**
```bash
curl -X POST http://localhost:8080/api/simulations \
  -H "Content-Type: application/json" \
  -d '{
    "scenarioId": "scenario-7",
    "simulationTime": 100.0,
    "initialConditions": {}
  }'
```

**期待される結果:**
- 2つのワークが生成される（work-001, work-002）
- Merge Stationで1つにまとまる（work-003）
- Split Stationで2つに分割される（work-004, work-005）
- 各ワークがInspection Stationで検査される
- Discharge Stationで品質ステータスに応じて振り分けられる

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
