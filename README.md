# Factory Simulation System

工場シミュレーションシステム - インターロック制御方式による離散イベントシミュレーション

## 概要

Factory Simulationは、工場の生産ラインにおけるワークフローを**インターロック制御方式**でシミュレーションするシステムです。搬入可・搬出可の2信号による制御により、実際の生産ラインに近いリアルな挙動を再現します。

### 主な特徴

- **インターロック機構**: 搬入可・搬出可の2信号による厳密な制御
- **1ステーション1ワーク**: 各ステーションは同時に1つのワークのみ保持
- **逐次処理**: ワークは並列処理されず、1つずつ順番に処理
- **3D可視化**: Three.jsによる美しい3Dアニメーション
- **高速シミュレーション**: Go言語による高性能な離散イベントシミュレーションエンジン
- **データ永続化**: PostgreSQLによる結果の保存・分析

## システム構成

```
factory-simulation/
├── simulation-core/        # シミュレーションエンジン (Go)
│   ├── cmd/server/         # APIサーバー
│   ├── internal/
│   │   ├── domain/         # ドメインモデル（Station, Work, Simulation）
│   │   ├── simulation/     # シミュレーションエンジン（イベント駆動）
│   │   ├── api/            # REST APIハンドラ
│   │   └── database/       # PostgreSQLリポジトリ
│   └── test/               # テストシナリオ
├── sim-visualizer/         # 3D可視化 (Three.js)
│   └── html/
│       ├── index.html
│       └── js/
│           ├── app.js                      # アプリケーションロジック
│           └── visualizer.js               # Three.js 3Dレンダリング
├── postgres/               # PostgreSQLマイグレーション
└── docker-compose.yml      # コンテナ構成
```

### コンテナ構成

| コンテナ | 役割 | ポート |
|----------|------|--------|
| **simulation-core** | シミュレーションエンジン + REST API | 8080 |
| **sim-visualizer** | 3D可視化 (Nginx + Three.js) | 8081 |
| **postgres** | データベース | 5432 |

## クイックスタート

### 前提条件

- Docker
- Docker Compose

### 起動

```bash
cd factory-simulation
docker-compose up -d
```

### 動作確認

```bash
# APIの疎通確認
curl http://localhost:8080/api/scenarios

# 可視化サーバーの確認
curl -I http://localhost:8081
```

### シンプルなシミュレーションを実行

```bash
# 1. シナリオ登録
SCENARIO_ID=$(curl -s -X POST http://localhost:8080/api/scenarios \
  -H "Content-Type: application/json" \
  -d '{
    "name": "シンプルテスト",
    "stations": [
      {"id": "source-1", "type": "source", "config": {"workCount": 3, "departureTime": 2.0}},
      {"id": "processing-1", "type": "processing", "config": {"processingTime": 1.0, "arrivalTime": 0.5, "departureTime": 0.5}},
      {"id": "drain-1", "type": "drain", "config": {"arrivalTime": 0.5}}
    ],
    "connections": [
      {"from": "source-1", "to": "processing-1"},
      {"from": "processing-1", "to": "drain-1"}
    ]
  }' | jq -r '.scenarioId')

echo "Scenario ID: $SCENARIO_ID"

# 2. シミュレーション実行
SIM_ID=$(curl -s -X POST http://localhost:8080/api/simulations \
  -H "Content-Type: application/json" \
  -d "{\"scenarioId\": \"$SCENARIO_ID\", \"simulationTime\": 100.0, \"initialConditions\": {}}" \
  | jq -r '.simulationId')

echo "Simulation ID: $SIM_ID"

# 3. 結果確認
curl -s "http://localhost:8080/api/simulations/$SIM_ID" | jq

# 4. 3D可視化で確認
echo "Open: http://localhost:8081?sim=$SIM_ID"
```

## アーキテクチャ

### インターロック機構

各ステーションは2つの信号を持ちます：

| 信号 | 意味 | ONの条件 |
|------|------|----------|
| **搬入可 (InputReady)** | ワークを受け入れ可能 | `State == Idle && CurrentWork == nil` |
| **搬出可 (OutputReady)** | ワークを送出可能 | `State == Completed && CurrentWork != nil` |

**ワーク移動の条件:**
- 送出側の「搬出可」がON **かつ** 受入側の「搬入可」がONの時のみワークが移動
- これにより、1ステーション1ワークが保証される

### ステーション種別

現在実装されているステーション:

| 種別 | 役割 | 特徴 |
|------|------|------|
| **Source** | ワーク生成 | 指定個数のワークを逐次生成 |
| **Processing** | 処理（基底クラス） | 1ワークを受け取り、処理して送出 |
| **Drain** | ワーク消滅 | ワークを破棄して終了 |

将来実装予定:
- **Merge**: 複数ワークを1つに統合
- **Split**: 1ワークを複数に分割
- **Inspection**: 品質検査とOK/NG判定
- **Discharge**: 品質ステータスに応じた経路分岐

### 状態遷移

Processingステーションの状態遷移:

```
Idle (搬入可=ON, 搬出可=OFF)
  ↓ ワーク到着
Receiving (搬入可=OFF, 搬出可=OFF)
  ↓ 処理開始
Processing (搬入可=OFF, 搬出可=OFF)
  ↓ 処理完了
Completed (搬入可=OFF, 搬出可=ON)
  ↓ ワーク出発
Idle (搬入可=ON, 搬出可=OFF)
```

## API仕様

### シナリオ登録

```bash
POST /api/scenarios
Content-Type: application/json

{
  "name": "シナリオ名",
  "stations": [
    {
      "id": "station-id",
      "type": "source|processing|drain",
      "config": {
        "workCount": 3,          // Source: 生成するワーク数
        "departureTime": 2.0,    // ワーク送出にかかる時間
        "processingTime": 1.0,   // Processing: 処理時間
        "arrivalTime": 0.5       // ワーク受入にかかる時間
      }
    }
  ],
  "connections": [
    {"from": "station-id-1", "to": "station-id-2"}
  ]
}
```

**レスポンス:**
```json
{
  "scenarioId": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
}
```

### シミュレーション実行

```bash
POST /api/simulations
Content-Type: application/json

{
  "scenarioId": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "simulationTime": 100.0,
  "initialConditions": {}
}
```

**レスポンス:**
```json
{
  "simulationId": "yyyyyyyy-yyyy-yyyy-yyyy-yyyyyyyyyyyy",
  "friendlyName": "シナリオ名_実行_2026-02-10T...",
  "status": "completed",
  "endTime": 15.5,
  "endReason": "event_exhausted"
}
```

### 結果取得

```bash
GET /api/simulations/{simulationId}
```

**レスポンス:**
```json
{
  "simulationId": "yyyyyyyy-yyyy-yyyy-yyyy-yyyyyyyyyyyy",
  "scenarioId": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "status": "completed",
  "startTime": 0.0,
  "endTime": 15.5,
  "endReason": "event_exhausted",
  "summary": {
    "totalWorksCreated": 3,
    "totalWorksDestroyed": 3,
    "totalEvents": 24
  }
}
```

### ログ取得

```bash
GET /api/simulations/{simulationId}/logs
```

**レスポンス:**
```json
{
  "simulationId": "yyyyyyyy-yyyy-yyyy-yyyy-yyyyyyyyyyyy",
  "stationStatusLogs": [
    {
      "stationId": "source-1",
      "timestamp": 0.0,
      "statusType": "ワーク到着",
      "value": true
    }
  ],
  "workEvents": [
    {
      "workId": "...",
      "workFriendlyName": "work-1",
      "stationId": "source-1",
      "timestamp": 0.0,
      "eventType": "WorkCreated"
    }
  ],
  "workLineage": []
}
```

## テスト

### 自動テストの実行

```bash
cd simulation-core/test
bash run_all_tests.sh
```

**テストケース:**
- `01_basic_test.json`: Source → Drain（基本動作）
- `02_processing_test.json`: Source → Processing → Drain（処理ステーション）
- `07_stress_test.json`: 20ワークの負荷テスト

**期待される結果:**
```
Total tests: 3
Passed: 3
Failed: 0
```

詳細は [TESTING.md](TESTING.md) を参照してください。

## 開発

### ローカル開発環境

```bash
# Go環境が必要（Go 1.21以上）
cd simulation-core
go run cmd/server/main.go
```

### ログの確認

```bash
# simulation-coreのログ
docker-compose logs -f simulation-core

# PostgreSQLのログ
docker-compose logs -f postgres

# 可視化サーバーのログ
docker-compose logs -f sim-visualizer
```

### データベースのリセット

```bash
# ボリュームごと削除して再作成
docker-compose down -v
docker-compose up -d
```

### コードの再ビルド

```bash
# simulation-coreを再ビルド
docker-compose build simulation-core
docker-compose up -d simulation-core
```

## トラブルシューティング

### ポートが既に使用されている

```bash
# 使用中のポートを確認
lsof -i :8080  # API
lsof -i :8081  # 可視化
lsof -i :5432  # PostgreSQL

# プロセスを停止するか、docker-compose.ymlでポート番号を変更
```

### コンテナが起動しない

```bash
# ログを確認
docker-compose logs

# イメージを再ビルド
docker-compose build --no-cache
docker-compose up -d
```

### インターロック違反エラー

```
Simulation failed: interlock violation: next station ... InputReady=OFF
```

**原因**: Source の `departureTime` が短すぎる

**対処**: 次ステーションの処理サイクル時間より長く設定

```
サイクル時間 = arrivalTime + processingTime + departureTime
```

## パフォーマンス

### ベンチマーク（参考値）

| 項目 | 値 |
|------|-----|
| 最大ワーク数 | 10,000+ |
| シミュレーション速度 | リアルタイムの100倍以上 |
| メモリ使用量 | 100ワークあたり約10MB |
| API応答時間 | 平均50ms以下 |

## ライセンス

MIT

## 関連ドキュメント

- [TESTING.md](TESTING.md) - 詳細なテスト・動作確認ガイド
- [simulation-core/internal/domain/station.go](simulation-core/internal/domain/station.go) - ステーション実装
- [simulation-core/internal/simulation/engine.go](simulation-core/internal/simulation/engine.go) - シミュレーションエンジン実装

## 今後の予定

- [ ] Merge, Split, Inspection, Dischargeステーションの実装
- [ ] 複数経路対応（分岐・合流）
- [ ] リアルタイムシミュレーション機能
- [ ] パフォーマンスダッシュボード
- [ ] WebSocketによるリアルタイム更新
