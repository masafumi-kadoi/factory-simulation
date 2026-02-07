# Factory Simulation System

工場シミュレーションシステムのSimulation Core初期実装。

## 概要

離散イベントシミュレーションエンジンを使用して、工場の生産ラインにおけるワークの流れや処理時間、ボトルネックを分析するシステムです。

## システム構成

- **Simulation Core** (Go): 高速な離散イベントシミュレーションエンジン
- **PostgreSQL**: シミュレーションログの保存
- **Docker Compose**: コンテナ構成管理

## 前提条件

- Docker
- Docker Compose

## セットアップ

### 1. Docker Composeでシステムを起動

```bash
cd factory-simulation
docker-compose up -d
```

### 2. ヘルスチェック

```bash
# PostgreSQLの接続確認
docker-compose exec postgres pg_isready -U postgres

# APIサーバーの確認
curl http://localhost:8080/api/scenarios
```

## API使用例

### シナリオ登録 (POST /api/scenarios)

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

レスポンス例:
```json
{
  "scenarioId": "scenario-1"
}
```

### シミュレーション実行 (POST /api/simulations)

```bash
curl -X POST http://localhost:8080/api/simulations \
  -H "Content-Type: application/json" \
  -d '{
    "scenarioId": "scenario-1",
    "simulationTime": 100.0,
    "initialConditions": {}
  }'
```

レスポンス例:
```json
{
  "simulationId": "sim-1",
  "status": "completed",
  "endTime": 11.0,
  "endReason": "event_exhausted"
}
```

### シミュレーション結果取得 (GET /api/simulations/:id)

```bash
curl http://localhost:8080/api/simulations/sim-1
```

レスポンス例:
```json
{
  "simulationId": "sim-1",
  "scenarioId": "scenario-1",
  "status": "completed",
  "startTime": 0.0,
  "endTime": 11.0,
  "endReason": "event_exhausted",
  "summary": {
    "totalWorksCreated": 1,
    "totalWorksDestroyed": 1,
    "totalEvents": 8
  }
}
```

### 詳細ログ取得 (GET /api/simulations/:id/logs)

```bash
curl http://localhost:8080/api/simulations/sim-1/logs
```

レスポンス例:
```json
{
  "simulationId": "sim-1",
  "stationStatusLogs": [
    {
      "stationId": "source-1",
      "timestamp": 0.0,
      "statusType": "搬出可ON",
      "value": true
    }
  ],
  "workEvents": [
    {
      "workId": "work-001",
      "stationID": "source-1",
      "timestamp": 0.0,
      "eventType": "WorkCreated"
    }
  ]
}
```

## 基本テストシナリオ

[Source Station] → [Processing Station] → [Drain Station]

**動作:**
1. t=0: Source Stationがワークを1個生成
2. t=1: ワークがProcessing Stationに向けて出発
3. t=3: ワークがProcessing Stationに到着、処理開始
4. t=8: 処理完了（処理時間5秒）
5. t=9: ワークがDrain Stationに向けて出発
6. t=11: ワークがDrain Stationに到着、消滅
7. シミュレーション終了（イベント枯渇）

## アーキテクチャ

```
simulation-core/
├── cmd/server/          # エントリーポイント
├── internal/
│   ├── domain/          # ドメインモデル
│   ├── simulation/      # シミュレーションエンジン
│   ├── api/             # REST APIハンドラ
│   └── database/        # DB接続・リポジトリ
└── Dockerfile
```

## 開発

### ローカルでの実行（Go環境が必要）

```bash
cd simulation-core
go run cmd/server/main.go
```

### ログの確認

```bash
# simulation-coreのログ
docker-compose logs -f simulation-core

# PostgreSQLのログ
docker-compose logs -f postgres
```

### システムの停止

```bash
docker-compose down
```

### データベースのリセット

```bash
docker-compose down -v
docker-compose up -d
```

## トラブルシューティング

### ポートが既に使用されている

```bash
# 8080ポートを使用しているプロセスを確認
lsof -i :8080

# 5432ポートを使用しているプロセスを確認
lsof -i :5432
```

### データベース接続エラー

```bash
# PostgreSQLコンテナの状態確認
docker-compose ps postgres

# PostgreSQLコンテナのログ確認
docker-compose logs postgres
```

## 参照ドキュメント

- `docs/ideas/initial-requirements.md` - 初期要件定義書
- `.steering/20260207-simulation-core-initial/` - 実装のステアリングファイル

## ライセンス

MIT
