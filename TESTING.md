# Factory Simulation - テスト・動作確認ガイド

## 目次
1. [概要](#概要)
2. [システム起動](#システム起動)
3. [基本動作確認](#基本動作確認)
4. [自動テストの実行](#自動テストの実行)
5. [インターロック機構の確認](#インターロック機構の確認)
6. [各ツールの動作確認](#各ツールの動作確認)
7. [3D可視化の確認](#3d可視化の確認)
8. [トラブルシューティング](#トラブルシューティング)

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
- 以下のポートが空いている:

| ポート | サービス |
|--------|---------|
| 5432 | PostgreSQL |
| 8080 | simulation-core (API) |
| 8081 | sim-visualizer |
| 8082 | sim-editor |
| 8083 | sim-executor (Frontend) |
| 8084 | sim-executor-backend (API) |
| 8085 | sim-portal |

### 起動手順

```bash
# プロジェクトディレクトリに移動
cd factory-simulation

# Docker Composeでシステムを起動
docker-compose up -d
```

**期待される出力:**
```
✔ Container factory-simulation-db          Started
✔ Container factory-simulation-core        Started
✔ Container factory-sim-visualizer         Started
✔ Container factory-sim-editor             Started
✔ Container factory-sim-executor-backend   Started
✔ Container factory-sim-executor           Started
✔ Container factory-sim-portal             Started
```

### 起動確認

```bash
# コンテナの状態確認（7コンテナすべてがUpであること）
docker-compose ps

# APIの疎通確認
curl http://localhost:8080/api/scenarios

# Executor APIの疎通確認
curl http://localhost:8084/api/executor/scenarios

# ポータルの疎通確認
curl -I http://localhost:8085
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
- `status` が `"completed"` であること
- `endReason` が `"event_exhausted"` であること（イベント枯渇で正常終了）
- `endTime` が妥当な値であること（この例では約9秒）

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
- ワークが逐次生成されている（t=0, 2, 4）
- 各ワークが `Created → Departed → Arrived → Destroyed` のライフサイクルを持つ
- ワークが重複して存在していない（1ステーション1ワーク）

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
- 全ワークイベント数: 12 (各ワーク4イベント x 3)

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
- 全ワークイベント数: 24 (各ワーク8イベント x 3)

**確認ポイント:**
- Processingステーションで `WorkArrived → ProcessingStarted → ProcessingCompleted → WorkDeparted` のフローが発生
- インターロック違反が発生しない（エラーログなし）
- ワークが重複してProcessingに入らない

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
- 全ワークイベント数: 160 (各ワーク8イベント x 20)

**確認ポイント:**
- 大量ワークでもシミュレーションが完走する
- メモリリークやパフォーマンス劣化がない
- すべてのワークが正しく処理・破棄される

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
    "departureTime": 3.0
  }
}
```

これにより、次のワークが到着する前に前のワークが完全に処理されます。

---

## 各ツールの動作確認

### sim-portal（統合管理ポータル）

http://localhost:8085 にアクセス。

**ダッシュボード (index.html):**
- シナリオ数・実行件数の統計が表示される
- 各ツールへのリンクカード（sim-editor, sim-executor, sim-visualizer, sim-explorer）が表示される
- 最近の実行履歴（最新5件）が表示される

**シナリオ管理 (scenarios.html):**
- 登録済みシナリオの一覧テーブルが表示される
- 各シナリオにEdit / Execute / Historyのアクションリンクがある
- Edit → sim-editor、Execute → sim-executor へ遷移する

**実行履歴 (executions.html):**
- 全シナリオの実行履歴が時系列で表示される
- ステータスフィルタ（All / Completed / Running / Error）で絞り込みができる

**システムステータス (status.html):**
- 各サービスの稼働状態（Online / Offline / Unknown）が表示される
- Refreshボタンで最新状態を再チェックできる

### sim-editor（シナリオエディタ）

http://localhost:8082 にアクセス。

**シナリオ一覧 (index.html):**
- 登録済みシナリオの一覧が表示される
- 「New Scenario」ボタンで新規作成画面に遷移する

**ビジュアルエディタ (editor.html):**
- 左パネル: ツールパレット（Source, Processing, Drain）
- 中央: SVGキャンバス（ドラッグ&ドロップでステーション配置）
- 右パネル: プロパティ編集（ステーション設定、SimDB接続設定）
- Undo/Redo、Import/Export、Grid Snap機能

**確認ポイント:**
- ステーションをキャンバスにドラッグ&ドロップで配置できる
- ステーション間を接続線で結べる
- 右パネルでプロパティ（処理時間等）を編集できる
- 保存後、APIに反映される

### sim-executor（シミュレーション実行管理）

http://localhost:8083 にアクセス。

**ダッシュボード (index.html):**
- シナリオ一覧が表示される
- 各シナリオをクリックして詳細画面へ遷移する

**シナリオ詳細 (scenario.html):**
- シナリオ情報の表示
- 過去の実行履歴テーブル
- 「New Execution」ボタンで実行設定画面へ

**実行設定 (execution.html):**
- シミュレーション開始日時の設定
- 終了条件の設定（Duration / Absolute）
- SimDBからの初期条件取得（「Fetch from SimDB」ボタン）
- 「Execute Simulation」ボタンで実行
- 実行結果の表示（ステータス、終了理由）

**確認ポイント:**
- シナリオを選択して実行設定ができる
- 実行後、結果（completed / error）が表示される
- 実行履歴が記録される

### sim-visualizer（3D可視化）

http://localhost:8081 にアクセス。

**シミュレーション一覧 (index-list.html):**
- 過去のシミュレーション一覧
- クリックして3Dビューアへ

**3Dビューア (index.html?sim={simulationId}):**
- Three.jsによる3Dアニメーション
- タイムラインスライダー
- 再生コントロール（Play / Pause / Reset / 速度調整）
- 表示オプション（ステーション名、ワークID表示トグル）

**確認ポイント:**
- ワークがステーション間をスムーズに移動する
- Processingステーションでワークが停止（処理中）する
- 複数ワークが同時にステーション内に存在しない
- タイムスタンプが正しく進む

---

## 3D可視化の確認

### 可視化サーバーへのアクセス

シミュレーション実行後、3D可視化で結果を確認できます。

```bash
# シミュレーション実行（前述の手順でIDを取得）
SIM_ID="yyyyyyyy-yyyy-yyyy-yyyy-yyyyyyyyyyyy"

# ブラウザで開く
open "http://localhost:8081?sim=$SIM_ID"
```

### 可視化画面の操作

**マウス操作:**
- 左ドラッグ: 視点回転
- ホイール: ズームイン/アウト
- 右ドラッグ: パン（視点移動）

**コントロール:**
- Play: シミュレーション再生
- Pause: 一時停止
- Reset: 最初に戻る
- Speed: 再生速度調整（0.5x, 1x, 2x, 5x, 10x）

### 確認ポイント

**ステーション表示:**
- Source: 緑色の円柱
- Processing: 青色の円柱
- Drain: 赤色の円柱

**ワーク表示:**
- 小さな球体として表示
- ステーション間をスムーズに移動
- 同時に複数のワークがステーション内に存在しない（1ステーション1ワーク）

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

# 特定サービスのログを確認
docker-compose logs simulation-core
docker-compose logs sim-executor-backend

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
    "departureTime": 5.0
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

### フロントエンドのCORSエラー

**症状:**
ブラウザのコンソールに `CORS policy` エラーが表示される。

**原因:**
- sim-portalやsim-executorのフロントエンドから、simulation-core APIやsim-executor-backend APIにリクエストしている
- Docker環境内ではCORSヘッダーが正しく設定されている必要がある

**対処法:**
```bash
# simulation-coreのログでCORS関連エラーを確認
docker-compose logs simulation-core | grep -i cors

# sim-executor-backendのログを確認
docker-compose logs sim-executor-backend | grep -i cors
```

各バックエンドサービスはCORSミドルウェアで `Access-Control-Allow-Origin: *` を設定しています。エラーが出る場合はコンテナを再ビルドしてください。

### テストが失敗する

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
# 使用中のポートを確認
lsof -i :8080  # simulation-core
lsof -i :8081  # sim-visualizer
lsof -i :8082  # sim-editor
lsof -i :8083  # sim-executor
lsof -i :8084  # sim-executor-backend
lsof -i :8085  # sim-portal
lsof -i :5432  # PostgreSQL

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
 public | execution_configs     | table | postgres
 public | scenarios             | table | postgres
 public | scenario_connections  | table | postgres
 public | scenario_stations     | table | postgres
 public | simulation_runs       | table | postgres
 public | station_status_logs   | table | postgres
 public | work_events           | table | postgres
 public | work_lineage          | table | postgres
```

### データ確認クエリ

```sql
-- シナリオ一覧
SELECT id, name, created_at
FROM scenarios
ORDER BY created_at DESC
LIMIT 5;

-- シミュレーション実行一覧
SELECT simulation_id, friendly_name, status, end_time
FROM simulation_runs
ORDER BY created_at DESC
LIMIT 5;

-- sim-executor実行履歴
SELECT id, scenario_id, status, created_at
FROM execution_configs
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
- [ ] 7つのコンテナがすべて起動している
- [ ] simulation-core API にアクセスできる（http://localhost:8080）
- [ ] sim-executor-backend APIにアクセスできる（http://localhost:8084）

### 基本動作（API）
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

### sim-portal
- [ ] ダッシュボードが表示される（http://localhost:8085）
- [ ] 統計（シナリオ数、実行件数）が表示される
- [ ] シナリオ管理ページで一覧が表示される
- [ ] 実行履歴ページで履歴が表示される
- [ ] システムステータスページでサービス状態が表示される

### sim-editor
- [ ] シナリオ一覧が表示される（http://localhost:8082）
- [ ] ビジュアルエディタでステーションを配置できる
- [ ] ステーション間を接続できる
- [ ] シナリオを保存できる

### sim-executor
- [ ] ダッシュボードが表示される（http://localhost:8083）
- [ ] シナリオを選択して実行設定ができる
- [ ] シミュレーションを実行できる
- [ ] 実行履歴が表示される

### sim-visualizer
- [ ] シミュレーション結果が3Dで表示される（http://localhost:8081）
- [ ] ワークが滑らかに移動する
- [ ] 再生・一時停止・リセット操作ができる
- [ ] 速度調整ができる

### データ永続化
- [ ] PostgreSQLにデータが正しく保存されている
- [ ] シミュレーション結果が再取得できる

---

## 関連ドキュメント

- [README.md](README.md) - システム概要とクイックスタート
- [ARCHITECTURE.md](ARCHITECTURE.md) - アーキテクチャ設計書
- `simulation-core/internal/domain/station.go` - ステーション実装
- `simulation-core/internal/simulation/engine.go` - シミュレーションエンジン実装
