# Factory Simulation - テスト・動作確認ガイド

## 目次
1. [概要](#概要)
2. [システム起動](#システム起動)
3. [基本動作確認](#基本動作確認)
4. [自動テストの実行](#自動テストの実行)
5. [インターロック機構の確認](#インターロック機構の確認)
6. [3D可視化の確認](#3d可視化の確認)
7. [トラブルシューティング](#トラブルシューティング)

---

## 概要

### システムアーキテクチャ

Factory Simulationは**インターロック制御方式**を採用した離散イベントシミュレーションシステムです。

**重要な設計原則:**
- **1ステーション1ワーク**: 各ステーションは同時に1つのワークのみ保持
- **インターロック機構**: 搬入可・搬出可の2信号で制御
- **逐次処理**: ワークは並列処理されず、1つずつ順番に処理

### ステーション種別（現在実装済み）

| 種別 | 役割 | 特徴 |
|------|------|------|
| **Source** | ワーク生成 | 指定個数のワークを逐次生成 |
| **Processing** | 処理（基底クラス） | 1ワークを受け取り、処理して送出 |
| **Drain** | ワーク消滅 | ワークを破棄して終了 |

### インターロック信号

各ステーションは2つの信号を持ちます：

| 信号 | 意味 | ONの条件 |
|------|------|----------|
| **搬入可 (InputReady)** | ワークを受け入れ可能 | `State == Idle && CurrentWork == nil` |
| **搬出可 (OutputReady)** | ワークを送出可能 | `State == Completed && CurrentWork != nil` |

**ワーク移動の条件:**
- 送出側の「搬出可」がON **かつ** 受入側の「搬入可」がONの時のみワークが移動します
- これにより、複数ワークの同時流入を防ぎ、1ステーション1ワークを保証します

---

## システム起動

### 前提条件

- Docker がインストールされている
- Docker Compose がインストールされている
- ポート 8080 (API), 8081 (可視化), 5432 (PostgreSQL) が空いている

### 起動手順

```bash
# プロジェクトディレクトリに移動
cd factory-simulation

# Docker Composeでシステムを起動
docker-compose up -d
```

**期待される出力:**
```
✔ Container factory-simulation-db      Started
✔ Container factory-simulation-core    Started
✔ Container factory-sim-visualizer     Started
```

### 起動確認

```bash
# コンテナの状態確認
docker-compose ps

# APIの疎通確認
curl http://localhost:8080/api/scenarios

# 可視化サーバーの確認
curl -I http://localhost:8081
```

すべて正常にレスポンスが返れば起動成功です。

---

## 基本動作確認

### ステップ1: シンプルなシナリオを登録

**シナリオ構成:**
```
[Source] → [Drain]
```

最もシンプルな構成で、ワークが生成されて即座に消滅します。

```bash
curl -X POST http://localhost:8080/api/scenarios \
  -H "Content-Type: application/json" \
  -d '{
    "name": "基本テスト - Source to Drain",
    "stations": [
      {
        "id": "source-1",
        "type": "source",
        "config": {
          "workCount": 3,
          "departureTime": 2.0
        }
      },
      {
        "id": "drain-1",
        "type": "drain",
        "config": {
          "arrivalTime": 1.0
        }
      }
    ],
    "connections": [
      {"from": "source-1", "to": "drain-1"}
    ]
  }'
```

**期待されるレスポンス:**
```json
{
  "scenarioId": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
}
```

シナリオIDをメモしてください（次のステップで使用）。

### ステップ2: シミュレーション実行

```bash
# シナリオIDを環境変数に設定（上記で取得したIDに置き換え）
SCENARIO_ID="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"

# シミュレーション実行
curl -X POST http://localhost:8080/api/simulations \
  -H "Content-Type: application/json" \
  -d "{
    \"scenarioId\": \"$SCENARIO_ID\",
    \"simulationTime\": 50.0,
    \"initialConditions\": {}
  }" | jq
```

**期待されるレスポンス:**
```json
{
  "simulationId": "yyyyyyyy-yyyy-yyyy-yyyy-yyyyyyyyyyyy",
  "friendlyName": "基本テスト - Source to Drain_実行_2026-02-10T...",
  "status": "completed",
  "endTime": 9.0,
  "endReason": "event_exhausted"
}
```

**確認ポイント:**
- ✅ `status` が `"completed"` であること
- ✅ `endReason` が `"event_exhausted"` であること（イベント枯渇で正常終了）
- ✅ `endTime` が妥当な値であること（この例では約9秒）

### ステップ3: ワークイベントログの確認

```bash
# シミュレーションIDを設定（上記で取得したIDに置き換え）
SIM_ID="yyyyyyyy-yyyy-yyyy-yyyy-yyyyyyyyyyyy"

# ワークイベントログを取得
curl -s "http://localhost:8080/api/simulations/$SIM_ID/logs" | \
  jq '.workEvents'
```

**期待されるイベント（3ワークの場合）:**

```json
[
  {"workId": "...", "workFriendlyName": "work-1", "stationId": "source-1", "timestamp": 0, "eventType": "WorkCreated"},
  {"workId": "...", "workFriendlyName": "work-1", "stationId": "source-1", "timestamp": 2, "eventType": "WorkDeparted"},
  {"workId": "...", "workFriendlyName": "work-1", "stationId": "drain-1", "timestamp": 3, "eventType": "WorkArrived"},
  {"workId": "...", "workFriendlyName": "work-1", "stationId": "drain-1", "timestamp": 3, "eventType": "WorkDestroyed"},

  {"workId": "...", "workFriendlyName": "work-2", "stationId": "source-1", "timestamp": 2, "eventType": "WorkCreated"},
  {"workId": "...", "workFriendlyName": "work-2", "stationId": "source-1", "timestamp": 4, "eventType": "WorkDeparted"},
  {"workId": "...", "workFriendlyName": "work-2", "stationId": "drain-1", "timestamp": 5, "eventType": "WorkArrived"},
  {"workId": "...", "workFriendlyName": "work-2", "stationId": "drain-1", "timestamp": 5, "eventType": "WorkDestroyed"},

  {"workId": "...", "workFriendlyName": "work-3", "stationId": "source-1", "timestamp": 4, "eventType": "WorkCreated"},
  {"workId": "...", "workFriendlyName": "work-3", "stationId": "source-1", "timestamp": 6, "eventType": "WorkDeparted"},
  {"workId": "...", "workFriendlyName": "work-3", "stationId": "drain-1", "timestamp": 7, "eventType": "WorkArrived"},
  {"workId": "...", "workFriendlyName": "work-3", "stationId": "drain-1", "timestamp": 7, "eventType": "WorkDestroyed"}
]
```

**確認ポイント:**
- ✅ ワークが逐次生成されている（t=0, 2, 4）
- ✅ 各ワークが `Created → Departed → Arrived → Destroyed` のライフサイクルを持つ
- ✅ ワークが重複して存在していない（1ステーション1ワーク）

---

## 自動テストの実行

### テストスイート概要

`simulation-core/test/` ディレクトリにテストシナリオが格納されています。

**現在のテストケース:**

| ファイル | テスト内容 | ワーク数 | 主な確認項目 |
|----------|-----------|----------|--------------|
| `01_basic_test.json` | Source → Drain | 3 | 基本的なワークフロー |
| `02_processing_test.json` | Source → Processing → Drain | 3 | 処理ステーションの動作、インターロック |
| `07_stress_test.json` | Source → Processing → Drain | 20 | 大量ワークの処理、負荷テスト |

### テスト実行方法

```bash
# テストディレクトリに移動
cd simulation-core/test

# 全テスト実行
bash run_all_tests.sh
```

**期待される出力（全テスト成功時）:**

```
===========================================
  Factory Simulation - Test Suite
===========================================

Running test: 01_basic_test.json
  Scenario ID: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
  Simulation ID: yyyyyyyy-yyyy-yyyy-yyyy-yyyyyyyyyyyy
  Status: completed
  Work Events: 12
✓ PASS

Running test: 02_processing_test.json
  Scenario ID: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
  Simulation ID: yyyyyyyy-yyyy-yyyy-yyyy-yyyyyyyyyyyy
  Status: completed
  Work Events: 24
✓ PASS

Running test: 07_stress_test.json
  Scenario ID: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
  Simulation ID: yyyyyyyy-yyyy-yyyy-yyyy-yyyyyyyyyyyy
  Status: completed
  Work Events: 160
✓ PASS

===========================================
  Test Results Summary
===========================================

Total tests: 3
Passed: 3
Failed: 0

===========================================
```

### テストシナリオ詳細

#### テスト1: 基本テスト (01_basic_test.json)

**構成:**
```
[Source] → [Drain]
```

**パラメータ:**
- ワーク数: 3個
- Source出発間隔: 2.0秒
- 到着時間: 1.0秒

**期待される動作:**
- 3つのワークが逐次生成される
- 各ワークがDrainで消滅する
- 全ワークイベント数: 12 (各ワーク4イベント × 3)

#### テスト2: Processing テスト (02_processing_test.json)

**構成:**
```
[Source] → [Processing] → [Drain]
```

**パラメータ:**
- ワーク数: 3個
- Source出発間隔: 5.0秒（インターロック違反防止のため長め）
- Processing処理時間: 2.0秒
- 到着・出発時間: 各1.0秒

**期待される動作:**
- 3つのワークが逐次生成される
- 各ワークがProcessingステーションで2秒間処理される
- インターロック機構により、次のワークはProcessingが空くまで待機
- 全ワークイベント数: 24 (各ワーク8イベント × 3)

**確認ポイント:**
- ✅ Processingステーションで `WorkArrived → ProcessingStarted → ProcessingCompleted → WorkDeparted` のフローが発生
- ✅ インターロック違反が発生しない（エラーログなし）
- ✅ ワークが重複してProcessingに入らない

#### テスト3: ストレステスト (07_stress_test.json)

**構成:**
```
[Source] → [Processing] → [Drain]
```

**パラメータ:**
- ワーク数: 20個
- Source出発間隔: 2.0秒
- Processing処理時間: 0.5秒
- 到着・出発時間: 各0.5秒

**期待される動作:**
- 20個のワークが逐次生成・処理される
- 高速処理でもインターロック機構が正常に動作する
- 全ワークイベント数: 160 (各ワーク8イベント × 20)

**確認ポイント:**
- ✅ 大量ワークでもシミュレーションが完走する
- ✅ メモリリークやパフォーマンス劣化がない
- ✅ すべてのワークが正しく処理・破棄される

---

## インターロック機構の確認

### インターロック違反のシミュレーション（意図的な失敗）

インターロック機構が正しく動作していることを確認するため、意図的に違反させてみます。

**問題のあるシナリオ:**
```json
{
  "name": "インターロック違反テスト（失敗するはず）",
  "stations": [
    {
      "id": "source-1",
      "type": "source",
      "config": {
        "workCount": 2,
        "departureTime": 0.5
      }
    },
    {
      "id": "processing-1",
      "type": "processing",
      "config": {
        "processingTime": 2.0,
        "arrivalTime": 0.5,
        "departureTime": 0.5
      }
    },
    {
      "id": "drain-1",
      "type": "drain",
      "config": {
        "arrivalTime": 0.5
      }
    }
  ],
  "connections": [
    {"from": "source-1", "to": "processing-1"},
    {"from": "processing-1", "to": "drain-1"}
  ]
}
```

**問題点:**
- `departureTime: 0.5` は短すぎる
- Processingの処理サイクル時間（2.0 + 0.5 + 0.5 = 3.0秒）より短い
- 2つ目のワークがProcessingステーションに到着した時、まだ1つ目が処理中

**期待されるエラー:**
```json
{
  "code": 500,
  "message": "Simulation failed: interlock violation: next station processing-1 InputReady=OFF (state=processing), cannot send work"
}
```

このエラーが出れば、インターロック機構が正しく動作しています。

### 正しいタイミング設計

**処理サイクル時間の計算:**
```
サイクル時間 = arrivalTime + processingTime + departureTime
```

**Source の departureTime 設定:**
```
departureTime >= (次ステーションのサイクル時間)
```

例: Processingステーションのサイクル時間が3.0秒なら、
```json
{
  "id": "source-1",
  "config": {
    "departureTime": 3.0  // 3.0秒以上に設定
  }
}
```

これにより、次のワークが到着する前に前のワークが完全に処理されます。

---

## 3D可視化の確認

### 可視化サーバーへのアクセス

シミュレーション実行後、3D可視化で結果を確認できます。

```bash
# シミュレーション実行（前述の手順でIDを取得）
SIM_ID="yyyyyyyy-yyyy-yyyy-yyyy-yyyyyyyyyyyy"

# ブラウザで開く
open "http://localhost:8081?sim=$SIM_ID"
# または
# Windowsの場合: start http://localhost:8081?sim=%SIM_ID%
```

### 可視化画面の操作

**マウス操作:**
- 左ドラッグ: 視点回転
- ホイール: ズームイン/アウト
- 右ドラッグ: パン（視点移動）

**コントロール:**
- ▶ (Play): シミュレーション再生
- ⏸ (Pause): 一時停止
- 🔄 (Reset): 最初に戻る
- Speed: 再生速度調整（0.5x, 1x, 2x, 4x）

### 確認ポイント

**ステーション表示:**
- Source: 緑色の円柱
- Processing: 青色の円柱
- Drain: 赤色の円柱

**ワーク表示:**
- 小さな球体として表示
- ステーション間をスムーズに移動
- 同時に複数のワークがステーション内に存在しない（1ステーション1ワーク）

**動作確認:**
- ✅ ワークがステーション間をスムーズに移動する
- ✅ Processingステーションでワークが停止（処理中）する
- ✅ 複数ワークが同時にステーション内に存在しない
- ✅ タイムスタンプが正しく進む

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
docker-compose ps

# simulation-coreのログを確認
docker-compose logs simulation-core

# 必要に応じて再起動
docker-compose restart simulation-core

# それでもダメならビルドから
docker-compose down
docker-compose build --no-cache
docker-compose up -d
```

### エラー: "interlock violation"

**症状:**
```json
{
  "code": 500,
  "message": "Simulation failed: interlock violation: ..."
}
```

**原因:**
- Source の `departureTime` が短すぎる
- 次ステーションの処理サイクル時間より短い間隔でワークを送出している

**対処法:**
```json
{
  "config": {
    "departureTime": 5.0  // より長い値に設定
  }
}
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
docker-compose down -v
docker-compose up -d

# マイグレーションが自動実行されるまで少し待つ
sleep 5

# テーブルが作成されたか確認
docker-compose exec postgres psql -U postgres -d factory_simulation -c "\dt"
```

### テストが失敗する

**症状:**
```
Failed: X
```

**対処法:**

1. **詳細なエラーメッセージを確認:**
   ```bash
   cd simulation-core/test
   bash run_all_tests.sh 2>&1 | tee test-results.log
   cat test-results.log
   ```

2. **個別にテスト実行:**
   ```bash
   # シナリオ登録
   curl -X POST http://localhost:8080/api/scenarios \
     -H "Content-Type: application/json" \
     -d @01_basic_test.json

   # レスポンスを確認してシナリオIDを取得

   # シミュレーション実行
   curl -X POST http://localhost:8080/api/simulations \
     -H "Content-Type: application/json" \
     -d '{"scenarioId": "...", "simulationTime": 100.0, "initialConditions": {}}'
   ```

3. **ログを確認:**
   ```bash
   docker-compose logs simulation-core | tail -100
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

# 8081ポートを使用しているプロセスを確認
lsof -i :8081

# プロセスを停止するか、docker-compose.ymlのポート番号を変更
```

---

## PostgreSQLのデータ確認（上級者向け）

### データベースに接続

```bash
docker-compose exec postgres psql -U postgres -d factory_simulation
```

### テーブル一覧表示

```sql
\dt
```

**期待される出力:**
```
                   List of relations
 Schema |         Name          | Type  |  Owner
--------+-----------------------+-------+----------
 public | scenarios             | table | postgres
 public | simulation_runs       | table | postgres
 public | station_status_logs   | table | postgres
 public | work_events           | table | postgres
 public | work_lineage          | table | postgres
```

### データ確認クエリ

```sql
-- シミュレーション実行一覧
SELECT simulation_id, friendly_name, status, end_time
FROM simulation_runs
ORDER BY created_at DESC
LIMIT 5;

-- 特定シミュレーションのワークイベント
SELECT work_friendly_name, station_id, timestamp, event_type
FROM work_events
WHERE simulation_id = 'your-simulation-id'
ORDER BY timestamp;

-- ステーションごとのワーク処理数
SELECT station_id, COUNT(*) as work_count
FROM work_events
WHERE simulation_id = 'your-simulation-id'
  AND event_type = 'WorkArrived'
GROUP BY station_id;

-- PostgreSQLから抜ける
\q
```

---

## チェックリスト

動作確認が完了したら、以下をチェックしてください：

### システム起動
- [ ] Docker Composeでシステムが起動できた
- [ ] 3つのコンテナ（db, simulation-core, sim-visualizer）が全て起動している
- [ ] APIにアクセスできる（http://localhost:8080）
- [ ] 可視化サーバーにアクセスできる（http://localhost:8081）

### 基本動作
- [ ] シナリオ登録APIが正常に動作した
- [ ] シミュレーション実行APIが正常に動作した
- [ ] シミュレーション結果取得APIが正常に動作した
- [ ] ログ取得APIが正常に動作した

### 自動テスト
- [ ] 全テストがPASSした（3/3）
- [ ] ワークイベントが期待通りの時刻で発生した
- [ ] インターロック違反が発生していない

### インターロック機構
- [ ] 1ステーション1ワークが保証されている
- [ ] 搬入可・搬出可の信号制御が動作している
- [ ] ワークの逐次処理が正しく行われている

### 3D可視化
- [ ] シミュレーション結果が3Dで表示される
- [ ] ワークが滑らかに移動する
- [ ] 再生・一時停止・リセット操作ができる
- [ ] 速度調整ができる

### データ永続化
- [ ] PostgreSQLにデータが正しく保存されている
- [ ] シミュレーション結果が再取得できる

すべてチェックが付いたら、Factory Simulationのインターロック機構が正常に動作していることが確認できました！ 🎉

---

## 次のステップ

基本動作確認が完了したら、以下を試してみてください：

1. **独自シナリオの作成**: より複雑なステーション構成を設計
2. **パラメータチューニング**: 処理時間や到着時間を調整して最適化
3. **ステーション種別の追加**: Merge, Split, Inspection, Dischargeの実装（今後の課題）

---

## 関連ドキュメント

- `README.md` - システム概要とクイックスタート
- `docs/architecture.md` - アーキテクチャ設計書（未作成）
- `simulation-core/internal/domain/station.go` - ステーション実装
- `simulation-core/internal/simulation/engine.go` - シミュレーションエンジン実装
